/**
 * Open in Street View: a Google Maps link (no key, no cost) to the street level photos nearest a place.
 * A point opens where it is. A line opens at its point nearest its own middle. An area opens at the road
 * point nearest its center that lies inside the area or along its edge (roads run beside lots, not
 * through them); with no road there, at its center. Google shows the nearest photo to the point given.
 */
import { createContext } from "react";
import type { Geometry } from "geojson";

export type Pos = [number, number];

/** Where Street View opens for a capital project, by its map layer name (set by the map page). */
export const ProjectViewpoint = createContext<(gis: string) => Pos | null>(
  () => null,
);

interface RoadFC {
  features: Array<{ geometry: Geometry | null }>;
}

/** A road this close to an area's edge, in meters, counts as along it. */
export const EDGE_M = 30;

export function streetViewUrl([lng, lat]: Pos): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

// Meters per degree near Vineyard's latitude, close enough for picking the nearest point.
const M_LAT = 110_950;
const M_LNG = M_LAT * Math.cos((40.3 * Math.PI) / 180);
const dist = (a: Pos, b: Pos) =>
  Math.hypot((a[0] - b[0]) * M_LNG, (a[1] - b[1]) * M_LAT);

/** The point on segment a to b nearest p. */
function onSegment(p: Pos, a: Pos, b: Pos): Pos {
  const dx = (b[0] - a[0]) * M_LNG,
    dy = (b[1] - a[1]) * M_LAT;
  const len = dx * dx + dy * dy;
  if (!len) return a;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * M_LNG * dx + (p[1] - a[1]) * M_LAT * dy) / len,
    ),
  );
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function linesOf(g: Geometry | null | undefined): Pos[][] {
  if (!g) return [];
  if (g.type === "LineString") return [g.coordinates as Pos[]];
  if (g.type === "MultiLineString") return g.coordinates as Pos[][];
  if (g.type === "GeometryCollection") return g.geometries.flatMap(linesOf);
  return [];
}

/** The point on any of the lines nearest p, with its distance in meters. */
function nearestOn(
  p: Pos,
  lines: Pos[][],
  keep: (q: Pos) => boolean = () => true,
): { at: Pos; d: number } | null {
  let best: { at: Pos; d: number } | null = null;
  for (const l of lines) {
    if (l.length === 1 && keep(l[0])) {
      const d = dist(p, l[0]);
      if (!best || d < best.d) best = { at: l[0], d };
    }
    for (let i = 1; i < l.length; i++) {
      const q = onSegment(p, l[i - 1], l[i]);
      const d = dist(p, q);
      if ((!best || d < best.d) && keep(q)) best = { at: q, d };
    }
  }
  return best;
}

function inRing(p: Pos, r: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (
      r[i][1] > p[1] !== r[j][1] > p[1] &&
      p[0] <
        ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]
    )
      inside = !inside;
  }
  return inside;
}

function ringArea(r: Pos[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

function ringCentroid(r: Pos[]): Pos {
  // Measured from the first corner, so the sums keep their precision.
  const [ox, oy] = r[0];
  let x = 0,
    y = 0,
    a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const x1 = r[j][0] - ox,
      y1 = r[j][1] - oy,
      x2 = r[i][0] - ox,
      y2 = r[i][1] - oy;
    const f = x1 * y2 - x2 * y1;
    x += (x1 + x2) * f;
    y += (y1 + y2) * f;
    a += f;
  }
  return a ? [ox + x / (3 * a), oy + y / (3 * a)] : r[0];
}

/** The outer ring of an area's largest part. */
function largestRing(g: Geometry): Pos[] | null {
  const polys = (
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? g.coordinates
        : []
  ) as Pos[][][];
  let best: Pos[] | null = null;
  for (const p of polys)
    if (p[0]?.length && (!best || ringArea(p[0]) > ringArea(best))) best = p[0];
  return best;
}

/** Where Street View opens for a shape, or null when it has no coordinates. */
export function viewpointFor(
  g: Geometry | null | undefined,
  roads?: RoadFC | null,
): Pos | null {
  if (!g) return null;
  if (g.type === "Point") return g.coordinates as Pos;
  if (g.type === "MultiPoint")
    return (g.coordinates[0] as Pos | undefined) ?? null;
  const lines = linesOf(g);
  if (lines.length) {
    const pts = lines.flat();
    if (!pts.length) return null;
    const mid: Pos = [
      pts.reduce((s, p) => s + p[0], 0) / pts.length,
      pts.reduce((s, p) => s + p[1], 0) / pts.length,
    ];
    return nearestOn(mid, lines)?.at ?? pts[0];
  }
  const ring = largestRing(g);
  if (!ring) return null;
  const c = ringCentroid(ring);
  const roadLines = (roads?.features ?? []).flatMap((f) => linesOf(f.geometry));
  if (!roadLines.length) return c;
  const near = (q: Pos) =>
    inRing(q, ring) || (nearestOn(q, [ring])?.d ?? Infinity) <= EDGE_M;
  return nearestOn(c, roadLines, near)?.at ?? c;
}
