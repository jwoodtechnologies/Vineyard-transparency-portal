/**
 * GET /api/map/elevation?p=lng,lat;lng,lat;... → ground elevation at each point, in meters, for the map's
 * measure tool (an elevation profile along a line). Read from the USGS Elevation Point Query Service
 * (3DEP, public domain, no key) one point per request, at most MAX_ELEVATION_POINTS points per call and
 * only inside Vineyard and a margin, so it stays small and cannot be used to query elsewhere. Each
 * point's answer is kept at Cloudflare's edge for 30 days (ground elevations do not change), and
 * browsers keep the whole response for a day. The page's CSP is unchanged: the browser only calls the portal.
 */
import { badRequest, HttpError, json } from './http';
import { PARCEL_AREA } from './mapLayers';

export const MAX_ELEVATION_POINTS = 50;
export const EPQS = 'https://epqs.nationalmap.gov/v1/json';
const UA = 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)';
/** Points asked of USGS at once. */
const AT_ONCE = 10;

/** The points in ?p=, rounded to five decimals (about a meter), or an error naming what is wrong. */
export function parseElevationPoints(v: string | null): Array<[number, number]> {
  if (!v) throw badRequest('Give points as p=lng,lat;lng,lat.');
  const parts = v.split(';').filter(Boolean);
  if (!parts.length) throw badRequest('Give points as p=lng,lat;lng,lat.');
  if (parts.length > MAX_ELEVATION_POINTS) throw badRequest(`Give at most ${MAX_ELEVATION_POINTS} points.`);
  return parts.map((s) => {
    const [x, y, extra] = s.split(',');
    const lng = Number(x),
      lat = Number(y);
    if (extra !== undefined || !x || !y || !Number.isFinite(lng) || !Number.isFinite(lat)) throw badRequest('Each point is lng,lat.');
    if (lng < PARCEL_AREA.west || lng > PARCEL_AREA.east || lat < PARCEL_AREA.south || lat > PARCEL_AREA.north) throw badRequest('Points must be in Vineyard.');
    return [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
  });
}

export const epqsUrl = (lng: number, lat: number) => `${EPQS}?x=${lng}&y=${lat}&units=Meters&wkid=4326&includeDate=false`;

/** One point's elevation in meters, or null when USGS has none or did not answer. */
async function pointElevation(lng: number, lat: number, fetcher: typeof fetch): Promise<number | null> {
  try {
    const res = await fetcher(epqsUrl(lng, lat), { headers: { accept: 'application/json', 'user-agent': UA }, cf: { cacheTtl: 30 * 86400, cacheEverything: true } } as RequestInit);
    if (!res.ok) {
      void res.body?.cancel();
      return null;
    }
    const v = Number(((await res.json()) as { value?: unknown } | null)?.value);
    // The service answers -1000000 where it has no data.
    return Number.isFinite(v) && v > -1000 ? Math.round(v * 100) / 100 : null;
  } catch {
    return null;
  }
}

export async function getElevation(url: URL, fetcher: typeof fetch = fetch): Promise<Response> {
  const pts = parseElevationPoints(url.searchParams.get('p'));
  const out: Array<number | null> = new Array(pts.length).fill(null);
  for (let i = 0; i < pts.length; i += AT_ONCE) {
    const batch = await Promise.all(pts.slice(i, i + AT_ONCE).map(([x, y]) => pointElevation(x, y, fetcher)));
    batch.forEach((v, j) => (out[i + j] = v));
  }
  if (out.every((v) => v == null)) throw new HttpError(502, 'backend_unavailable', 'The USGS elevation service did not respond. Try again shortly.');
  const complete = out.every((v) => v != null);
  return json(
    { points: pts.map(([lng, lat], i) => ({ lng, lat, elevation: out[i] })), units: 'meters', source: 'USGS 3D Elevation Program, Elevation Point Query Service' },
    { cache: complete ? 'public, max-age=86400' : 'public, max-age=300' },
  );
}
