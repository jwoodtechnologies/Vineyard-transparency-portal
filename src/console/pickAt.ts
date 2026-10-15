/**
 * The feature of the map's layers at a ground point, found in the layers' own data (Drive mode's taps: on
 * tilted 3D terrain MapLibre reports no rendered features). The order is the map's own click order: a point
 * near the tap first, then a line near it, then the smallest shape it falls in. `tolM` is how near counts,
 * in meters (about 22 screen pixels at the current zoom).
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';

type Pos = [number, number];

export interface PickLayer {
  key: string;
  fc: FeatureCollection;
}

export interface Picked {
  key: string;
  feature: Feature;
}

const kx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const KY = 110540;

function meters(a: Pos, b: Pos): number {
  return Math.hypot((a[0] - b[0]) * kx(a[1]), (a[1] - b[1]) * KY);
}

function toSegment(p: Pos, a: Pos, b: Pos): number {
  const k = kx(p[1]);
  const ax = (a[0] - p[0]) * k,
    ay = (a[1] - p[1]) * KY,
    dx = (b[0] - a[0]) * k,
    dy = (b[1] - a[1]) * KY;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function inRing(p: Pos, r: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  return inside;
}

function ringArea(r: Pos[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

/** Points, lines and polygons (outer rings, with holes) of a geometry. */
function parts(g: Geometry | null): { points: Pos[]; lines: Pos[][]; polys: Pos[][][] } {
  const out = { points: [] as Pos[], lines: [] as Pos[][], polys: [] as Pos[][][] };
  if (!g) return out;
  if (g.type === 'Point') out.points.push(g.coordinates as Pos);
  else if (g.type === 'MultiPoint') out.points.push(...(g.coordinates as Pos[]));
  else if (g.type === 'LineString') out.lines.push(g.coordinates as Pos[]);
  else if (g.type === 'MultiLineString') out.lines.push(...(g.coordinates as Pos[][]));
  else if (g.type === 'Polygon') out.polys.push(g.coordinates as Pos[][]);
  else if (g.type === 'MultiPolygon') out.polys.push(...(g.coordinates as Pos[][][]));
  else if (g.type === 'GeometryCollection') for (const x of g.geometries) {
    const p = parts(x);
    out.points.push(...p.points);
    out.lines.push(...p.lines);
    out.polys.push(...p.polys);
  }
  return out;
}

export function pickAt(layers: PickLayer[], at: Pos, tolM: number): Picked | null {
  let point: { p: Picked; d: number } | null = null;
  let line: { p: Picked; d: number } | null = null;
  let poly: { p: Picked; area: number } | null = null;
  for (const { key, fc } of layers)
    for (const feature of fc.features) {
      const g = parts(feature.geometry);
      for (const q of g.points) {
        const d = meters(at, q);
        if (d <= tolM && (!point || d < point.d)) point = { p: { key, feature }, d };
      }
      for (const l of g.lines)
        for (let i = 0; i + 1 < l.length; i++) {
          const d = toSegment(at, l[i], l[i + 1]);
          if (d <= tolM && (!line || d < line.d)) line = { p: { key, feature }, d };
        }
      for (const rings of g.polys) {
        if (!rings[0] || !inRing(at, rings[0]) || rings.slice(1).some((h) => inRing(at, h))) continue;
        const area = ringArea(rings[0]);
        if (!poly || area < poly.area) poly = { p: { key, feature }, area };
      }
    }
  return point?.p ?? line?.p ?? poly?.p ?? null;
}

/** Meters per screen pixel at a latitude and map zoom (MapLibre's 512 px tiles). */
export function metersPerPx(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}
