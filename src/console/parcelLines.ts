/**
 * City-wide parcel lines for /map: from zoom 12 to 15 the map draws a prebuilt, generalized set of
 * parcel lines (GET /api/map/parcel-lines?level=low|mid, geometry only, built weekly), and from zoom
 * 16 the full detail zoom 16 tiles (parcelTiles.ts). Each level is fetched once per visit.
 */
import type { FeatureCollection, MultiLineString } from 'geojson';

/** Zoom from which the full detail tiles take over from the lines. */
export const FULL_ZOOM = 16;
/** Zoom from which the finer line set ("mid") is used. */
export const MID_ZOOM = 14;
/** Lines are drawn from here (the whole city on a phone). */
export const LINES_MIN_ZOOM = 12;
/** A tap on a parcel opens its card from this zoom. */
export const TAP_MIN_ZOOM = 14;
/** Zoom from which the tiles are drawn when the lines are unavailable (the old behavior). */
export const TILES_ONLY_MIN_ZOOM = 15;

export type LineLevel = 'low' | 'mid';
export type LineFC = FeatureCollection<MultiLineString, Record<string, never>>;

/** The line set for a zoom, or null where the full tiles are drawn (or nothing is). */
export function levelFor(zoom: number, minZoom = LINES_MIN_ZOOM): LineLevel | null {
  if (zoom >= FULL_ZOOM || zoom < minZoom) return null;
  return zoom >= MID_ZOOM ? 'mid' : 'low';
}

/** Zoom from which the full tiles load and draw: 16 with the lines, 15 without them. */
export const tilesMinZoom = (linesOk: boolean) => (linesOk ? FULL_ZOOM : TILES_ONLY_MIN_ZOOM);

/** Whether a tap at this zoom asks for the parcel under it without a drawn parcel shape (lines only). */
export const tapLooksUpParcel = (zoom: number, linesOk: boolean) => linesOk && zoom >= TAP_MIN_ZOOM && zoom < FULL_ZOOM;

interface Encoded {
  format?: string;
  scale?: number;
  origin?: [number, number];
  lines?: number[][];
}

/** Lines per feature: a few hundred lines per feature keeps the map's tiling quick. */
const PER_FEATURE = 400;

/** The stored set (delta encoded integers) as GeoJSON MultiLineStrings with no properties. Null for anything unexpected. */
export function decodeLines(data: unknown): LineFC | null {
  const d = data as Encoded | null;
  if (!d || d.format !== 'vtp-parcel-lines/1' || !d.scale || !Array.isArray(d.origin) || !Array.isArray(d.lines)) return null;
  const s = d.scale;
  const [ox, oy] = d.origin;
  const features: LineFC['features'] = [];
  let batch: number[][][] = [];
  for (const flat of d.lines) {
    if (!Array.isArray(flat) || flat.length < 4) continue;
    let x = flat[0] + ox;
    let y = flat[1] + oy;
    const line: number[][] = [[x / s, y / s]];
    for (let i = 2; i + 1 < flat.length; i += 2) {
      x += flat[i];
      y += flat[i + 1];
      line.push([x / s, y / s]);
    }
    batch.push(line);
    if (batch.length >= PER_FEATURE) {
      features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: batch }, properties: {} });
      batch = [];
    }
  }
  if (batch.length) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: batch }, properties: {} });
  return features.length ? { type: 'FeatureCollection', features } : null;
}

const sets = new Map<LineLevel, Promise<LineFC | null>>();

/** One level's lines (once per visit). Resolves null when the set is missing or the API failed. */
export function loadLines(base: string, level: LineLevel): Promise<LineFC | null> {
  let p = sets.get(level);
  if (!p) {
    p = fetch(`${base}?level=${level}`, { headers: { accept: 'application/json' } })
      .then(async (r) => (r.ok ? decodeLines(await r.json()) : null))
      .catch(() => null)
      .then((fc) => {
        if (!fc) sets.delete(level); // a later visit to this zoom tries again
        return fc;
      });
    sets.set(level, p);
  }
  return p;
}

/** Test hook: forget loaded sets. */
export const resetLines = () => sets.clear();
