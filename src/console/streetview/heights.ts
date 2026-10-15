/**
 * How tall each building stands in the 3D view, from the best record available:
 * 1. OpenStreetMap: OpenFreeMap's render_height, worked out by OpenMapTiles from the height tag or
 *    building:levels at 3.66 m a floor. A building with neither gets exactly 5 m there, which is not a record.
 * 2. Utah County's assessor: floors above grade on the parcel under the building (UGRC's parcel records,
 *    GET /api/map/stories), at STORY_M a floor plus a roof.
 * 3. The parcel's property class: a typical height for that kind of building.
 * 4. UNKNOWN_M, a two story home, the most common building in Vineyard.
 * The buildings are redrawn from OpenFreeMap's tiles as GeoJSON with the chosen height whenever the view
 * settles somewhere new.
 */
import type * as maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';

/** OpenMapTiles' value for a building with no height or levels recorded. */
export const OMT_UNKNOWN_M = 5;
/** A typical two story home. */
export const UNKNOWN_M = 7.5;
export const STORY_M = 3.3;
export const ROOF_M = 1.5;
/** Typical heights by the assessor's property class. */
export const CLASS_M: Record<string, number> = { Residential: 7.5, Commercial: 8, 'Tax Exempt': 9, Vacant: 4 };

export interface ParcelStories {
  /** Floors above grade, when the assessor recorded them. */
  f?: number;
  /** Property class. */
  c?: string;
}

/** The height of one building: the first of OSM's recorded height, the parcel's floors, its class, or the default. */
export function heightFor(renderHeight: unknown, parcel: ParcelStories | null): number {
  const osm = Number(renderHeight);
  if (Number.isFinite(osm) && osm > 0 && osm !== OMT_UNKNOWN_M) return osm;
  if (parcel?.f && parcel.f > 0) return parcel.f * STORY_M + ROOF_M;
  if (parcel?.c && CLASS_M[parcel.c]) return CLASS_M[parcel.c];
  return UNKNOWN_M;
}

/** The fill-extrusion-height expression for OpenFreeMap's own tiles, before the parcel records are in. */
export function buildingHeight(): maplibregl.DataDrivenPropertyValueSpecification<number> {
  return ['case', ['all', ['has', 'render_height'], ['!=', ['to-number', ['get', 'render_height']], OMT_UNKNOWN_M]], ['to-number', ['get', 'render_height']], UNKNOWN_M] as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>;
}

type Box = [number, number, number, number];
interface Parcel {
  box: Box;
  rings: Position[][];
  p: ParcelStories;
}

const boxOf = (rings: Position[][]): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < b[0]) b[0] = x;
      if (y < b[1]) b[1] = y;
      if (x > b[2]) b[2] = x;
      if (y > b[3]) b[3] = y;
    }
  return b;
};

const inRing = ([x, y]: Position, ring: Position[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Grid cell size for finding parcels, in degrees (about 110 m north to south). */
const CELL = 0.001;
const cellKey = (x: number, y: number) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;

/** The parcels of the loaded stories tiles, bucketed on a grid for finding the one under a point. */
export class StoryIndex {
  private grid = new Map<string, Parcel[]>();
  private count = 0;
  add(fc: FeatureCollection): void {
    for (const f of fc.features) {
      const g = f.geometry;
      const polys = g?.type === 'Polygon' ? [(g as Polygon).coordinates] : g?.type === 'MultiPolygon' ? (g as MultiPolygon).coordinates : [];
      for (const rings of polys) {
        if (!(rings[0]?.length > 3)) continue;
        const q: Parcel = { box: boxOf([rings[0]]), rings, p: (f.properties ?? {}) as ParcelStories };
        this.count++;
        for (let cx = Math.floor(q.box[0] / CELL); cx <= Math.floor(q.box[2] / CELL); cx++)
          for (let cy = Math.floor(q.box[1] / CELL); cy <= Math.floor(q.box[3] / CELL); cy++) {
            const k = `${cx}:${cy}`;
            const list = this.grid.get(k);
            if (list) list.push(q);
            else this.grid.set(k, [q]);
          }
      }
    }
  }
  /** The parcel under a point (in its outer ring and none of its holes), or null. */
  at(pt: Position): ParcelStories | null {
    for (const q of this.grid.get(cellKey(pt[0], pt[1])) ?? []) {
      if (pt[0] < q.box[0] || pt[0] > q.box[2] || pt[1] < q.box[1] || pt[1] > q.box[3]) continue;
      if (inRing(pt, q.rings[0]) && !q.rings.slice(1).some((h) => inRing(pt, h))) return q.p;
    }
    return null;
  }
  get size(): number {
    return this.count;
  }
}

/** A point well inside a building's outline: the average of its outer ring's corners. */
export function centerOf(g: Polygon | MultiPolygon): Position | null {
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0];
  if (!ring?.length) return null;
  let x = 0,
    y = 0;
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

/** A home's walls rise to this share of its height; above them a smaller block reads as the roof. */
export const WALL_SHARE = 0.68;
/** How much of the footprint the roof block covers (scaled toward the middle). */
export const ROOF_SCALE = 0.6;
/** Larger than this (square meters), or with a height OpenStreetMap records, a building stays a plain box. */
export const HOME_MAX_M2 = 600;

function ringM2(ring: Position[]): number {
  const k = 111320 * Math.cos(((ring[0]?.[1] ?? 0) * Math.PI) / 180);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * k + ring[i][0] * k) * (ring[j][1] * 110540 - ring[i][1] * 110540);
  return Math.abs(a / 2);
}

/** A tone 0 to 3 from a position: the same building always gets the same one. */
export function toneOf(c: Position): number {
  const n = Math.abs(Math.round(c[0] * 1e5) * 73856093 ^ Math.round(c[1] * 1e5) * 19349663);
  return n % 4;
}

/** The outline scaled toward a point by `k`. */
function shrink(g: Polygon | MultiPolygon, c: Position, k: number): Polygon | MultiPolygon {
  const s = (r: Position[]) => r.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]);
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: [s(g.coordinates[0])] } : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => [s(p[0])]) };
}

