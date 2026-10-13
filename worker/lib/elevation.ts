/**
 * GET /api/map/elevation?p=lng,lat;lng,lat;... → ground elevation at each point, in meters, for the map's
 * measure tool (an elevation profile along a line), from the USGS 3D Elevation Program (public domain,
 * no key): every point in one request to its ImageServer getSamples; if that fails, one point per request
 * to the Elevation Point Query Service (slow, about a second or more a point). At most
 * MAX_ELEVATION_POINTS points per call and only inside Vineyard and a margin, so it stays small and cannot
 * be used to query elsewhere. USGS answers are kept at Cloudflare's edge for 30 days (ground elevations do
 * not change), and browsers keep the whole response for a day. The page's CSP is unchanged: the browser
 * only calls the portal.
 */
import { badRequest, HttpError, json } from './http';
import { PARCEL_AREA } from './mapLayers';

export const MAX_ELEVATION_POINTS = 50;
export const EPQS = 'https://epqs.nationalmap.gov/v1/json';
export const SAMPLES = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';
const SAMPLES_TIMEOUT_MS = 12000;
const UA = 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)';
/** Points asked of USGS at once (a Worker keeps six connections open at a time). */
const AT_ONCE = 6;
/** A point USGS has not answered in this time is left out, so one slow point never holds up the profile. */
const POINT_TIMEOUT_MS = 6000;

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

export function samplesUrl(pts: Array<[number, number]>): string {
  const geometry = JSON.stringify({ points: pts, spatialReference: { wkid: 4326 } });
  return `${SAMPLES}?${new URLSearchParams({ geometry, geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation', outFields: '', f: 'json' })}`;
}

/** A value from USGS in meters, or null where it has none (the services answer -1000000 or NoData there). */
const meters = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n > -1000 ? Math.round(n * 100) / 100 : null;
};

/** Every point's elevation from one getSamples request, or null when the service did not answer. */
async function sampleElevations(pts: Array<[number, number]>, fetcher: typeof fetch): Promise<Array<number | null> | null> {
  try {
    const res = await fetcher(samplesUrl(pts), {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(SAMPLES_TIMEOUT_MS),
      cf: { cacheTtl: 30 * 86400, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) {
      void res.body?.cancel();
      return null;
    }
    const body = (await res.json()) as { samples?: Array<{ locationId?: number; value?: unknown }>; error?: unknown } | null;
    if (!body || body.error || !Array.isArray(body.samples)) return null;
    const out: Array<number | null> = new Array(pts.length).fill(null);
    for (const s of body.samples) if (typeof s.locationId === 'number' && s.locationId >= 0 && s.locationId < pts.length) out[s.locationId] = meters(s.value);
    return out;
  } catch {
    return null;
  }
}

/** One point's elevation in meters, or null when USGS has none or did not answer. */
async function pointElevation(lng: number, lat: number, fetcher: typeof fetch): Promise<number | null> {
  try {
    const res = await fetcher(epqsUrl(lng, lat), {
      headers: { accept: 'application/json', 'user-agent': UA },
      signal: AbortSignal.timeout(POINT_TIMEOUT_MS),
      cf: { cacheTtl: 30 * 86400, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) {
      void res.body?.cancel();
      return null;
    }
    return meters(((await res.json()) as { value?: unknown } | null)?.value);
  } catch {
    return null;
  }
}

export async function getElevation(url: URL, fetcher: typeof fetch = fetch): Promise<Response> {
  const pts = parseElevationPoints(url.searchParams.get('p'));
  const sampled = await sampleElevations(pts, fetcher);
  if (sampled) return answer(pts, sampled);
  const out: Array<number | null> = new Array(pts.length).fill(null);
  // The fallback, a small pool: each lane takes the next point as soon as its last one is answered.
  let next = 0;
  const lane = async () => {
    while (next < pts.length) {
      const i = next++;
      out[i] = await pointElevation(pts[i][0], pts[i][1], fetcher);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, pts.length) }, lane));
  return answer(pts, out);
}

function answer(pts: Array<[number, number]>, out: Array<number | null>): Response {
  if (out.every((v) => v == null)) throw new HttpError(502, 'backend_unavailable', 'The USGS elevation service did not respond. Try again shortly.');
  const complete = out.every((v) => v != null);
  return json({ points: pts.map(([lng, lat], i) => ({ lng, lat, elevation: out[i] })), units: 'meters', source: 'USGS 3D Elevation Program' }, { cache: complete ? 'public, max-age=86400' : 'public, max-age=300' });
}
