/**
 * Map data for the portal's own map (/map), served from our origin.
 *
 * Vineyard City publishes its GIS layers as public ArcGIS feature services. This route asks those
 * services for GeoJSON with an allowlisted set of fields (no parcel owner names or mailing
 * addresses, no private business licenses) and exact, unsimplified shapes, then streams the body straight through with long
 * edge caching, so the Worker does almost no CPU work and the city's servers see one request per
 * layer page per cache period, not one per visitor. Utah County's current parcels come through as
 * zoom 16 GeoJSON tiles with the parcel number only, and a point lookup for the parcel card, both
 * stripped to field allowlists here (never owner names or mailing addresses).
 */
import type { Env } from '../env';
import { HttpError, json, notFound } from '../lib/http';
import { budgetForFeature } from '../lib/capitalPlan';
import { BASE, byKey, cityParcelAtUrl, COUNTY_PAGE, countyParcelAtUrl, countyParcelTileUrl, MAP_LAYERS, PARCEL_TILE_PAGES, parcelCard, parcelPoint, parcelTileBody, type MapLayerDef } from '../lib/mapLayers';

export { MAP_LAYERS, type MapLayerDef };

/** Public catalog of layers (no upstream URLs needed by the client). */
export function listMapLayers(): Response {
  const layers = MAP_LAYERS.map(({ key, label, group, geometry, pages, on, minZoom, tiles, attribution }) => ({ key, label, group, geometry, pages: pages ?? 1, on: Boolean(on), minZoom: minZoom ?? null, ...(tiles ? { tiles, attribution: attribution ?? null } : {}) }));
  return json({ layers, source: { name: 'Vineyard City Public GIS', url: 'https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb' } }, { headers: { 'cache-control': 'public, max-age=3600' } });
}

export function upstreamUrl(layer: MapLayerDef, page: number): string {
  const p = new URLSearchParams({
    where: layer.where ?? '1=1',
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
  return `${BASE}${layer.path}/query?${p.toString()}`;
}

/** GET /api/map/layers/:key?page=0 → GeoJSON FeatureCollection, cached for 12 hours. */
export async function getMapLayer(_env: Env, key: string, url: URL): Promise<Response> {
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
 * GET /api/map/parcel?lng=..&lat=.. → the parcel card for the parcel under a point: current Utah
 * County fields (allowlisted) and, from the city's 2025 parcel layer, property type and year built.
 */
export async function getParcelAt(url: URL): Promise<Response> {
  const pt = parcelPoint(Number(url.searchParams.get('lng') ?? ''), Number(url.searchParams.get('lat') ?? ''));
  if (!url.searchParams.get('lng') || !url.searchParams.get('lat') || !pt) throw new HttpError(400, 'bad_request', 'Give a point in Vineyard as lng and lat.');
  const [county, city] = await Promise.all([arcgisJson(countyParcelAtUrl(pt[0], pt[1])), arcgisJson(cityParcelAtUrl(pt[0], pt[1]))]);
  if (!county) throw new HttpError(502, 'backend_unavailable', 'The county parcel records did not respond. Try again shortly.');
  return json(parcelCard(county, city), { cache: DAY });
}

/**
 * The projects layer, with each feature's fiscal 2027 budget amount and funding source added from
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
    f.properties = match ? { FY27_Budget: match.amount, FY27_Source: match.source, ...rest } : rest;
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'content-type': 'application/geo+json; charset=utf-8',
      'cache-control': 'public, max-age=43200, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
