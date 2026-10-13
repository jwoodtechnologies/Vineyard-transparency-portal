/**
 * The city's public ArcGIS layers the portal serves, with the fields each may expose (no parcel
 * owner names or mailing addresses, no private business licenses), and the Utah County parcel
 * queries with their field allowlists. The one exception is the parcel card's owner line: read per
 * tap and shown only when lib/ownerFilter.ts allows it. Pure: no Worker types, so the
 * Ask pipeline's place lookups and their tests can use it.
 */
import { FY27_PROJECTS_WHERE } from './capitalPlan';
import { deedYear, ownerDecision } from './ownerFilter';

export const BASE = 'https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/';
/** The city's 2025 copy of the county parcel layer. */
export const CITY_PARCELS_PATH = 'VNY_CA_Parcels_2025/FeatureServer/446';

export interface MapLayerDef {
  key: string;
  label: string;
  group: 'Plans' | 'Land' | 'Streets' | 'Places' | 'Safety';
  path: string;
  fields: string[];
  where?: string;
  geometry: 'polygon' | 'line' | 'point';
  /** Outlines drawn from fixed zoom GeoJSON tiles on the portal's origin; `path` is then the fallback layer. */
  tiles?: string;
  /** Credit shown on the map for tiled layers. */
  attribution?: string;
  /** Prebuilt, generalized lines drawn below the tiles' zoom (parcels: GET <lines>?level=low|mid). */
  lines?: string;
  /** Zoom from which those lines are drawn. */
  linesMinZoom?: number;
  /** Pages of 2,000 features (ArcGIS maxRecordCount). */
  pages?: number;
  /** Simplify geometry (map units, degrees) to keep big polygon layers light. */
  offset?: number;
  on?: boolean;
  minZoom?: number;
  /** Service root when the layer is not one of the city's (default BASE). */
  base?: string;
  /** Only features crossing this box, [west, south, east, north] in degrees. */
  envelope?: [number, number, number, number];
}

/**
 * UDOT's public project list (UDOT Open Data, "Projects as Lines"): projects in or touching Vineyard.
 * The same keywords and box are used by the nightly records job (ingest/statesources.py UDOT_KEYWORDS;
 * a test keeps the two lists equal). Abandoned and finished projects are left off the map.
 */
export const UDOT_BASE = 'https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/';
export const UDOT_KEYWORDS = ['VINEYARD', 'GENEVA', 'SR-114', 'SR-176', '800 N', '1600 N', 'SR-241', 'FRONTRUNNER', 'FRONT RUNNER', 'COMMUTER RAIL', 'DOUBLE TRACK'];
export const UDOT_ENVELOPE: [number, number, number, number] = [-111.8, 40.26, -111.69, 40.345];
export const UDOT_WHERE = `pin_stat_nm NOT IN ('Abandoned', 'Closed', 'Close Out') AND (${UDOT_KEYWORDS.flatMap((k) => ['pin_desc', 'proj_loc'].map((f) => `UPPER(${f}) LIKE '%${k}%'`)).join(' OR ')})`;

/** The active transportation layer without its bike lanes (see the trails layer). */
export const TRAILS_WHERE = "Facilities IS NULL OR UPPER(Facilities) NOT LIKE '%BIKE LANE%'";

