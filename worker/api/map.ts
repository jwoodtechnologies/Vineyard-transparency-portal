/**
 * Map data for the portal's own map (/map), served from our origin.
 *
 * Vineyard City publishes its GIS layers as public ArcGIS feature services. This route asks those
 * services for GeoJSON with an allowlisted set of fields (no parcel owner names or mailing
 * addresses, no private business licenses) and exact, unsimplified shapes, then streams the body straight through with long
 * edge caching, so the Worker does almost no CPU work and the city's servers see one request per
 * layer page per cache period, not one per visitor. Utah County's current parcels come through as
 * zoom 16 GeoJSON tiles with the parcel number only, and a point lookup for the parcel card, both
 * stripped to field allowlists here (never mailing addresses; an owner name only on the card, only
 * when lib/ownerFilter.ts finds an entity, and on a home only a government or an HOA). For the city-wide view
 * (zoom 12 to 15) a prebuilt, generalized set of parcel lines is served from R2 (geometry only).
 */
import type { Env } from '../env';
import { API_SECURITY_HEADERS, badRequest, HttpError, json, notFound, readJson } from '../lib/http';
import { checkParcelLines, isParcelLineLevel, PARCEL_LINES_MAX_BYTES, parcelLinesKey } from '../lib/parcelLines';
import { budgetForFeature, FY27_PROJECTS_WHERE } from '../lib/capitalPlan';
import { BUDGET_FISCAL_YEAR } from '../lib/budgetData';
import { ALERTS_KEY, alertsLayer, hasMapNotices } from './mapAlerts';
import { BASE, byKey, cityParcelAtUrl, COUNTY_PAGE, countyOwnerAtUrl, countyParcelAtUrl, countyParcelTileUrl, MAP_LAYERS, PARCEL_TILE_PAGES, parcelCard, parcelPoint, parcelTileBody, storiesTileBody, storiesTileUrl, type MapLayerDef } from '../lib/mapLayers';

export { MAP_LAYERS, type MapLayerDef };

/** Public catalog of layers (no upstream URLs needed by the client). The staff-placed notices layer is listed only while there is one to show. */
export async function listMapLayers(env: Env): Promise<Response> {
  const layers: Array<Record<string, unknown>> = MAP_LAYERS.map(({ key, label, group, geometry, pages, on, minZoom, tiles, attribution, lines, linesMinZoom }) => ({ key, label, group, geometry, pages: pages ?? 1, on: Boolean(on), minZoom: minZoom ?? null, ...(tiles ? { tiles, attribution: attribution ?? null } : {}), ...(lines ? { lines, linesMinZoom: linesMinZoom ?? null } : {}) }));
  if (await hasMapNotices(env)) layers.push({ key: ALERTS_KEY, label: 'Closures and notices', group: 'Streets', geometry: 'mixed', pages: 1, on: true, minZoom: null });
  return json({ layers, source: { name: 'Vineyard City Public GIS', url: 'https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb' } }, { headers: { 'cache-control': 'public, max-age=60' } });
}

export function upstreamUrl(layer: MapLayerDef, page: number): string {
  const p = new URLSearchParams({
    // The capital projects layer follows the budget's map links, which staff can change (worker/lib/capitalPlan.ts).
    where: layer.key === 'projects' ? FY27_PROJECTS_WHERE : (layer.where ?? '1=1'),
    outFields: layer.fields.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    f: 'geojson',
    resultRecordCount: '2000',
    resultOffset: String(page * 2000),
  });
  // Paging needs a stable order; only multi-page layers ask for it (some layers' ID field is FID, not OBJECTID).
  if ((layer.pages ?? 1) > 1) p.set('orderByFields', 'OBJECTID');
  if (layer.offset) p.set('maxAllowableOffset', String(layer.offset));
  if (layer.envelope) {
    p.set('geometry', layer.envelope.join(','));
    p.set('geometryType', 'esriGeometryEnvelope');
    p.set('inSR', '4326');
    p.set('spatialRel', 'esriSpatialRelIntersects');
  }
  return `${layer.base ?? BASE}${layer.path}/query?${p.toString()}`;
}

