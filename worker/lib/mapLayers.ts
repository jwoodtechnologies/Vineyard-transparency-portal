/**
 * The city's public ArcGIS layers the portal serves, with the fields each may expose (no parcel
 * owner names or mailing addresses, no private business licenses), and Utah County's parcel
 * boundaries as image tiles with no fields at all. Pure: no Worker types, so the
 * Ask pipeline's place lookups and their tests can use it.
 */
import { FY27_PROJECTS_WHERE } from './capitalPlan';

export const BASE = 'https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/';

export interface MapLayerDef {
  key: string;
  label: string;
  group: 'Plans' | 'Land' | 'Streets' | 'Places' | 'Safety';
  path: string;
  fields: string[];
  where?: string;
  /** 'raster': drawn from image tiles (`tiles`), never served as GeoJSON with fields. */
  geometry: 'polygon' | 'line' | 'point' | 'raster';
  /** Raster layers only: tile URL template on the portal's own origin. */
  tiles?: string;
  /** Raster layers only: credit shown on the map. */
  attribution?: string;
  /** Pages of 2,000 features (ArcGIS maxRecordCount). */
  pages?: number;
  /** Simplify geometry (map units, degrees) to keep big polygon layers light. */
  offset?: number;
  on?: boolean;
  minZoom?: number;
}

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
    label: 'Parcels (Utah County)',
    group: 'Land',
    // Utah County's current parcel boundaries, as image tiles of the line layer only (see
    // parcelTileUrl). No fields, so no owner names or any other personal data can reach the page.
    path: '',
    fields: [],
    geometry: 'raster',
    tiles: '/api/map/tiles/parcels/{z}/{x}/{y}.png',
    attribution: 'Parcels: Utah County GIS',
    minZoom: 15,
  },
  { key: 'pdoverlay', label: 'Planned development overlay', group: 'Land', path: 'VNY_PLPZ_PD_Overlay_view/FeatureServer/10', fields: ['GRANTEE', 'ACRES'], geometry: 'polygon' },
  { key: 'subdivisions', label: 'Neighborhoods', group: 'Land', path: 'VNY_PLPZ_Subdivisions_view/FeatureServer/2', fields: ['Subdivision', 'Development', 'Public_Private'], geometry: 'polygon' },
  { key: 'ura', label: 'Geneva URA project area', group: 'Plans', path: 'Original_Geneva_URA_Project_Area/FeatureServer/471', fields: ['Name'], geometry: 'polygon' },
  { key: 'watersedge', label: "Water's Edge districts", group: 'Plans', path: 'Waters_Edge_Subdistricts_-_Public_View/FeatureServer/9', fields: ['ZONE', 'District', 'Description', 'ACRES'], geometry: 'polygon' },
  {
    key: 'roads',
    label: 'Roads',
    group: 'Streets',
    path: 'VNY_PWTR_Roads/FeatureServer/1',
    fields: ['FULLNAME', 'ROADCLASS', 'ROW_WIDTH', 'YearConst', 'FROMLEFT', 'TOLEFT', 'CULDESAC'],
    geometry: 'line',
  },
  { key: 'trails', label: 'Trails and bike lanes', group: 'Streets', path: 'VNY_PWTR_Active_Transportation_Facilities_View/FeatureServer/0', fields: ['FULLNAME', 'Facilities', 'Jurisdiction', 'ROW_WIDTH', 'YearConst'], geometry: 'line' },
  { key: 'snowplow', label: 'Snow plow routes', group: 'Streets', path: 'VNY_PWTR_SnowPlow_Routes_view/FeatureServer/286', fields: ['ROADNAME', 'Priority', 'Maintained', 'ROADCLASS'], geometry: 'line' },
  { key: 'evacroutes', label: 'Evacuation routes', group: 'Safety', path: 'VNY_HZ_EvacuationRoutes/FeatureServer/601', fields: ['Direction', 'ToCity', 'Zone', 'Status'], geometry: 'line' },
  { key: 'evaczones', label: 'Evacuation zones', group: 'Safety', path: 'VNY_HZ_EvacuationZone/FeatureServer/602', fields: ['Zone'], geometry: 'polygon' },
  { key: 'crossings', label: 'School crossings', group: 'Safety', path: 'VNY_LO_School_Crossing_view/FeatureServer/314', fields: ['School_Name'], geometry: 'point' },
  { key: 'greenspace', label: 'Green space', group: 'Places', path: 'Green_Space_Management_View/FeatureServer/191', fields: ['Category', 'Maintenance', 'Owner'], geometry: 'polygon' },
  { key: 'wayfinding', label: 'Wayfinding signs', group: 'Places', path: 'Wayfinding_Signage_view/FeatureServer/83', fields: ['Type', 'Description', 'Status'], geometry: 'point', minZoom: 13 },
  { key: 'parks', label: 'Parks', group: 'Places', path: 'VNY_PWPR_Park/FeatureServer/7', fields: ['NAME', 'ACRES', 'TYPE', 'STATUS'], geometry: 'polygon' },
  { key: 'amenities', label: 'Park amenities', group: 'Places', path: 'VNY_PWPR_Amenities/FeatureServer/122', fields: ['Facility', 'Notes'], geometry: 'point', minZoom: 14 },
  { key: 'schools', label: 'Schools', group: 'Places', path: 'VNY_AD_Schools/FeatureServer/0', fields: ['Name', 'Address'], geometry: 'point' },
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
  ['parcels', { key: 'parcels', label: 'Parcel addresses', group: 'Land', path: 'VNY_CA_Parcels_2025/FeatureServer/446', fields: ['SITE_FULL_ADDRESS'], geometry: 'polygon' }],
]);