export const MAP_LAYERS: MapLayerDef[] = [
  { key: 'boundary', label: 'City boundary', group: 'Land', path: 'Vineyard_City_Boundary/FeatureServer/0', fields: ['NAME'], geometry: 'polygon', on: true },
  {
    key: 'projects',
    label: 'Capital projects',
    group: 'Plans',
    path: 'Capital_Improvement_Plan_Public_View/FeatureServer/650',
    fields: ['OBJECTID', 'Project_Name', 'Department', 'Project_Phase', 'Phase_Status', 'Location', 'Description', 'Start_Date', 'Finish_Date', 'Consultant'],
    geometry: 'polygon',
    // Only projects in the adopted fiscal 2027 budget (see lib/capitalPlan.ts). The city's own map
    // still lists finished, rolled-over and dropped projects from earlier years.
    where: FY27_PROJECTS_WHERE,
  },
  { key: 'zoning', label: 'Zoning', group: 'Land', path: 'Zoning_-_Public_View/FeatureServer/8', fields: ['ZONE', 'District', 'Description', 'Ordinance', 'OrdinanceDate', 'ACRES'], geometry: 'polygon' },
  { key: 'landuse', label: 'Future land use', group: 'Plans', path: 'Vineyard_Future_Land_Use_View/FeatureServer/0', fields: ['Land_Use', 'Acres'], geometry: 'polygon' },
  {
    key: 'parcels',
    label: 'Parcels',
    group: 'Land',
    // Outlines come from Utah County's current parcels as zoom 16 GeoJSON tiles with the parcel
    // number only (/api/map/parcels, see countyParcelTileUrl). The city's 2025 copy is the fallback
    // if the county service is down. No owner names on the layer either way (the card's owner line
    // comes from a separate per-tap query, see countyOwnerAtUrl).
    path: CITY_PARCELS_PATH,
    fields: ['PARCEL_NO', 'SITE_FULL_ADDRESS', 'ACREAGE', 'SUB_NAME', 'PROP_TYPE_DESCR', 'GLA_WEIGHTED_YRBLT', 'MKT_CUR_VALUE', 'TAX_DISTRICT_DESCR'],
    geometry: 'polygon',
    pages: 3,
    tiles: '/api/map/parcels/{z}/{x}/{y}.json',
    attribution: 'Parcels: Utah County GIS',
    // Below zoom 16 the whole city's parcel lines come from a weekly prebuilt set (worker/lib/parcelLines.ts);
    // minZoom is where the tiles start if that set is unavailable.
    lines: '/api/map/parcel-lines',
    linesMinZoom: 12,
    minZoom: 15,
  },
  { key: 'subdivisions', label: 'Neighborhoods', group: 'Land', path: 'VNY_PLPZ_Subdivisions_view/FeatureServer/2', fields: ['Subdivision', 'Development', 'Public_Private'], geometry: 'polygon' },
  { key: 'watersedge', label: "Water's Edge districts", group: 'Plans', path: 'Waters_Edge_Subdistricts_-_Public_View/FeatureServer/9', fields: ['ZONE', 'District', 'Description', 'ACRES'], geometry: 'polygon' },
  {
    key: 'roads',
    label: 'Roads',
    group: 'Streets',
    path: 'VNY_PWTR_Roads/FeatureServer/1',
    fields: ['FULLNAME', 'ROADCLASS', 'ROW_WIDTH', 'YearConst', 'FROMLEFT', 'TOLEFT', 'CULDESAC'],
    geometry: 'line',
  },
  {
    key: 'trails',
    label: 'Trails',
    group: 'Streets',
    path: 'VNY_PWTR_Active_Transportation_Facilities_View/FeatureServer/0',
    fields: ['FULLNAME', 'Facilities', 'Jurisdiction', 'ROW_WIDTH', 'YearConst'],
    // Trails only: the layer also holds on-street bike lanes (Facilities "Bike Lane" and "Buffered Bike
    // Lane", October 2026), which are never sent. Trails are "Shared Use Path".
    where: TRAILS_WHERE,
    geometry: 'line',
  },
  { key: 'evacroutes', label: 'Evacuation routes', group: 'Safety', path: 'VNY_HZ_EvacuationRoutes/FeatureServer/601', fields: ['Direction', 'ToCity', 'Zone', 'Status'], geometry: 'line' },
  { key: 'evaczones', label: 'Evacuation zones', group: 'Safety', path: 'VNY_HZ_EvacuationZone/FeatureServer/602', fields: ['Zone'], geometry: 'polygon' },
  { key: 'crossings', label: 'School crossings', group: 'Safety', path: 'VNY_LO_School_Crossing_view/FeatureServer/314', fields: ['School_Name'], geometry: 'point' },
  { key: 'greenspace', label: 'Green space', group: 'Places', path: 'Green_Space_Management_View/FeatureServer/191', fields: ['Category', 'Maintenance', 'Owner'], geometry: 'polygon' },
  { key: 'wayfinding', label: 'Wayfinding signs', group: 'Places', path: 'Wayfinding_Signage_view/FeatureServer/83', fields: ['Type', 'Description', 'Status'], geometry: 'point', minZoom: 13 },
  { key: 'parks', label: 'Parks', group: 'Places', path: 'VNY_PWPR_Park/FeatureServer/7', fields: ['NAME', 'ACRES', 'TYPE', 'STATUS'], geometry: 'polygon' },
  { key: 'amenities', label: 'Park amenities', group: 'Places', path: 'VNY_PWPR_Amenities/FeatureServer/122', fields: ['Facility', 'Notes'], geometry: 'point', minZoom: 14 },
  { key: 'schools', label: 'Schools', group: 'Places', path: 'VNY_AD_Schools/FeatureServer/0', fields: ['Name', 'Address'], geometry: 'point' },
  {
    key: 'udot',
    label: 'UDOT projects',
    group: 'Streets',
    base: UDOT_BASE,
    path: 'Projects_as_Lines/FeatureServer/0',
    // Public project fields only (no contact names, phone numbers or emails).
    fields: ['pin', 'pin_desc', 'pin_stat_nm', 'proj_loc', 'public_desc', 'planned_construction_year'],
    where: UDOT_WHERE,
    envelope: UDOT_ENVELOPE,
    geometry: 'line',
    attribution: 'Projects: UDOT Open Data',
  },
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

export const byKey = new Map(MAP_LAYERS.map((l) => [l.key, l]));

/**
 * Server-side lookups only (never drawn, never served to the page): finding an address asked about
 * in a question. The city's 2025 copy of the county parcel layer is the one with site addresses;
 * only the address field may be read from it.
 */
const LOOKUPS = new Map<string, MapLayerDef>([
  ['parcels', { key: 'parcels', label: 'Parcel addresses', group: 'Land', path: CITY_PARCELS_PATH, fields: ['SITE_FULL_ADDRESS'], geometry: 'polygon' }],
]);

/* ----------------------------------------------------------------------------------------------- */
/* Utah County parcels                                                                             */
/* ----------------------------------------------------------------------------------------------- */

/** Utah County GIS parcel map service (copyright "Utah County GIS"). */
export const COUNTY_PARCELS_MAPSERVER = 'https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer';
/**
 * Layer 2 of that service ("OwnerParcel with Label"): current parcel polygons with no scale limit.
 * It also holds owner names (OWNER_NAME) and mailing addresses (OWN_FULL_ADDRESS), so every query
 * names its fields and every response is stripped to an allowlist in the Worker, whatever the county
 * sends back. OWNER_NAME is read only by the per-tap owner query and passes the owner filter first.
 */
export const COUNTY_PARCEL_LAYER = 2;
/** Fields the outline tiles may carry. */
export const PARCEL_TILE_FIELDS = ['PARCEL_NO'] as const;
/** Fields the parcel card may show from the county. */
export const PARCEL_CARD_FIELDS = ['PARCEL_NO', 'SITE_FULL_ADDRESS', 'ACREAGE', 'SUB_NAME', 'TAX_DISTRICT_DESCR', 'MKT_CUR_VALUE'] as const;
/** Fields read from the city's 2025 parcel layer at the same point (the county layer has neither). */
export const CITY_PARCEL_FIELDS = ['PARCEL_NO', 'PROP_TYPE_DESCR', 'GLA_WEIGHTED_YRBLT'] as const;
/** The one zoom level outline tiles are served at. */
export const PARCEL_TILE_Z = 16;
/** Area parcels are served for: Vineyard and a margin around it. */
export const PARCEL_AREA = { west: -111.82, south: 40.24, east: -111.66, north: 40.37 } as const;
/** ArcGIS maxRecordCount of the county service, and how many pages one tile may read. */
export const COUNTY_PAGE = 2000;
export const PARCEL_TILE_PAGES = 2;

const lngOfX = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOfY = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** [west, south, east, north] of one zoom 16 web map tile, or null for any other zoom or a tile outside the area. */
export function parcelTileEnvelope(z: number, x: number, y: number): [number, number, number, number] | null {
  if (![z, x, y].every(Number.isInteger) || z !== PARCEL_TILE_Z) return null;
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return null;
  const w = lngOfX(x, z);
  const e = lngOfX(x + 1, z);
  const north = latOfY(y, z);
  const s = latOfY(y + 1, z);
  if (e < PARCEL_AREA.west || w > PARCEL_AREA.east || north < PARCEL_AREA.south || s > PARCEL_AREA.north) return null;
  return [w, s, e, north];
}

/** County query for the parcel outlines in one tile (parcel number only), page 0 or 1. */
export function countyParcelTileUrl(z: number, x: number, y: number, page = 0): string | null {
  const env = parcelTileEnvelope(z, x, y);
  if (!env || !Number.isInteger(page) || page < 0 || page >= PARCEL_TILE_PAGES) return null;
  const p = new URLSearchParams({
    geometry: env.map((v) => v.toFixed(7)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: PARCEL_TILE_FIELDS.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    orderByFields: 'OBJECTID',
    resultOffset: String(page * COUNTY_PAGE),
    resultRecordCount: String(COUNTY_PAGE),
    f: 'geojson',
  });
  return `${COUNTY_PARCELS_MAPSERVER}/${COUNTY_PARCEL_LAYER}/query?${p.toString()}`;
}

/**
 * UGRC's copy of Utah County's parcels (Land Information Records), which carries the assessor's count
 * of floors above grade and a property class. Read for the 3D street view's building heights only.
 */
export const LIR_PARCELS = 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_Utah_LIR/FeatureServer/0';
/** The only fields a stories tile may carry. */
export const STORY_FIELDS = ['FLOORS_CNT', 'PROP_CLASS'] as const;

/** UGRC query for the parcels in one zoom 16 tile with floors and class, or null outside the area. */
export function storiesTileUrl(z: number, x: number, y: number, page = 0): string | null {
  const env = parcelTileEnvelope(z, x, y);
  if (!env || !Number.isInteger(page) || page < 0 || page >= PARCEL_TILE_PAGES) return null;
  const p = new URLSearchParams({
    geometry: env.map((v) => v.toFixed(7)).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: STORY_FIELDS.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    maxAllowableOffset: '0.000005',
    orderByFields: 'OBJECTID',
    resultOffset: String(page * COUNTY_PAGE),
    resultRecordCount: String(COUNTY_PAGE),
    f: 'geojson',
  });
  return `${LIR_PARCELS}/query?${p.toString()}`;
}

/** Stories tile body: each parcel's shape with f (floors above grade, when recorded) and c (property class). */
export function storiesTileBody(pages: unknown[]): { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: unknown; properties: { f?: number; c?: string } }> } {
  const features: Array<{ type: 'Feature'; geometry: unknown; properties: { f?: number; c?: string } }> = [];
  for (const page of pages)
    for (const f of stripFeatures((page as { features?: unknown } | null)?.features, STORY_FIELDS)) {
      if (!f.geometry) continue;
      const floors = Number(f.properties.FLOORS_CNT);
      const cls = typeof f.properties.PROP_CLASS === 'string' ? f.properties.PROP_CLASS.trim() : '';
      if (!(floors > 0) && !cls) continue;
      features.push({ type: 'Feature', geometry: f.geometry, properties: { ...(floors > 0 && floors < 60 ? { f: Math.round(floors) } : {}), ...(cls ? { c: cls } : {}) } });
    }
  return { type: 'FeatureCollection', features };
}

/** A point inside the parcel area (rounded to 6 decimals), or null. */
export function parcelPoint(lng: number, lat: number): [number, number] | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < PARCEL_AREA.west || lng > PARCEL_AREA.east || lat < PARCEL_AREA.south || lat > PARCEL_AREA.north) return null;
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

