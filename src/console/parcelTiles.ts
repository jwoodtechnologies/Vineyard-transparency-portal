/**
 * Utah County parcel outlines for /map, read as zoom 16 GeoJSON tiles from the portal's own API
 * (parcel number only). Tiles covering the view are fetched once each and kept for the visit; the
 * map draws them as one source with each parcel once (a parcel crossing a tile edge comes back in
 * both tiles, whole).
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';

export const PARCEL_Z = 16;
/** Zoom from which outlines are drawn. */
export const PARCEL_MIN_ZOOM = 15;
/** Same area the API serves (Vineyard and a margin); nothing outside it is asked for. */
const AREA = { west: -111.82, south: 40.24, east: -111.66, north: 40.37 };
/** Never ask for more than this many tiles for one view. */
const MAX_TILES = 120;

type FC = FeatureCollection<Geometry, Record<string, unknown>>;

const tx = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** PARCEL_Z);
const ty = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** PARCEL_Z);
};

/** Zoom 16 tiles covering a view, clipped to the served area, nearest the middle first. */
export function tilesFor(b: { west: number; south: number; east: number; north: number }): Array<[number, number]> {
  const w = Math.max(b.west, AREA.west), e = Math.min(b.east, AREA.east);
  const s = Math.max(b.south, AREA.south), n = Math.min(b.north, AREA.north);
  if (w >= e || s >= n) return [];
  const x0 = tx(w), x1 = tx(e), y0 = ty(n), y1 = ty(s);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out.sort((a, c) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(c[0] - cx, c[1] - cy)).slice(0, MAX_TILES);
}

const tiles = new Map<string, Feature<Geometry, Record<string, unknown>>[]>();
const inflight = new Map<string, Promise<boolean>>();

/** Fetches one tile (once per visit). Resolves true when it is loaded, false when the API failed. */
export function loadTile(x: number, y: number, template: string): Promise<boolean> {
  const key = `${x}/${y}`;
  if (tiles.has(key)) return Promise.resolve(true);
  let p = inflight.get(key);
  if (!p) {
    const url = template.replace('{z}', String(PARCEL_Z)).replace('{x}', String(x)).replace('{y}', String(y));
    p = fetch(url, { headers: { accept: 'application/geo+json, application/json' } })
      .then(async (r) => {
        if (!r.ok) return false;
        const fc = (await r.json()) as FC;
        tiles.set(key, Array.isArray(fc.features) ? fc.features : []);
        return true;
      })
      .catch(() => false)
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** True when the tile has loaded. */
export const hasTile = (x: number, y: number) => tiles.has(`${x}/${y}`);

/** Every loaded tile as one collection, each parcel once. */
export function mergedParcels(): FC {
  const seen = new Set<string>();
  const features: FC['features'] = [];
  for (const list of tiles.values()) {
    for (const f of list) {
      const no = String(f.properties?.PARCEL_NO ?? '');
      if (no && seen.has(no)) continue;
      if (no) seen.add(no);
      features.push(f);
    }
  }
  return { type: 'FeatureCollection', features };
}

/** How many tiles have loaded this visit. */
export const loadedTileCount = () => tiles.size;
