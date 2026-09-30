/**
 * Map data for the portal's own map (/map), served from our origin.
 *
 * Vineyard City publishes its GIS layers as public ArcGIS feature services. This route asks those
 * services for GeoJSON with an allowlisted set of fields (no parcel owner names or mailing
 * addresses, no private business licenses), then streams the body straight through with long
 * edge caching, so the Worker does almost no CPU work and the city's servers see one request per
 * layer page per cache period, not one per visitor.
 */
import type { Env } from '../env';
import { HttpError, json, notFound } from '../lib/http';

const BASE = 'https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/';

export interface MapLayerDef {
  key: string;
  label: string;
  group: 'Plans' | 'Land' | 'Streets' | 'Places' | 'Safety';
  path: string;
  fields: string[];
  where?: string;
  geometry: 'polygon' | 'line' | 'point';
  /** Pages of 2,000 features (ArcGIS maxRecordCount). */
  pages?: number;
  /** Simplify geometry (map units, degrees) to keep big polygon layers light. */
  offset?: number;
  on?: boolean;
  minZoom?: number;
}

export const MAP_LAYERS: MapLayerDef[] = [
  { key: 'boundary', label: 'City boundary', group: 'Land', path: 'Vineyard_City_Boundary/FeatureServer/0', fields: ['NAME'], geometry: 'polygon', on: true, offset: 0.00002 },
  {
    key: 'projects',
    label: 'Capital projects',
    group: 'Plans',
    path: 'Capital_Improvement_Plan_Public_View/FeatureServer/650',
    fields: ['Project_Name', 'Department', 'Project_Phase', 'Phase_Status', 'Total_Budget', 'Funding_Source', 'Location', 'Description', 'Construction_Fiscal', 'Start_Date', 'Finish_Date', 'Consultant'],
    geometry: 'polygon',
    on: true,
  },
  { key: 'zoning', label: 'Zoning', group: 'Land', path: 'Zoning_-_Public_View/FeatureServer/8', fields: ['ZONE', 'District', 'Description', 'Ordinance', 'OrdinanceDate', 'ACRES'], geometry: 'polygon', offset: 0.00001 },
  { key: 'landuse', label: 'Future land use', group: 'Plans', path: 'Vineyard_Future_Land_Use_View/FeatureServer/0', fields: ['Land_Use', 'Acres'], geometry: 'polygon', offset: 0.00001 },
  {
    key: 'parcels',
    label: 'Parcels',
    group: 'Land',
    path: 'Vineyard_City_Parcels_view/FeatureServer/2',
    fields: ['PARCEL_NO', 'PARCELID_LABEL', 'ACREAGE', 'SITE_FULLADDRESS', 'SITE_CITY', 'SITE_ZIP5'],
    geometry: 'polygon',
    pages: 3,
    offset: 0.000004,
    minZoom: 14,
  },
  { key: 'subdivisions', label: 'Neighborhoods', group: 'Land', path: 'VNY_PLPZ_Subdivisions_view/FeatureServer/2', fields: ['Subdivision', 'Development', 'Public_Private'], geometry: 'polygon', offset: 0.000008, on: true },
  { key: 'rda', label: 'RDA areas', group: 'Plans', path: 'Redevelopment_Area/FeatureServer/454', fields: ['REDEV', 'REDLAB', 'INCEPT', 'YEAR_'], geometry: 'polygon', offset: 0.00001 },
  {
    key: 'rdaparcels',
    label: 'RDA phases by parcel',
    group: 'Plans',
    path: 'Vineyard_RDA_2026_Parcels/FeatureServer/686',
    fields: ['RDA', 'PARCEL_ID', 'PARCEL_ADD', 'acreage', 'total_taxable'],
    where: "RDA IS NOT NULL AND RDA <> ''",
    geometry: 'polygon',
    pages: 2,
    offset: 0.000004,
  },
  { key: 'ura', label: 'Geneva URA project area', group: 'Plans', path: 'Original_Geneva_URA_Project_Area/FeatureServer/471', fields: ['Name'], geometry: 'polygon', offset: 0.00001 },
  { key: 'watersedge', label: "Water's Edge districts", group: 'Plans', path: 'Waters_Edge_Subdistricts_-_Public_View/FeatureServer/9', fields: ['ZONE', 'District', 'Description', 'ACRES'], geometry: 'polygon', offset: 0.00001 },
  {
    key: 'roads',
    label: 'Roads',
    group: 'Streets',
    path: 'VNY_PWTR_Roads/FeatureServer/1',
    fields: ['FULLNAME', 'ROADCLASS', 'ROW_WIDTH', 'YearConst', 'FROMLEFT', 'TOLEFT', 'CULDESAC'],
    geometry: 'line',
    offset: 0.000005,
  },
  { key: 'trails', label: 'Trails and bike lanes', group: 'Streets', path: 'VNY_PWTR_Active_Transportation_Facilities_View/FeatureServer/0', fields: ['FULLNAME', 'Facilities', 'Jurisdiction', 'ROW_WIDTH', 'YearConst'], geometry: 'line', offset: 0.000005 },
  { key: 'snowplow', label: 'Snow plow routes', group: 'Streets', path: 'VNY_PWTR_SnowPlow_Routes_view/FeatureServer/286', fields: ['ROADNAME', 'Priority', 'Maintained', 'ROADCLASS'], geometry: 'line', offset: 0.000005 },
  { key: 'evacroutes', label: 'Evacuation routes', group: 'Safety', path: 'VNY_HZ_EvacuationRoutes/FeatureServer/601', fields: ['Direction', 'ToCity', 'Zone', 'Status'], geometry: 'line', offset: 0.000005 },
  { key: 'evaczones', label: 'Evacuation zones', group: 'Safety', path: 'VNY_HZ_EvacuationZone/FeatureServer/602', fields: ['Zone'], geometry: 'polygon', offset: 0.00001 },
  { key: 'crossings', label: 'School crossings', group: 'Safety', path: 'VNY_LO_School_Crossing_view/FeatureServer/314', fields: ['School_Name'], geometry: 'point' },
  { key: 'greenspace', label: 'Green space', group: 'Places', path: 'Green_Space_Management_View/FeatureServer/191', fields: ['Category', 'Maintenance', 'Owner'], geometry: 'polygon', offset: 0.000005 },
  { key: 'wayfinding', label: 'Wayfinding signs', group: 'Places', path: 'Wayfinding_Signage_view/FeatureServer/83', fields: ['Type', 'Description', 'Status'], geometry: 'point', minZoom: 13 },
  { key: 'parks', label: 'Parks', group: 'Places', path: 'VNY_PWPR_Park/FeatureServer/7', fields: ['NAME', 'ACRES', 'TYPE', 'STATUS'], geometry: 'polygon', on: true, offset: 0.000005 },
  { key: 'amenities', label: 'Park amenities', group: 'Places', path: 'VNY_PWPR_Amenities/FeatureServer/122', fields: ['Facility', 'Notes'], geometry: 'point', minZoom: 14 },
  { key: 'schools', label: 'Schools', group: 'Places', path: 'VNY_AD_Schools/FeatureServer/0', fields: ['Name', 'Address'], geometry: 'point', on: true },
  {
    key: 'businesses',
    label: 'Businesses',
    group: 'Places',
    path: 'Business_License_Public_View/FeatureServer/289',
    fields: ['Business_name', 'Business_License_type', 'Description', 'Street_address', 'Status'],
    where: "Public_Private <> 'Private'",
    geometry: 'point',
  },
];

const byKey = new Map(MAP_LAYERS.map((l) => [l.key, l]));

/** Public catalog of layers (no upstream URLs needed by the client). */
export function listMapLayers(): Response {
  const layers = MAP_LAYERS.map(({ key, label, group, geometry, pages, on, minZoom }) => ({ key, label, group, geometry, pages: pages ?? 1, on: Boolean(on), minZoom: minZoom ?? null }));
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
  if (!layer) throw notFound('Unknown map layer.');
  const page = Math.max(0, Math.min((layer.pages ?? 1) - 1, Number(url.searchParams.get('page') ?? 0) || 0));
  const upstream = await fetch(upstreamUrl(layer, page), {
    headers: { accept: 'application/geo+json, application/json', 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' },
    cf: { cacheTtl: 43200, cacheEverything: true },
  } as RequestInit);
  if (!upstream.ok || !upstream.body) throw new HttpError(502, 'backend_unavailable', 'The city map service did not respond. Try again shortly.');
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'application/geo+json; charset=utf-8',
      'cache-control': 'public, max-age=43200, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