const pointQuery = (lng: number, lat: number, fields: readonly string[], geometry: boolean) =>
  new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where: '1=1',
    outFields: fields.join(','),
    returnGeometry: String(geometry),
    outSR: '4326',
    geometryPrecision: '6',
    resultRecordCount: '5',
    f: 'geojson',
  }).toString();

/** County query for the parcel under a point: the card fields and the parcel's shape. */
export function countyParcelAtUrl(lng: number, lat: number): string {
  return `${COUNTY_PARCELS_MAPSERVER}/${COUNTY_PARCEL_LAYER}/query?${pointQuery(lng, lat, PARCEL_CARD_FIELDS, true)}`;
}

/**
 * Fields of the per-tap owner query. OWNER_NAME is the county's owner field; VESTING_DOC gives the
 * year the vesting deed was recorded. Never OWN_FULL_ADDRESS (the mailing address).
 */
export const OWNER_QUERY_FIELDS = ['PARCEL_NO', 'OWNER_NAME', 'VESTING_DOC'] as const;

/**
 * County query for the owner of the parcel under a point (no shape). Read once per tap with no
 * upstream caching (the route fetches it with cache: 'no-store'); the raw name never leaves the Worker
 * unless ownerDecision (lib/ownerFilter.ts) allows it.
 */