/**
 * The buildings that are a block of others merged into one shape (lower zoom map tiles merge a street's
 * houses into one long outline): a footprint holding the middles of two or more other buildings. Drawn
 * as well, they stood as long grey blocks along the street, taller than the houses.
 */
export function mergedBlocks(buildings: Array<{ geometry: Polygon | MultiPolygon }>): Set<number> {
  const cell = (p: Position) => `${Math.floor(p[0] / 0.0005)},${Math.floor(p[1] / 0.0005)}`;
  const mids: Array<Position | null> = buildings.map((b) => centerOf(b.geometry));
  const grid = new Map<string, number[]>();
  mids.forEach((m, i) => {
    if (!m) return;
    const k = cell(m);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const out = new Set<number>();
  buildings.forEach((b, i) => {
    const ring = b.geometry.type === 'Polygon' ? b.geometry.coordinates[0] : b.geometry.coordinates[0]?.[0];
    if (!ring || ringM2(ring) < 250) return;
    let w = Infinity,
      s = Infinity,
      e = -Infinity,
      n = -Infinity;
    for (const [x, y] of ring) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    let inside = 0;
    const own = mids[i];
    for (let cx = Math.floor(w / 0.0005); cx <= Math.floor(e / 0.0005); cx++)
      for (let cy = Math.floor(s / 0.0005); cy <= Math.floor(n / 0.0005); cy++)
        for (const j of grid.get(`${cx},${cy}`) ?? []) {
          const m = mids[j];
          if (j === i || !m || (own && Math.abs(m[0] - own[0]) < 1e-6 && Math.abs(m[1] - own[1]) < 1e-6)) continue;
          const other = buildings[j].geometry;
          const oRing = other.type === 'Polygon' ? other.coordinates[0] : other.coordinates[0]?.[0];
          // Only smaller buildings count (the same shape again from another tile does not).
          if (!oRing || ringM2(oRing) > ringM2(ring) * 0.6) continue;
          if (inRing(m, ring)) inside++;
        }
    if (inside >= 2) out.add(i);
  });
  return out;
}

/**
 * Buildings as GeoJSON with their chosen height (h) and base (b), once each (the same building comes from
 * every tile it touches). A home (small, no recorded height) is walls (r 0) to WALL_SHARE of its height and a
 * smaller roof block (r 1) above, so from the street it reads as a house, not a flat slab.
 */
export function withHeights(buildings: Array<{ geometry: Polygon | MultiPolygon; properties: Record<string, unknown> | null }>, index: StoryIndex): FeatureCollection<Polygon | MultiPolygon, { h: number; b: number; r: number; k: number }> {
  const features: Array<Feature<Polygon | MultiPolygon, { h: number; b: number; r: number; k: number }>> = [];
  const seen = new Set<string>();
  const merged = mergedBlocks(buildings);
  for (const [i, f] of buildings.entries()) {
    if (merged.has(i)) continue;
    const c = centerOf(f.geometry);
    if (!c) continue;
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0]?.[0];
    const m2 = ring ? ringM2(ring) : 0;
    const key = `${c[0].toFixed(5)},${c[1].toFixed(5)},${Math.round(m2 / 5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = Number(f.properties?.render_min_height) || 0;
    const h = Math.max(base + 1, heightFor(f.properties?.render_height, index.at(c)));
    const osm = Number(f.properties?.render_height);
    // One of four close wall tones, from where the building stands, so neighbors read as separate houses.
    const k = toneOf(c);
    const recorded = Number.isFinite(osm) && osm > 0 && osm !== OMT_UNKNOWN_M;
    if (recorded || base > 0 || m2 > HOME_MAX_M2) {
      features.push({ type: 'Feature', geometry: f.geometry, properties: { h, b: base, r: 0, k } });
      continue;
    }
    const wall = base + (h - base) * WALL_SHARE;
    features.push({ type: 'Feature', geometry: f.geometry, properties: { h: wall, b: base, r: 0, k } });
    features.push({ type: 'Feature', geometry: shrink(f.geometry, c, ROOF_SCALE), properties: { h, b: wall, r: 1, k } });
  }
  return { type: 'FeatureCollection', features };
}

/** The zoom 16 tiles within `r` tiles of a point (the stories tiles are served at zoom 16 only). */
export function tilesAround([lng, lat]: Position, r = 1): Array<[number, number]> {
  const n = 2 ** 16;
  const x = Math.floor(((lng + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  const out: Array<[number, number]> = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) out.push([x + dx, y + dy]);
  return out;
}
