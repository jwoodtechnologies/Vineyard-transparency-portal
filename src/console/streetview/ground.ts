/**
 * The zones and projects as shapes on the ground, for telling which one a click or tap in street view or
 * Drive mode landed on (clickRoute.ts): outer rings only, zones grouped by zone, in the map's colors.
 */
import type { FeatureCollection } from 'geojson';

type Pos = [number, number];
type FC = FeatureCollection;

/** A zone or project on the ground (the same shape as zoningRenderer's District, kept here so this file has no browser only imports). */
export interface District {
  zone: string;
  color: string;
  /** 'zoning' (the default) or 'projects'. */
  layer?: string;
  rings: Pos[][];
}

/** Zoning districts for the photo overlay: outer rings grouped by zone, in the map's colors. */
export function districtsOf(fc: FC): District[] {
  const by = new Map<string, District>();
  for (const f of fc.features) {
    const zone = String(f.properties?.ZONE ?? '').trim();
    const g = f.geometry;
    if (!zone || !g) continue;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Pos[][][];
    const d = by.get(zone) ?? { zone, color: typeof f.properties?.__c === 'string' ? f.properties.__c : '#3b6ea8', rings: [] };
    for (const p of polys) if (p[0]?.length > 2) d.rings.push(p[0]);
    by.set(zone, d);
  }
  return [...by.values()];
}

/** Square kilometers inside a ring (flat earth is close enough at a town's size). */
export function ringKm2(r: Pos[]): number {
  if (r.length < 3) return 0;
  const k = 111.32 * Math.cos((r[0][1] * Math.PI) / 180);
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * k + r[i][0] * k) * (r[j][1] * 110.54 - r[i][1] * 110.54);
  return Math.abs(a / 2);
}

/** Projects drawn larger than this (a water rights purchase outlined over the whole city) are not a place on the street. */
export const PROJECT_MAX_KM2 = 1;

/** Capital projects as shapes on the ground, leaving out the city wide ones (PROJECT_MAX_KM2). */
export function projectsOf(fc: FC): District[] {
  const out: District[] = [];
  for (const f of fc.features) {
    const name = String(f.properties?.Project_Name ?? '').trim();
    const g = f.geometry;
    if (!name || !g) continue;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Pos[][][];
    const rings = polys.map((p) => p[0]).filter((r) => r?.length > 2 && ringKm2(r) <= PROJECT_MAX_KM2);
    if (rings.length) out.push({ zone: name, color: '#d6336c', layer: 'projects', rings });
  }
  return out;
}


/** A line feature on the ground (a UDOT construction project along a road). */
export interface GroundLine {
  layer: string;
  name: string;
  lines: Pos[][];
}

/** Line features with a name in `field`, as GroundLines. */
export function linesOf(fc: FC, layer: string, field: string): GroundLine[] {
  const out: GroundLine[] = [];
  for (const f of fc.features) {
    const name = String(f.properties?.[field] ?? '').trim();
    const g = f.geometry;
    if (!name || !g) continue;
    const lines = (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []) as Pos[][];
    if (lines.length) out.push({ layer, name, lines: lines.filter((l) => l.length > 1) });
  }
  return out;
}

/** Meters from a point to a segment, on a flat local grid. */
function toSegment(p: Pos, a: Pos, b: Pos): number {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180),
    ky = 110540;
  const ax = (a[0] - p[0]) * kx,
    ay = (a[1] - p[1]) * ky,
    bx = (b[0] - p[0]) * kx,
    by = (b[1] - p[1]) * ky;
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** The line nearest `at` within `meters`, or null. */
export function nearLine(list: GroundLine[], at: Pos, meters: number): GroundLine | null {
  let best: GroundLine | null = null;
  let bestD = meters;
  for (const l of list)
    for (const line of l.lines)
      for (let i = 0; i + 1 < line.length; i++) {
        const d = toSegment(at, line[i], line[i + 1]);
        if (d <= bestD) {
          bestD = d;
          best = l;
        }
      }
  return best;
}