export function countyOwnerAtUrl(lng: number, lat: number): string {
  return `${COUNTY_PARCELS_MAPSERVER}/${COUNTY_PARCEL_LAYER}/query?${pointQuery(lng, lat, OWNER_QUERY_FIELDS, false)}`;
}

/** City 2025 parcel query at a point: parcel number, property type and year built, no shape. */
export function cityParcelAtUrl(lng: number, lat: number): string {
  return `${BASE}${CITY_PARCELS_PATH}/query?${pointQuery(lng, lat, CITY_PARCEL_FIELDS, false)}`;
}

type GeoFeature = { type?: string; geometry?: unknown; properties?: Record<string, unknown> | null };
export type CleanFeature = { type: 'Feature'; geometry: unknown; properties: Record<string, string | number | boolean> };

/**
 * Features reduced to their shape and the allowed fields. Anything else the upstream sends (owner
 * names, mailing addresses, ids) is dropped here, server side.
 */
export function stripFeatures(features: unknown, allow: readonly string[]): CleanFeature[] {
  if (!Array.isArray(features)) return [];
  return (features as GeoFeature[])
    .filter((f) => f && typeof f === 'object')
    .map((f) => {
      const props: Record<string, string | number | boolean> = {};
      for (const k of allow) {
        const v = f.properties?.[k];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') props[k] = v;
      }
      return { type: 'Feature' as const, geometry: f.geometry ?? null, properties: props };
    });
}

