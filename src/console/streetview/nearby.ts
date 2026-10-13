/**
 * Photos around a spot, for moving in the viewer like Google's: the photo nearest where a click or tap
 * lands on the road, and the other dates photos were taken at the same spot. One Graph API search per
 * spot (rounded to about a meter), kept for the visit.
 */
import { bearing, distance } from '../measure/geo';
import { turn } from './geo';
import { parsePhotos, photoSearchUrl, type Photo, type Pos } from './geo';

const cache = new Map<string, Promise<Photo[]>>();

export function photosAround(token: string, at: Pos, m: number): Promise<Photo[]> {
  const key = `${at[0].toFixed(5)},${at[1].toFixed(5)},${m}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(photoSearchUrl(token, at, m))
      .then((r) => (r.ok ? r.json() : null))
      .then(parsePhotos)
      .catch(() => [] as Photo[]);
    cache.set(key, p);
  }
  return p;
}

/** The photo nearest `target`, other than the one shown, within `max` meters of it. */
export function nearestTo(photos: Photo[], target: Pos, exclude: string | null, max = 20): Photo | null {
  let best: { p: Photo; d: number } | null = null;
  for (const p of photos) {
    if (p.id === exclude) continue;
    const d = distance(p.pos, target);
    if (d <= max && (!best || d < best.d)) best = { p, d };
  }
  return best?.p ?? null;
}

/** A click this close to straight ahead (degrees either way) counts as a step forward along the street. */
export const AHEAD_DEG = 30;

/**
 * The next photo for a click straight ahead: ahead of the camera along `heading`, facing within 45 degrees
 * of it (or 360 degree), nearest the clicked spot within `max` meters of it. Null when the click is off to
 * the side or nothing fits; the caller then uses nearestTo or a plain step forward.
 */
export function aheadTo(photos: Photo[], cam: Pos, heading: number, target: Pos, exclude: string | null, max = 20): Photo | null {
  if (Math.abs(turn(heading, bearing(cam, target))) > AHEAD_DEG) return null;
  let best: { p: Photo; d: number } | null = null;
  for (const p of photos) {
    if (p.id === exclude) continue;
    const step = distance(cam, p.pos);
    if (step < 1.5 || Math.abs(turn(heading, bearing(cam, p.pos))) > 50) continue;
    if (!p.pano && (p.compass == null || Math.abs(turn(heading, p.compass)) > 45)) continue;
    const d = distance(p.pos, target);
    if (d <= max && (!best || d < best.d)) best = { p, d };
  }
  return best?.p ?? null;
}

export interface DateChoice {
  /** "Jul 14, 2026". */
  label: string;
  day: string;
  /** The photo of that day nearest the spot. */
  photo: Photo;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The days photos were taken within `m` of a spot, newest first, each with its photo nearest the spot. */
export function datesAt(photos: Photo[], at: Pos, m = 12): DateChoice[] {
  const byDay = new Map<string, { photo: Photo; d: number }>();
  for (const p of photos) {
    if (!p.capturedAt) continue;
    const d = distance(p.pos, at);
    if (d > m) continue;
    const day = dayOf(p.capturedAt);
    const cur = byDay.get(day);
    if (!cur || d < cur.d) byDay.set(day, { photo: p, d });
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, v]) => ({ day, photo: v.photo, label: new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) }));
}
