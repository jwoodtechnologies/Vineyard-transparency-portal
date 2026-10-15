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