/** Outline tile body from one or two county pages: parcel number only, one feature per parcel. */
export function parcelTileBody(pages: unknown[]): { type: 'FeatureCollection'; features: CleanFeature[] } {
  const seen = new Set<string>();
  const features: CleanFeature[] = [];
  for (const page of pages) {
    for (const f of stripFeatures((page as { features?: unknown } | null)?.features, PARCEL_TILE_FIELDS)) {
      if (!f.geometry) continue;
      const no = String(f.properties.PARCEL_NO ?? '').trim();
      if (no && seen.has(no)) continue;
      if (no) seen.add(no);
      features.push(f);
    }
  }
  return { type: 'FeatureCollection', features };
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (typeof v === 'number' && (!Number.isFinite(v) || v === 0));

export interface ParcelCard {
  found: boolean;
  /** Card fields in card order; empty ones are left out. */
  properties: Record<string, string | number>;
  /** Which of `properties` came from the city's 2025 parcel layer (the rest are current county records). */
  city: string[];
  geometry: unknown;
  /**
   * The owner from the county record, only when ownerDecision allows it (an entity, and not a home
   * unless a government or an HOA owns it). Absent otherwise, with nothing in its place.
   */
  owner?: ParcelOwner;
}

export interface ParcelOwner {
  name: string;
  /** The date the county record was read (YYYY-MM-DD). */
  asOf: string;
  /** The year the vesting deed was recorded, when the county's document number gives it. */
  deedYear?: number;
}

/**
 * The owner line for a card, or undefined. Reads only the owner feature with the card's own parcel
 * number, and the property type from the city layer only for that same number (no number, or a
 * different one, means the type is unknown and only a government or an HOA can be shown).
 */
export function parcelOwner(owner: unknown, parcelNo: string, propType: unknown, subName: unknown, today: string): ParcelOwner | undefined {
  if (!parcelNo) return undefined;
  const feats = (owner as { features?: unknown } | null)?.features;
  if (!Array.isArray(feats)) return undefined;
  const props = (feats as GeoFeature[]).map((f) => (f && typeof f === 'object' ? (f.properties ?? {}) : {}));
  // Exactly one record for this parcel number; anything else is left out.
  const same = props.filter((p) => String(p.PARCEL_NO ?? '').trim() === parcelNo);
  if (same.length !== 1) return undefined;
  const p = same[0];
  const d = ownerDecision({ owner: p.OWNER_NAME, propType, subName });
  if (!d.show) return undefined;
  const year = deedYear(p.VESTING_DOC);
  return { name: d.name, asOf: today, ...(year ? { deedYear: year } : {}) };
}

/**
 * The parcel card for a point: current county fields, plus property type and year built from the
 * city's 2025 layer when it names the same parcel, plus the owner when the owner filter allows it.
 * Only allowlisted fields can appear.
 */
export function parcelCard(county: unknown, city: unknown, owner: unknown = null, today = new Date().toISOString().slice(0, 10)): ParcelCard {
  const c = stripFeatures((county as { features?: unknown } | null)?.features, PARCEL_CARD_FIELDS)[0];
  if (!c) return { found: false, properties: {}, city: [], geometry: null };
  const properties: Record<string, string | number> = {};
  const put = (k: string, v: unknown) => {
    if (blank(v)) return false;
    properties[k] = typeof v === 'number' ? v : String(v).trim();
    return true;
  };
  const no = String(c.properties.PARCEL_NO ?? '').trim();
  const match = stripFeatures((city as { features?: unknown } | null)?.features, CITY_PARCEL_FIELDS).find((f) => !no || String(f.properties.PARCEL_NO ?? '').trim() === no);
  const cityKeys: string[] = [];
  for (const k of ['SITE_FULL_ADDRESS', 'PARCEL_NO', 'ACREAGE', 'SUB_NAME'] as const) put(k, c.properties[k]);
  for (const k of ['PROP_TYPE_DESCR', 'GLA_WEIGHTED_YRBLT'] as const) if (match && put(k, match.properties[k])) cityKeys.push(k);
  for (const k of ['MKT_CUR_VALUE', 'TAX_DISTRICT_DESCR'] as const) put(k, c.properties[k]);
  const sameNo = no ? stripFeatures((city as { features?: unknown } | null)?.features, CITY_PARCEL_FIELDS).find((f) => String(f.properties.PARCEL_NO ?? '').trim() === no) : undefined;
  const o = parcelOwner(owner, no, sameNo?.properties.PROP_TYPE_DESCR, c.properties.SUB_NAME, today);
  return { found: true, properties, city: cityKeys, geometry: c.geometry, ...(o ? { owner: o } : {}) };
}

/**
 * A filtered query on one of the allowlisted layers (only fields that layer already serves), for
 * server-side lookups such as finding where two roads meet. `where` must be built from sanitized text.
 */
export function layerQueryUrl(key: string, where: string, fields?: string[]): string | null {
  const layer = LOOKUPS.get(key) ?? byKey.get(key);
  if (!layer || !layer.path) return null;
  const outFields = (fields ?? layer.fields).filter((f) => layer.fields.includes(f));
  const p = new URLSearchParams({ where, outFields: outFields.join(','), returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'geojson', resultRecordCount: '200' });
  return `${layer.base ?? BASE}${layer.path}/query?${p.toString()}`;
}

