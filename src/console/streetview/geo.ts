/**
 * Street view math, kept apart from the viewer so it can be tested and stays out of the map's main chunk:
 * picking the Mapillary photo nearest a pin, turning the photo to face the pin, the camera cone drawn on
 * the map, and zoning outlines in the viewer's local (east, north, up) meters.
 */
import { bearing, destination, distance, type Pos } from '../measure/geo';

export type { Pos };

/** How far from the pin a photo may be. */
export const MAX_PHOTO_M = 60;

export interface Photo {
  id: string;
  /** Where the photo was taken (Mapillary's computed position when it has one). */
  pos: Pos;
  /** The direction the camera faced, degrees clockwise from north, or null when unknown. */
  compass: number | null;
  /** A 360 degree photo. */
  pano: boolean;
  capturedAt: number | null;
}

/** The Graph API search for photos around a pin: a box `m` meters each way. */
export function photoSearchUrl(token: string, pin: Pos, m = MAX_PHOTO_M): string {
  const n = destination(pin, 0, m)[1] - pin[1];
  const e = destination(pin, 90, m)[0] - pin[0];
  const bbox = [pin[0] - e, pin[1] - n, pin[0] + e, pin[1] + n].map((v) => v.toFixed(6)).join(',');
  const q = new URLSearchParams({ access_token: token, fields: 'id,computed_geometry,geometry,computed_compass_angle,compass_angle,is_pano,captured_at', bbox, limit: '200' });
  return `https://graph.mapillary.com/images?${q}`;
}

type GraphImage = {
  id?: unknown;
  computed_geometry?: { coordinates?: unknown };
  geometry?: { coordinates?: unknown };
  computed_compass_angle?: unknown;
  compass_angle?: unknown;
  is_pano?: unknown;
  captured_at?: unknown;
};

const point = (v: unknown): Pos | null => (Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [Number(v[0]), Number(v[1])] : null);
const angle = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? ((v % 360) + 360) % 360 : null);

/** The photos in a Graph API answer ({ data: [...] }); anything malformed is skipped. */
export function parsePhotos(body: unknown): Photo[] {
  const list = (body as { data?: GraphImage[] } | null)?.data;
  if (!Array.isArray(list)) return [];
  const out: Photo[] = [];
  for (const g of list) {
    const pos = point(g.computed_geometry?.coordinates) ?? point(g.geometry?.coordinates);
    if (!pos || (typeof g.id !== 'string' && typeof g.id !== 'number')) continue;
    out.push({ id: String(g.id), pos, compass: angle(g.computed_compass_angle) ?? angle(g.compass_angle), pano: g.is_pano === true, capturedAt: typeof g.captured_at === 'number' ? g.captured_at : null });
  }
  return out;
}