/** GET /api/map/layers/:key?page=0 → GeoJSON FeatureCollection, cached for 12 hours. */
export async function getMapLayer(env: Env, key: string, url: URL): Promise<Response> {
  if (key === ALERTS_KEY) return alertsLayer(env);
  const layer = byKey.get(key);
  if (!layer || !layer.path) throw notFound('Unknown map layer.');
  const page = Math.max(0, Math.min((layer.pages ?? 1) - 1, Number(url.searchParams.get('page') ?? 0) || 0));
  const upstream = await fetch(upstreamUrl(layer, page), {
    headers: { accept: 'application/geo+json, application/json', 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' },
    cf: { cacheTtl: 43200, cacheEverything: true },
  } as RequestInit);
  if (!upstream.ok || !upstream.body) throw new HttpError(502, 'backend_unavailable', 'The city map service did not respond. Try again shortly.');
  if (layer.key === 'projects') return annotatedProjects(upstream);
  // ArcGIS reports query errors with HTTP 200 and an {"error": ...} body; never cache those.
  const [body, peek] = upstream.body.tee();
  const reader = peek.getReader();
  const first = await reader.read();
  void reader.cancel();
  const head = first.value ? new TextDecoder().decode(first.value.slice(0, 64)) : '';
  if (/^\s*\{\s*"error"/.test(head)) {
    void body.cancel();
    throw new HttpError(502, 'backend_unavailable', 'The city map service could not return this layer right now.');
  }
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/geo+json; charset=utf-8',
      'cache-control': 'public, max-age=43200, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}

const UA = 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)';
const DAY = 'public, max-age=86400, stale-while-revalidate=604800';

/** One ArcGIS GeoJSON query, cached at the edge for a day. Null for any failure (ArcGIS reports errors with HTTP 200). */
async function arcgisJson(url: string): Promise<{ features?: unknown; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } } | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/geo+json, application/json', 'user-agent': UA }, cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
    if (!res.ok) {
      void res.body?.cancel();
      return null;
    }
    const data = (await res.json()) as { error?: unknown; features?: unknown } | null;
    if (!data || data.error || !Array.isArray(data.features)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * GET /api/map/parcels/16/:x/:y.json → Utah County's current parcel outlines in one zoom 16 tile,
 * with the parcel number as the only field (everything else is stripped here, whatever the county
 * returns). Other zoom levels and tiles away from Vineyard are refused. Cached for a day.
 */
export async function getParcelOutlines(z: string, x: string, yJson: string): Promise<Response> {
  const m = /^(\d{1,7})\.json$/.exec(yJson);
  const ok = m && /^\d{1,2}$/.test(z) && /^\d{1,7}$/.test(x);
  const first = ok ? countyParcelTileUrl(Number(z), Number(x), Number(m[1]), 0) : null;
  if (!ok || !first) throw notFound('No parcel tile here.');
  const pages: unknown[] = [];
  const page0 = await arcgisJson(first);
  if (!page0) throw new HttpError(502, 'backend_unavailable', 'The county parcel map did not respond. Try again shortly.');
  pages.push(page0);
  const more = page0.exceededTransferLimit || page0.properties?.exceededTransferLimit || (Array.isArray(page0.features) && page0.features.length >= COUNTY_PAGE);
  for (let p = 1; more && p < PARCEL_TILE_PAGES; p++) {
    const next = await arcgisJson(countyParcelTileUrl(Number(z), Number(x), Number(m[1]), p) as string);
    if (!next) break; // keep what the first page drew
    pages.push(next);
    if (!Array.isArray(next.features) || next.features.length < COUNTY_PAGE) break;
  }
  return json(parcelTileBody(pages), { cache: DAY, headers: { 'content-type': 'application/geo+json; charset=utf-8' } });
}

/**
 * GET /api/map/stories/16/:x/:y.json → for the 3D street view's building heights: the parcels in one zoom
 * 16 tile with the assessor's floors above grade (f) and property class (c) from UGRC's Utah County
 * parcel records, nothing else. Other zoom levels and tiles away from Vineyard are refused. Cached for a day.
 */
export async function getStories(z: string, x: string, yJson: string): Promise<Response> {
  const m = /^(\d{1,7})\.json$/.exec(yJson);
  const ok = m && /^\d{1,2}$/.test(z) && /^\d{1,7}$/.test(x);
  const first = ok ? storiesTileUrl(Number(z), Number(x), Number(m[1]), 0) : null;
  if (!ok || !first) throw notFound('No stories tile here.');
  const page0 = await arcgisJson(first);
  if (!page0) throw new HttpError(502, 'backend_unavailable', 'The parcel records did not respond. Try again shortly.');
  const pages: unknown[] = [page0];
  if (page0.exceededTransferLimit || page0.properties?.exceededTransferLimit || (Array.isArray(page0.features) && page0.features.length >= COUNTY_PAGE)) {
    const next = await arcgisJson(storiesTileUrl(Number(z), Number(x), Number(m[1]), 1) as string);
    if (next) pages.push(next);
  }
  return json(storiesTileBody(pages), { cache: DAY, headers: { 'content-type': 'application/geo+json; charset=utf-8' } });
}

/**
 * The county owner record under a point, read once per tap and never stored upstream: no Cloudflare
 * fetch cache (cache: 'no-store', no cf options), so the raw owner name is in no cache body or key.
 * Any failure is null, with nothing logged (an error could carry the response text).
 */
async function ownerJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/geo+json, application/json', 'user-agent': UA }, cache: 'no-store' });
    if (!res.ok) {
      void res.body?.cancel();
      return null;
    }
    const data = (await res.json()) as { error?: unknown; features?: unknown } | null;
    return data && !data.error && Array.isArray(data.features) ? data : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/map/parcel?lng=..&lat=.. → the parcel card for the parcel under a point: current Utah
 * County fields (allowlisted), from the city's 2025 parcel layer property type and year built, and
 * the owner only when lib/ownerFilter.ts allows it (an entity, and on a home only a government or an
 * HOA). The owner name is classified here in the Worker; the body (which the edge may keep) holds
 * only the allowed name, never the raw county value, a withheld name or the mailing address.
 */
export async function getParcelAt(url: URL): Promise<Response> {
  const pt = parcelPoint(Number(url.searchParams.get('lng') ?? ''), Number(url.searchParams.get('lat') ?? ''));
  if (!url.searchParams.get('lng') || !url.searchParams.get('lat') || !pt) throw new HttpError(400, 'bad_request', 'Give a point in Vineyard as lng and lat.');
  const [county, city, owner] = await Promise.all([arcgisJson(countyParcelAtUrl(pt[0], pt[1])), arcgisJson(cityParcelAtUrl(pt[0], pt[1])), ownerJson(countyOwnerAtUrl(pt[0], pt[1]))]);
  if (!county) throw new HttpError(502, 'backend_unavailable', 'The county parcel records did not respond. Try again shortly.');
  // Browsers keep a card for ten minutes (the owner line follows the county record closely).
  return json(parcelCard(county, city, owner), { cache: 'public, max-age=600, stale-while-revalidate=3600' });
}

/**
 * The projects layer, with each feature's budget amount for the current fiscal year and funding source added from
 * the adopted budget. The city's own budget, funding and construction-year fields are dropped: for
 * these projects they describe earlier plans and would sit next to (and disagree with) the budget.
 */
async function annotatedProjects(upstream: Response): Promise<Response> {
  type Feature = { id?: number | string; properties?: Record<string, unknown> | null };
  const data = (await upstream.json().catch(() => null)) as { type?: string; features?: Feature[]; error?: unknown } | null;
  if (!data || data.error || !Array.isArray(data.features)) throw new HttpError(502, 'backend_unavailable', 'The city map service could not return this layer right now.');
  for (const f of data.features) {
    const props = f.properties ?? {};
    const oid = Number(props.OBJECTID ?? f.id);
    const match = Number.isFinite(oid) ? budgetForFeature(oid) : null;
    const { OBJECTID: _id, ...rest } = props;
    void _id;
    f.properties = match ? { FY27_Budget: match.amount, FY27_Source: match.source, Budget_Year: BUDGET_FISCAL_YEAR, ...rest } : rest;
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/geo+json; charset=utf-8',
      // Shorter than the other layers: the amounts come from the budget, which staff can change.
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** Browsers keep a line set for an hour and may use it for a week while checking for a newer one (the ETag is its version). */
export const PARCEL_LINES_CACHE = 'public, max-age=3600, stale-while-revalidate=604800';

/**
 * GET /api/map/parcel-lines?level=low|mid → the prebuilt parcel lines for zoom 12 to 13 (low) or
 * 14 to 15 (mid), gzipped as stored. 404 until the weekly build has stored one (the map then falls
 * back to the zoom 16 tiles). A matching If-None-Match gets 304.
 */
export async function getParcelLines(env: Env, request: Request, url: URL): Promise<Response> {
  const level = url.searchParams.get('level');
  if (!isParcelLineLevel(level)) throw notFound('No such parcel line level.');
  if (!env.ARCHIVE) throw notFound('Parcel lines are not available.');
  const obj = await env.ARCHIVE.get(parcelLinesKey(level));
  if (!obj) throw notFound('Parcel lines are not built yet.');
  const version = obj.customMetadata?.version ?? obj.etag;
  const etag = `"pl-${level}-${version}"`;
  const headers: Record<string, string> = {
    ...API_SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': PARCEL_LINES_CACHE,
    etag,
    vary: 'accept-encoding',
  };
  const inm = request.headers.get('if-none-match') ?? '';
  if (inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    void obj.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  // Stored gzipped: sent as is to every browser (all accept gzip); unpacked for a client that does not.
  if (/\bgzip\b/i.test(request.headers.get('accept-encoding') ?? '')) {
    return new Response(obj.body, { status: 200, headers: { ...headers, 'content-encoding': 'gzip', 'content-length': String(obj.size) }, encodeBody: 'manual' } as ResponseInit);
  }
  return new Response(obj.body.pipeThrough(new DecompressionStream('gzip')), { status: 200, headers });
}

/** PUT /api/admin/map/parcel-lines/:level (ingest only): checks the upload field by field and stores it gzipped under map/. */
export async function putParcelLines(env: Env, request: Request, level: string): Promise<Response> {
  if (!isParcelLineLevel(level)) throw notFound('No such parcel line level.');
  if (!env.ARCHIVE) throw new HttpError(503, 'backend_unavailable', 'The archive bucket is not bound.');
  const checked = checkParcelLines(await readJson<unknown>(request, PARCEL_LINES_MAX_BYTES), level);
  if (typeof checked === 'string') throw badRequest(checked);
  const text = JSON.stringify(checked);
  const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  await env.ARCHIVE.put(parcelLinesKey(level), gz, {
    httpMetadata: { contentType: 'application/json; charset=utf-8', contentEncoding: 'gzip' },
    customMetadata: { version: checked.version, built: checked.built, lines: String(checked.count) },
  });
  return json({ ok: true, key: parcelLinesKey(level), version: checked.version, lines: checked.count, bytes: text.length, gzip: gz.byteLength });
}