/* ----------------------------------------------------------------------------------------------- */
/* Utah County parcel boundaries                                                                   */
/* ----------------------------------------------------------------------------------------------- */

/** Utah County GIS parcel map service (copyright "Utah County GIS"). */
export const COUNTY_PARCELS_MAPSERVER = 'https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer';
/**
 * The one layer of that service the portal draws: 3, "live_parcel_line" (boundary lines). Layer 2,
 * "OwnerParcel with Label", prints owner names and must never be used.
 * REVIEWER: confirm live that layer 3 draws lines only, with no owner or address labels.
 */
export const COUNTY_PARCEL_LINE_LAYER = 3;
/** Zoom levels the parcel tiles are served at (the layer shows from 15). */
export const PARCEL_TILE_ZOOM = { min: 14, max: 20 } as const;
/** Area the parcel tiles are served for: Vineyard and a margin around it. */
const PARCEL_AREA = { west: -111.82, south: 40.24, east: -111.66, north: 40.37 };

const HALF = 20037508.342789244;
const lngOfX = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const latOfY = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/**
 * The county's image of one 256 pixel web map tile of parcel lines (drawn at 512 pixels for sharp
 * lines on high density screens), or null for a tile outside the zoom range or area served. The
 * request always names the line layer alone: nothing a visitor sends can choose another layer or
 * ask for fields.
 */
export function parcelTileUrl(z: number, x: number, y: number): string | null {
  if (![z, x, y].every(Number.isInteger) || z < PARCEL_TILE_ZOOM.min || z > PARCEL_TILE_ZOOM.max) return null;
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return null;
  if (lngOfX(x + 1, z) < PARCEL_AREA.west || lngOfX(x, z) > PARCEL_AREA.east || latOfY(y, z) < PARCEL_AREA.south || latOfY(y + 1, z) > PARCEL_AREA.north) return null;
  const size = (2 * HALF) / n;
  const minX = -HALF + x * size;
  const maxY = HALF - y * size;
  const bbox = [minX, maxY - size, minX + size, maxY].map((v) => v.toFixed(2)).join(',');
  const p = new URLSearchParams({
    bbox,
    bboxSR: '3857',
    imageSR: '3857',
    size: '512,512',
    dpi: '192',
    format: 'png32',
    transparent: 'true',
    layers: `show:${COUNTY_PARCEL_LINE_LAYER}`,
    f: 'image',
  });
  return `${COUNTY_PARCELS_MAPSERVER}/export?${p.toString()}`;
}

/**
 * A filtered query on one of the allowlisted layers (only fields that layer already serves), for
 * server-side lookups such as finding where two roads meet. `where` must be built from sanitized text.
 */
export function layerQueryUrl(key: string, where: string, fields?: string[]): string | null {
  const layer = LOOKUPS.get(key) ?? byKey.get(key);
  if (!layer || layer.geometry === 'raster' || !layer.path) return null;
  const outFields = (fields ?? layer.fields).filter((f) => layer.fields.includes(f));
  const p = new URLSearchParams({ where, outFields: outFields.join(','), returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'geojson', resultRecordCount: '200' });
  return `${BASE}${layer.path}/query?${p.toString()}`;
}