/** The smallest turn from one bearing to another, -180 up to 180 degrees (positive is clockwise). */
export function turn(from: number, to: number): number {
  const d = ((((to - from) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Degrees clockwise from north from a photo's position to the pin. */
export const bearingToPin = (photo: Photo, pin: Pos): number => bearing(photo.pos, pin);

/**
 * The photo to open for a pin. Photos within 60 m are scored by distance, a flat photo facing away from
 * the pin (more than 60 degrees off) counting as 30 m farther since it cannot be turned to show the pin.
 * Among those within PREFER_BAND_M of the best score a 360 degree photo comes first, then the newest day,
 * then the nearest. Null when none is close enough.
 */
export function nearestPhoto(photos: Photo[], pin: Pos, max = MAX_PHOTO_M): Photo | null {
  return rankPhotos(photos, pin, max)[0] ?? null;
}

/** How much farther than the best photo a 360 degree or newer one may be and still be preferred. */
export const PREFER_BAND_M = 15;

const DAY = 86_400_000;
const dayOf = (t: number | null) => (t ? Math.floor(t / DAY) : 0);

/** 360 first, then the newest day, then the nearest: the order photos at about the same spot are shown in. */
export function preferOrder<T extends { p: Photo; score: number }>(a: T, b: T): number {
  if (a.p.pano !== b.p.pano) return a.p.pano ? -1 : 1;
  const days = dayOf(b.p.capturedAt) - dayOf(a.p.capturedAt);
  return days || a.score - b.score || (b.p.capturedAt ?? 0) - (a.p.capturedAt ?? 0);
}

/** Every photo within `max` of the pin, best first by the same rule (the next ones are tried when one fails to load). */
export function rankPhotos(photos: Photo[], pin: Pos, max = MAX_PHOTO_M): Photo[] {
  const scored: Array<{ p: Photo; score: number }> = [];
  for (const p of photos) {
    const d = distance(p.pos, pin);
    if (d > max) continue;
    const away = !p.pano && p.compass != null && d > 3 && Math.abs(turn(p.compass, bearingToPin(p, pin))) > 60;
    scored.push({ p, score: d + (away ? 30 : 0) });
  }
  scored.sort((a, b) => a.score - b.score);
  if (!scored.length) return [];
  const limit = scored[0].score + PREFER_BAND_M;
  const close = scored.filter((x) => x.score <= limit).sort(preferOrder);
  return [...close, ...scored.filter((x) => x.score > limit)].map((x) => x.p);
}

/**
 * Keeps a flat photo's view on the photo: the center (MapillaryJS basic coordinates, [0, 1] across and
 * down) is moved back in so no edge of the view goes past the edge of the photo, which shows black. The
 * view is `vfov` degrees tall at `aspect` (width over height); the photo is `w` by `h` with a focal length
 * `focal` (a fraction of its longer side). A view larger than the photo one way is centered that way.
 */
export function clampFlatCenter(center: [number, number], vfov: number, aspect: number, focal: number, w: number, h: number): [number, number] {
  const halfV = ((vfov * Math.PI) / 180) / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const long = Math.max(w, h, 1);
  const axis = (c: number, extent: number, halfView: number) => {
    const room = Math.atan(extent / 2 / focal) - halfView;
    if (room <= 0) return 0.5;
    const a = Math.atan(((c - 0.5) * extent) / focal);
    if (Math.abs(a) <= room) return c;
    return 0.5 + (Math.tan(Math.sign(a) * room) * focal) / extent;
  };
  return [axis(center[0], w / long, halfH), axis(center[1], h / long, halfV)];
}

/**
 * Where the viewer centers to face the pin, in MapillaryJS basic coordinates ([0, 1] across and down the
 * photo). A 360 degree photo is centered on its camera direction, so a turn of t degrees is t / 360 across;
 * a flat photo is assumed about 70 degrees wide and is turned as far as it allows. Slightly below the
 * horizon, where the ground at the pin is.
 */
export function centerOnPin(photo: Photo, pin: Pos): [number, number] {
  const t = photo.compass == null ? 0 : turn(photo.compass, bearingToPin(photo, pin));
  if (photo.pano) return [(((0.5 + t / 360) % 1) + 1) % 1, 0.55];
  return [Math.max(0.05, Math.min(0.95, 0.5 + t / 70)), 0.55];
}

/** The camera cone on the map: a wedge from the camera along its view, `length` meters long. */
export function coneRing(pos: Pos, bearingDeg: number, fovDeg: number, length: number, steps = 8): Pos[] {
  const half = Math.max(5, Math.min(170, fovDeg)) / 2;
  const ring: Pos[] = [pos];
  for (let i = 0; i <= steps; i++) ring.push(destination(pos, bearingDeg - half + (i * 2 * half) / steps, length));
  ring.push(pos);
  return ring;
}

export type ToEnu = (lng: number, lat: number, alt: number, refLng: number, refLat: number, refAlt: number) => number[];

/**
 * A polygon ring in the viewer's local frame: meters east, north and up from the reference (MapillaryJS's
 * geodeticToEnu), every point at `groundAlt` (the ground under the camera), as a flat [x, y, z, ...] list.
 * The closing point is left out.
 */
export function ringToLocal(ring: Pos[], ref: { lng: number; lat: number; alt: number }, groundAlt: number, enu: ToEnu): number[] {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const out: number[] = [];
  for (const [lng, lat] of pts) out.push(...enu(lng, lat, groundAlt, ref.lng, ref.lat, ref.alt));
  return out;
}

/** Google's Street View at a point (no key): the secondary option. */
export const googleStreetViewUrl = ([lng, lat]: Pos) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`;
