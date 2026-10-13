/**
 * A shape staff place on the map (a point, a line such as a closed road, or an area), checked before it is
 * stored. Pure: no Worker types. Coordinates are [longitude, latitude] in degrees, as GeoJSON writes them,
 * and must fall in the Vineyard area so a mistyped digit cannot put a closure in the ocean.
 */

export type PlaceType = 'Point' | 'LineString' | 'Polygon';
export type Place = { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: Array<[number, number]> } | { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };

/** Vineyard and a little around it: [west, south, east, north]. */
export const PLACE_BOUNDS: readonly [number, number, number, number] = [-111.83, 40.24, -111.64, 40.38];
export const MAX_VERTICES = 200;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function pair(v: unknown): [number, number] | string {
  if (!Array.isArray(v) || v.length < 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number' || !Number.isFinite(v[0]) || !Number.isFinite(v[1]))
    return 'Each point needs a longitude and a latitude.';
  const [lng, lat] = v as [number, number];
  const [w, s, e, n] = PLACE_BOUNDS;
  if (lng < w || lng > e || lat < s || lat > n) return 'That point is outside Vineyard. Check the latitude and longitude.';
  return [round(lng), round(lat)];
}

function path(v: unknown): Array<[number, number]> | string {
  if (!Array.isArray(v)) return 'The line needs a list of points.';
  if (v.length > MAX_VERTICES) return `Use at most ${MAX_VERTICES} points.`;
  const out: Array<[number, number]> = [];
  for (const p of v) {
    const q = pair(p);
    if (typeof q === 'string') return q;
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out;
}

/** The checked shape, or a sentence saying what is wrong (never throws). */
export function readPlace(v: unknown): Place | string {
  if (!v || typeof v !== 'object') return 'Choose a place on the map.';
  const g = v as { type?: unknown; coordinates?: unknown };
  if (g.type === 'Point') {
    const p = pair(g.coordinates);
    return typeof p === 'string' ? p : { type: 'Point', coordinates: p };
  }
  if (g.type === 'LineString') {
    const line = path(g.coordinates);
    if (typeof line === 'string') return line;
    return line.length >= 2 ? { type: 'LineString', coordinates: line } : 'A line needs at least two different points.';
  }
  if (g.type === 'Polygon') {
    const rings = g.coordinates;
    if (!Array.isArray(rings) || rings.length !== 1) return 'An area is one outline.';
    const ring = path(rings[0]);
    if (typeof ring === 'string') return ring;
    // The outline may arrive open or closed; it is stored closed.
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    if (ring.length < 3) return 'An area needs at least three different points.';
    return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
  }
  return 'Choose a point, a line or an area.';
}
