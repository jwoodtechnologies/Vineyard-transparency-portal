/**
 * Map data for the portal's own map (/map), served from our origin.
 *
 * Vineyard City publishes its GIS layers as public ArcGIS feature services. This route asks those
 * services for GeoJSON with an allowlisted set of fields (no parcel owner names or mailing
 * addresses, no private business licenses) and exact, unsimplified shapes, then streams the body straight through with long
 * edge caching, so the Worker does almost no CPU work and the city's servers see one request per
 * layer page per cache period, not one per visitor. Utah County's parcel boundaries come through
 * as image tiles of the boundary line layer alone (no fields, no owner names).
 */
import type { Env } from '../env';
import { HttpError, json, notFound } from '../lib/http';
import { budgetForFeature } from '../lib/capitalPlan';
import { BASE, byKey, MAP_LAYERS, parcelTileUrl, type MapLayerDef } from '../lib/mapLayers';

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
  // Raster layers (the county parcel lines) are image tiles only: never queried for features.
  if (!layer || layer.geometry === 'raster' || !layer.path) throw notFound('Unknown map layer.');
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

/**
 * GET /api/map/tiles/parcels/:z/:x/:y.png → one image tile of Utah County's parcel boundary lines,
 * cached for a day. Only images pass through: an ArcGIS error (or anything else that is not a
 * picture) is refused, so no feature data or owner names can ever be relayed.
 */
export async function getParcelTile(z: string, x: string, yPng: string): Promise<Response> {
  const m = /^(\d{1,7})\.png$/.exec(yPng);
  const url = m && /^\d{1,2}$/.test(z) && /^\d{1,7}$/.test(x) ? parcelTileUrl(Number(z), Number(x), Number(m[1])) : null;
  if (!url) throw notFound('No parcel tile here.');
  const upstream = await fetch(url, {
    headers: { accept: 'image/png,image/*', 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' },
    cf: { cacheTtl: 86400, cacheEverything: true },
  } as RequestInit);
  const type = upstream.headers.get('content-type') ?? '';
  if (!upstream.ok || !upstream.body || !/^image\/png\b/i.test(type)) {
    void upstream.body?.cancel();
    throw new HttpError(502, 'backend_unavailable', 'The county parcel map did not respond. Try again shortly.');
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      'x-content-type-options': 'nosniff',
    },
  });
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
