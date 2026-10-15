/**
 * The zones and projects as shapes on the ground, for telling which one a click or tap in street view or
 * Drive mode landed on (clickRoute.ts): outer rings only, zones grouped by zone, in the map's colors.
 */
import type { FeatureCollection } from 'geojson';
import type { District } from './zoningRenderer';

type Pos = [number, number];
type FC = FeatureCollection;

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

export function projectsOf(fc: FC): District[] {
  const out: District[] = [];
  for (const f of fc.features) {
    const name = String(f.properties?.Project_Name ?? '').trim();
    const g = f.geometry;
    if (!name || !g) continue;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Pos[][][];
    const rings = polys.map((p) => p[0]).filter((r) => r?.length > 2);
    if (rings.length) out.push({ zone: name, color: '#d6336c', layer: 'projects', rings });
  }
  return out;
}

