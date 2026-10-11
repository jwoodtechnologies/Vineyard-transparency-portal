/**
 * The city's public ArcGIS layers the portal serves, with the fields each may expose (no parcel
 * owner names or mailing addresses, no private business licenses). Pure: no Worker types, so the
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
  geometry: 'polygon' | 'line' | 'point';
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
    label: 'Parcels',
    group: 'Land',
    // The same 2025 county parcel layer the city's zoning and land use maps use. No owner names.
    path: 'VNY_CA_Parcels_2025/FeatureServer/446',
    fields: ['PARCEL_NO', 'SITE_FULL_ADDRESS', 'ACREAGE', 'SUB_NAME', 'PROP_TYPE_DESCR', 'GLA_WEIGHTED_YRBLT', 'MKT_CUR_VALUE', 'TAX_DISTRICT_DESCR'],
    geometry: 'polygon',
    pages: 3,
    minZoom: 14,
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
 * A filtered query on one of the allowlisted layers (only fields that layer already serves), for
 * server-side lookups such as finding where two roads meet. `where` must be built from sanitized text.
 */
export function layerQueryUrl(key: string, where: string, fields?: string[]): string | null {
  const layer = byKey.get(key);
  if (!layer) return null;
  const outFields = (fields ?? layer.fields).filter((f) => layer.fields.includes(f));
  const p = new URLSearchParams({ where, outFields: outFields.join(','), returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'geojson', resultRecordCount: '200' });
  return `${BASE}${layer.path}/query?${p.toString()}`;
}

