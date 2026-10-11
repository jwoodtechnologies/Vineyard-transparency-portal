/**
 * /map : Vineyard's own map. City GIS layers (capital projects, zoning, future land use, parcels,
 * subdivisions, roads, parks, schools, businesses) served through the portal's API, drawn with
 * MapLibre on free OpenFreeMap streets and Utah County aerial imagery. Click anything for details;
 * search any road or project. The basemap draws first; city layers are fetched in parallel and added
 * as they arrive, never holding the map back.
 */
import './styles';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, MapGeoJSONFeature } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
// MapLibre parses tiles in a Web Worker; bundle it with the app and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, Crosshair, Layers, MessageSquare, Search, X } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { TopBar } from './Chrome';
import { getJson, type MapLayerInfo } from './api';
import { ProjectDetail } from './ProjectDetail';
import { BASE_BG, blankStyle, byZoom, CASING, firstLabelLayer, GLYPHS, satelliteStyle, streetsBg, streetsStyle, watchSatellite, whenBasePainted } from './mapBase';
import { hasTile, loadedTileCount, loadTile, mergedParcels, tilesFor } from './parcelTiles';
import { FullscreenToggle } from './mapFullscreen';
import { FULL_ZOOM, levelFor, LINES_MIN_ZOOM, loadLines, MID_ZOOM, tapLooksUpParcel, tilesMinZoom, type LineFC, type LineLevel } from './parcelLines';
import { formatDate } from '@/lib/dates';
import { setHead } from '@/lib/head';

type FC = FeatureCollection<Geometry, Record<string, unknown>>;

type Base = 'streets' | 'satellite' | 'terrain' | 'blank';
const BASES: Array<{ id: Base; label: string }> = [
  { id: 'streets', label: 'Streets' },
  { id: 'satellite', label: 'Satellite' },
];
const USGS = (svc: string) => `https://basemap.nationalmap.gov/arcgis/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

/**
 * Free basemaps only: OpenFreeMap streets (fetched once per visit, see mapBase), Utah County aerial
 * imagery, USGS topo (public domain) and AWS open elevation tiles. Never rejects: if the streets
 * style cannot be reached the map draws on a plain background.
 */
function styleFor(base: Base, dark: boolean): Promise<maplibregl.StyleSpecification> {
  if (base === 'streets') return streetsStyle(dark).catch(() => blankStyle(dark));
  if (base === 'blank') return Promise.resolve(blankStyle(dark));
  if (base === 'satellite') return Promise.resolve(satelliteStyle());
  return Promise.resolve({
    version: 8,
    glyphs: GLYPHS,
    sources: {
      topo: { type: 'raster', tiles: [USGS('USGSTopo')], tileSize: 256, maxzoom: 16, attribution: USGS_ATTR },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>' },
      shade: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 14, encoding: 'terrarium' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': dark ? BASE_BG.blankDark : '#eef0ea' } },
      { id: 'topo', type: 'raster', source: 'topo', paint: dark ? { 'raster-brightness-max': 0.7, 'raster-saturation': -0.3 } : {} },
      { id: 'hill', type: 'hillshade', source: 'shade', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#2b2b30' } },
    ],
  });
}

/** The color the map box shows while a basemap loads: the basemap's own background. */
function bgFor(base: Base, dark: boolean): string {
  if (base === 'streets') return streetsBg(dark);
  if (base === 'satellite') return BASE_BG.satellite;
  return dark ? BASE_BG.blankDark : BASE_BG.blankLight;
}

const readBase = (v: string | null): Base | null => (v === 'streets' || v === 'satellite' ? v : null);
function savedBase(): Base | null {
  try {
    return readBase(localStorage.getItem('vtp:mapbase'));
  } catch {
    return null;
  }
}
const VINEYARD: LngLatBoundsLike = [
  [-111.772, 40.278],
  [-111.708, 40.338],
];

const PALETTE = ['#1c7ed6', '#e8590c', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c', '#5c940d', '#7048e8', '#c2255c', '#1098ad', '#e67700', '#495057', '#9c36b5', '#2b8a3e', '#364fc7'];

/** How each layer is drawn: [fill or line or circle color, and extras]. */
type Look = { color: string; kind: 'fill' | 'line' | 'circle'; by?: string; outline?: string; dash?: boolean; opacity?: number; width?: number; radius?: number; label?: string; labelZoom?: number };
const LOOK: Record<string, Look> = {
  boundary: { color: '#7a2d52', kind: 'line', width: 3.5 },
  projects: { color: '#d6336c', kind: 'fill', opacity: 0.28, outline: '#a61e4d', width: 2.2, label: 'Project_Name', labelZoom: 13 },
  zoning: { color: '#3b6ea8', kind: 'fill', by: 'ZONE', opacity: 0.22, width: 1.6, label: 'ZONE', labelZoom: 13 },
  landuse: { color: '#1f7a6c', kind: 'fill', by: 'Land_Use', opacity: 0.22, width: 1.4, label: 'Land_Use', labelZoom: 13 },
  parcels: { color: '#7048e8', kind: 'line', width: 1 },
  subdivisions: { color: '#1098ad', kind: 'fill', by: 'Subdivision', opacity: 0.14, width: 2.4, label: 'Subdivision', labelZoom: 12.5 },
  rda: { color: '#7048e8', kind: 'fill', opacity: 0.16, outline: '#5f3dc4', width: 2.6, dash: true, label: 'REDEV', labelZoom: 12 },
  rdaparcels: { color: '#7048e8', kind: 'fill', by: 'RDA', opacity: 0.3, width: 0.7, label: 'RDA', labelZoom: 15.5 },
  snowplow: { color: '#1c7ed6', kind: 'line', by: 'Priority', width: 2.5 },
  evacroutes: { color: '#e03131', kind: 'line', width: 3.5 },
  evaczones: { color: '#f08c00', kind: 'fill', by: 'Zone', opacity: 0.16, width: 2.4, label: 'Zone', labelZoom: 12 },
  crossings: { color: '#f59f00', kind: 'circle', radius: 6, label: 'School_Name', labelZoom: 14 },
  greenspace: { color: '#37b24d', kind: 'fill', by: 'Category', opacity: 0.3, width: 1 },
  wayfinding: { color: '#495057', kind: 'circle', radius: 4 },
  watersedge: { color: '#2f7fb8', kind: 'fill', by: 'ZONE', opacity: 0.18, width: 1.8, label: 'District', labelZoom: 13 },
  roads: { color: '#e8590c', kind: 'line', width: 2, label: '__label', labelZoom: 14.5 },
  trails: { color: '#0ca678', kind: 'line', width: 3, dash: true },
  parks: { color: '#2f9e44', kind: 'fill', opacity: 0.35, outline: '#2b8a3e', width: 2, label: 'NAME', labelZoom: 13 },
  amenities: { color: '#2e6e45', kind: 'circle', radius: 3.5 },
  schools: { color: '#1c7ed6', kind: 'circle', radius: 7, label: 'Name', labelZoom: 12.5 },
  businesses: { color: '#e67700', kind: 'circle', radius: 4.5 },
  udot: { color: '#5c7cfa', kind: 'line', width: 4, label: 'pin_desc', labelZoom: 14 },
};

/** Which property names a feature: used for search, the details card and "Ask about this". */
const NAME_FIELD: Record<string, string[]> = {
  projects: ['Project_Name'],
  roads: ['FULLNAME'],
  parks: ['NAME'],
  schools: ['Name'],
  businesses: ['Business_name'],
  subdivisions: ['Subdivision'],
  zoning: ['ZONE', 'District'],
  landuse: ['Land_Use'],
  parcels: ['SITE_FULL_ADDRESS', 'PARCEL_NO'],
  rda: ['REDEV', 'REDLAB'],
  watersedge: ['District', 'ZONE'],
  amenities: ['Facility'],
  trails: ['FULLNAME', 'Facilities'],
  rdaparcels: ['RDA', 'PARCEL_ADD'],
  snowplow: ['ROADNAME'],
  evacroutes: ['ToCity', 'Direction'],
  evaczones: ['Zone'],
  crossings: ['School_Name'],
  greenspace: ['Category'],
  wayfinding: ['Description', 'Type'],
  boundary: ['NAME'],
  udot: ['pin_desc'],
};

const LABEL: Record<string, string> = {
  Project_Name: 'Project',
  Department: 'Department',
  Project_Phase: 'Phase',
  Phase_Status: 'Phase progress',
  FY27_Budget: 'Budgeted for fiscal 2027',
  FY27_Source: 'Paid from',
  Total_Budget: 'Total budget',
  Funding_Source: 'Funding',
  Location: 'Location',
  Description: 'Description',
  Construction_Fiscal: 'Construction budgeted for',
  Start_Date: 'Start year (city estimate)',
  Finish_Date: 'Finish year (city estimate)',
  Consultant: 'Consultant',
  ZONE: 'Zone',
  District: 'District',
  Ordinance: 'Ordinance',
  OrdinanceDate: 'Ordinance date',
  ACRES: 'Acres',
  Acres: 'Acres',
  Land_Use: 'Land use',
  PARCEL_NO: 'Parcel number',
  PARCELID_LABEL: 'Parcel',
  ACREAGE: 'Acres',
  SITE_FULLADDRESS: 'Address',
  SITE_CITY: 'City',
  SITE_ZIP5: 'ZIP',
  Subdivision: 'Subdivision',
  Development: 'Development',
  Public_Private: 'Streets',
  REDEV: 'Area',
  REDLAB: 'Name',
  INCEPT: 'Created',
  YEAR_: 'Year',
  FULLNAME: 'Road',
  ROADCLASS: 'Class',
  ROW_WIDTH: 'Right of way (ft)',
  YearConst: 'Year built',
  FROMLEFT: 'Addresses from',
  TOLEFT: 'Addresses to',
  NAME: 'Name',
  TYPE: 'Type',
  STATUS: 'Status',
  Facility: 'Facility',
  Notes: 'Notes',
  Name: 'Name',
  Address: 'Address',
  Business_name: 'Business',
  Business_License_type: 'License type',
  Street_address: 'Address',
  Status: 'Status',
  Facilities: 'Facilities',
  Jurisdiction: 'Jurisdiction',
  RDA: 'RDA phase',
  SITE_FULL_ADDRESS: 'Address',
  SUB_NAME: 'Subdivision',
  PROP_TYPE_DESCR: 'Property type (2025 city parcel data)',
  GLA_WEIGHTED_YRBLT: 'Year built (2025 city parcel data)',
  MKT_CUR_VALUE: 'Market value (county)',
  TAX_DISTRICT_DESCR: 'Tax district',
  PARCEL_ID: 'Parcel',
  PARCEL_ADD: 'Address',
  acreage: 'Acres',
  total_taxable: 'Taxable value',
  ROADNAME: 'Road',
  Priority: 'Plow priority',
  Maintained: 'Maintained by',
  Direction: 'Direction',
  ToCity: 'Leads to',
  Zone: 'Zone',
  School_Name: 'School',
  Category: 'Category',
  Maintenance: 'Maintenance',
  Owner: 'Owner',
  pin: 'UDOT project number (PIN)',
  pin_desc: 'Project',
  pin_stat_nm: 'Status (UDOT)',
  proj_loc: 'Location',
  public_desc: 'Description',
  planned_construction_year: 'Planned construction year (UDOT)',
};

const HIDE = new Set(['OBJECTID', 'FID', 'GlobalID', 'Shape__Area', 'Shape__Length', '__c', '__label', '__src', '__loading', 'CULDESAC', 'SITE_STATE']);

/** Parcel outline colors: yellow on imagery and dark maps, violet on the light streets map. */
const parcelLine = (dark: boolean) => (dark ? '#ffd400' : '#7048e8');
/** A layer's look, with the parcel color for the current basemap. */
const lookOf = (key: string, dark: boolean): Look | undefined => (key === 'parcels' ? { ...LOOK.parcels, color: parcelLine(dark) } : LOOK[key]);

/** The parcel card from /api/map/parcel. */
interface ParcelCardResponse {
  found: boolean;
  properties: Record<string, string | number>;
  city: string[];
  geometry: Geometry | null;
}

function fmt(key: string, v: unknown): string | null {
  if (v == null || v === '' || v === ' ') return null;
  // A zero acreage, value or year built in the parcel records means not recorded.
  if ((key === 'ACREAGE' || key === 'MKT_CUR_VALUE' || key === 'GLA_WEIGHTED_YRBLT' || key === 'planned_construction_year') && Number(v) === 0) return null;
  if ((key === 'FY27_Budget' || key === 'Total_Budget' || key === 'total_taxable' || key === 'MKT_CUR_VALUE') && Number.isFinite(Number(v))) return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if ((key === 'OrdinanceDate' || key === 'LASTUPDATE') && Number.isFinite(Number(v)) && Number(v) > 1e11) return formatDate(new Date(Number(v)).toISOString());
  // City fiscal years run July to June: fiscal 2026 is July 2025 to June 2026.
  if (key === 'Construction_Fiscal' && /^\d{4}$/.test(String(v))) return `Fiscal year ${v} (July ${Number(v) - 1} to June ${v})`;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  const s = String(v).trim();
  return s && !/^(null|none|<null>)$/i.test(s) ? s : null;
}

const DIR = new Set(['N', 'S', 'E', 'W']);
const titleWords = (t: string) =>
  t
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (DIR.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
/** One street across its directional pieces: "W 1600 NORTH ST" and "E 1600 NORTH ST" are "1600 North St". */
const streetOf = (full: string) => titleWords(full.trim().replace(/^[NSEW]\s+(?=\S)/i, ''));

function nameOf(layer: string, p: Record<string, unknown>): string {
  for (const f of NAME_FIELD[layer] ?? []) {
    const v = fmt(f, p[f]);
    if (v) return layer === 'roads' ? streetOf(v) : layer === 'snowplow' ? titleWords(v) : layer === 'rda' || layer === 'rdaparcels' ? areaName(v, layer) : v;
  }
  return 'Map feature';
}

/** What each color means, for layers colored by a field (snow plow priority, zoning, land use). */
const LEGENDS = new Map<string, Array<[string, string]>>();
const LEGEND_TITLE: Record<string, string> = { snowplow: 'Snow plow priority', zoning: 'Zoning', landuse: 'Future land use', evaczones: 'Evacuation zone', greenspace: 'Green space', watersedge: "Water's Edge district", rdaparcels: 'RDA', subdivisions: 'Neighborhood' };
/**
 * Snow plow routes by the city's Priority field (1, 2, 4 or blank in the city GIS). Colors differ in
 * lightness as well as hue (dark orange, sky blue, yellow), line widths step down by priority, and
 * roads with no priority listed are a thin dashed gray, so the classes read without color too.
 */
const SNOW: Record<string, { color: string; width: number }> = {
  '1': { color: '#d55e00', width: 5 },
  '2': { color: '#56b4e9', width: 3.5 },
  '3': { color: '#009e73', width: 3 },
  '4': { color: '#f0e442', width: 3 },
};
const SNOW_NONE = { color: '#a6adb4', width: 2 };
const snowOf = (v: string) => SNOW[v] ?? (v.trim() ? { color: '#cc79a7', width: 3 } : SNOW_NONE);
/** Who maintains the roads of each plow priority, from the layer's Maintained field. */
const SNOW_BY = new Map<string, string[]>();
const snowPriority = (v: unknown) => (v == null || !String(v).trim() || /^null$/i.test(String(v)) ? 'No priority listed' : `Priority ${v}`);
function legendValue(layer: string, v: string): string {
  if (layer !== 'snowplow') return !v.trim() || /^null$/i.test(v) ? 'Not listed' : v;
  const by = SNOW_BY.get(v) ?? [];
  // Priorities whose roads the city does not maintain name who does (UDOT, Orem City).
  return by.length && !by.includes('Vineyard City') ? `${snowPriority(v)} (${by.join(', ')})` : snowPriority(v);
}
/** A color-coded layer's values in key order: numbers in order, blank last. */
function legendKeys(layer: string): string[] {
  const vals = (LEGENDS.get(layer) ?? []).map(([v]) => v);
  return [...vals].sort((a, b) => Number(!a.trim()) - Number(!b.trim()) || a.localeCompare(b, undefined, { numeric: true }));
}
/** A legend key line for a snow plow priority: its color, its width and, with no priority, dashes. */
const snowSwatch = (v: string): CSSProperties => {
  const s = snowOf(v);
  return {
    height: `${Math.max(3, s.width)}px`,
    width: '1.4rem',
    background: v.trim() ? s.color : `repeating-linear-gradient(90deg, ${s.color} 0 5px, transparent 5px 8px)`,
    boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
  };
};

function colorize(layer: string, fc: FC): FC {
  const by = LOOK[layer]?.by;
  if (!by) return fc;
  const values = [...new Set(fc.features.map((f) => String(f.properties?.[by] ?? '')))].sort();
  const idx = new Map(values.map((v, i) => [v, layer === 'snowplow' ? snowOf(v).color : PALETTE[i % PALETTE.length]]));
  if (layer === 'snowplow')
    for (const v of values) SNOW_BY.set(v, [...new Set(fc.features.filter((f) => String(f.properties?.[by] ?? '') === v).map((f) => fmt('Maintained', f.properties?.Maintained)).filter((m): m is string => Boolean(m)))].sort());
  LEGENDS.set(layer, values.map((v) => [v, idx.get(v) as string]));
  return { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __c: idx.get(String(f.properties?.[by] ?? '')) } })) };
}

/** The whole world with the city cut out, to dim everything outside Vineyard. */
function maskOf(fc: FC): FC {
  const holes: number[][][] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (g?.type === 'Polygon') holes.push(g.coordinates[0]);
    else if (g?.type === 'MultiPolygon') for (const p of g.coordinates) holes.push(p[0]);
  }
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ...holes] } }] };
}

function boundsOf(features: Feature[]): LngLatBoundsLike | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  for (const f of features) if (f.geometry && 'coordinates' in f.geometry) walk(f.geometry.coordinates);
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

interface Picked {
  layer: string;
  label: string;
  name: string;
  props: Record<string, unknown>;
}

/** Bumped when a layer's source or fields change, so cached copies are not reused. */
const DATA_VERSION = 10;
const loaded = new Map<string, Promise<FC>>();
/** Maps whose style has finished loading (tiles may still be streaming; layers can be added). */
const styleReady = new WeakSet<maplibregl.Map>();
function loadLayer(info: Pick<MapLayerInfo, 'key' | 'pages'>): Promise<FC> {
  const id = `${info.key}:${info.pages}`;
  let p = loaded.get(id);
  if (!p) {
    p = Promise.all(Array.from({ length: info.pages }, (_, i) => getJson<FC>(`/api/map/layers/${info.key}?page=${i}&v=${DATA_VERSION}`)))
      .then((pages) => {
        const fc = colorize(info.key, { type: 'FeatureCollection', features: pages.flatMap((pg) => pg.features ?? []) });
        if (info.key !== 'roads') return fc;
        return { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __label: titleWords(String(f.properties?.FULLNAME ?? '')) } })) };
      })
      .catch((e) => {
        loaded.delete(id);
        throw e;
      });
    loaded.set(id, p);
  }
  return p;
}

const FOCUS_LAYER: Record<string, string> = { road: 'roads', project: 'projects', park: 'parks', school: 'schools', business: 'businesses', subdivision: 'subdivisions', rda: 'rda', zone: 'zoning' };
const WORD: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w', street: 'st', road: 'rd', avenue: 'ave', drive: 'dr', lane: 'ln', boulevard: 'blvd', circle: 'cir', court: 'ct', parkway: 'pkwy', place: 'pl' };
/** "1200 North Main Street" and "1200 N Main St" match each other. */
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORD[w] ?? w)
    .join(' ');
/** Layers drawn from the API's fixed zoom tiles (fetched whole only as a fallback). */
const TILED = new Set(['parcels']);
/** Outline widths by zoom ([zoom, px]): each line sits on a dark casing about 2.5 to 3 px wider. */
const PARCEL_WIDTH: Array<[number, number]> = [[15, 1], [17, 1.7], [19, 3]];
const PARCEL_CASING: Array<[number, number]> = [[15, 2.8], [17, 3.8], [19, 5.8]];
/** City-wide parcel lines (zoom 12 to 15): hairlines at city view, meeting the tiles' width at zoom 16. */
const PLINE_WIDTH: Array<[number, number]> = [[12, 0.45], [13, 0.6], [14, 0.85], [16, 1.35]];
const PLINE_CASING: Array<[number, number]> = [[12, 1.3], [13, 1.6], [14, 2.2], [16, 3.3]];
const BOUNDARY_WIDTH: Array<[number, number]> = [[10, 1.8], [13, 2.6], [17, 5]];
const BOUNDARY_CASING: Array<[number, number]> = [[10, 4.5], [13, 5.6], [17, 8.5]];
const PROJECT_WIDTH: Array<[number, number]> = [[11, 1.4], [14, 2.2], [17, 3.6]];
const PROJECT_CASING: Array<[number, number]> = [[11, 3.4], [14, 4.6], [17, 6.6]];
/** The parcel collection each map's source last took. */
const parcelDrawn = new WeakMap<maplibregl.Map, FC>();
const SEARCHABLE = ['projects', 'roads', 'parks', 'schools', 'subdivisions', 'businesses', 'rda'];
const DRAW_ORDER = ['landuse', 'zoning', 'watersedge', 'evaczones', 'rdaparcels', 'rda', 'subdivisions', 'greenspace', 'parks', 'projects', 'parcels', 'plines', 'boundary', 'roads', 'snowplow', 'trails', 'evacroutes', 'udot', 'amenities', 'wayfinding', 'businesses', 'crossings', 'schools'];

/** Readable area names: "GENEVA PHASE 2-MEGAPLEX" becomes "Geneva Phase 2, Megaplex". */
function areaName(v: unknown, key: string): string {
  let t = String(v ?? '').trim();
  if (!t || t === 'null') return '';
  if (t === t.toUpperCase() && /[A-Z]{3}/.test(t)) t = t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Rda|Ura|Ldda|Pd|Cda)\b/g, (m) => m.toUpperCase());
  if (key === 'rda' || key === 'rdaparcels') t = t.replace(/([A-Za-z0-9])\s*-\s*(?=[A-Za-z])/g, '$1, ');
  return t;
}

type Ring = number[][];
const ringArea = (r: Ring) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
};
function ringCentroid(r: Ring): [number, number] {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    x += (r[j][0] + r[i][0]) * f;
    y += (r[j][1] + r[i][1]) * f;
    a += f;
  }
  if (!a) return [r[0][0], r[0][1]];
  return [x / (3 * a), y / (3 * a)];
}
function inRing(p: [number, number], r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
}

/** One label point per area feature, inside its largest part. */
function labelPoints(fc: FC, field: string, key: string): FC {
  const features = [];
  for (const f of fc.features) {
    const g = f.geometry as { type: string; coordinates: unknown } | null;
    if (!g) continue;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Ring[][];
    let best: Ring | null = null;
    let bestArea = -1;
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer?.length) continue;
      const a = ringArea(outer);
      if (a > bestArea) {
        best = outer;
        bestArea = a;
      }
    }
    if (!best) continue;
    let pt = ringCentroid(best);
    if (!inRing(pt, best)) {
      // Concave shape: use the middle of the widest horizontal span through its center line.
      const ys = best.map((c) => c[1]);
      const y = (Math.min(...ys) + Math.max(...ys)) / 2;
      const xs: number[] = [];
      for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
        const [x1, y1] = best[j], [x2, y2] = best[i];
        if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      let span = [pt[0], pt[0]];
      for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > span[1] - span[0]) span = [xs[i], xs[i + 1]];
      pt = [(span[0] + span[1]) / 2, y];
    }
    const label = areaName(f.properties?.[field], key);
    if (!label) continue;
    features.push({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: pt }, properties: { __label: label, __c: f.properties?.__c ?? null } });
  }
  return { type: 'FeatureCollection', features } as FC;
}

/** A specific question about the feature tapped on the map, built from its own details. */
function askFor(p: { layer: string; name: string; props: Record<string, unknown> }): string {
  const v = (k: string) => fmt(k, p.props[k]);
  const name = p.name;
  switch (p.layer) {
    case 'projects': {
      const bits = [v('Project_Phase') && `${v('Project_Phase')} phase`, v('FY27_Budget') && `fiscal 2027 budget ${v('FY27_Budget')}`].filter(Boolean).join(', ');
      return `What is the current status, fiscal 2027 budget, funding and schedule of the ${name} capital project${bits ? ` (${bits})` : ''}, and what has the City Council decided about it?`;
    }
    case 'roads':
      return `What capital projects, City Council decisions and plans involve ${name} in Vineyard?`;
    case 'parcels': {
      const addr = v('SITE_FULL_ADDRESS') || v('SITE_FULLADDRESS');
      const num = v('PARCEL_NO') || v('PARCELID_LABEL');
      return `What has the City Council or Planning Commission approved or discussed for ${addr ? `the property at ${addr}` : 'this property'}${num ? ` (parcel ${num})` : ''}, and how is it zoned?`;
    }
    case 'zoning':
      return `What does the ${v('ZONE') ?? name} zone${v('District') ? ` (${v('District')})` : ''} allow in Vineyard, and which ordinance${v('Ordinance') ? ` (${v('Ordinance')})` : ''} created or changed it?`;
    case 'landuse':
      return `What does Vineyard's General Plan say about the ${name} future land use designation?`;
    case 'rda':
    case 'rdaparcels':
      return `What is the ${name} redevelopment project area in Vineyard: when was it created, what is it for, and what has the Redevelopment Agency decided about it?`;
    case 'subdivisions':
      return `When was the ${name} subdivision approved in Vineyard, and what did the approval include?`;
    case 'parks':
    case 'greenspace':
      return `What plans, improvements and City Council decisions involve ${name} in Vineyard?`;
    case 'schools':
    case 'crossings':
      return `What City of Vineyard decisions, crossings or safety projects involve ${name}?`;
    case 'trails':
      return `What plans and projects involve the ${name} trail or bike route in Vineyard?`;
    case 'snowplow':
      return `What is the snow removal priority and route for ${name} in Vineyard?`;
    case 'evaczones':
    case 'evacroutes':
      return `What is Vineyard's evacuation plan for ${name}?`;
    case 'wayfinding':
      // Wayfinding points carry sign directions ("Continue East on Center Street..."), not names.
      return `What has Vineyard planned or installed for wayfinding signs${v('Type') ? ` (${v('Type')})` : ''}, and where do they go?`;
    case 'businesses':
      return `What has the City of Vineyard approved or discussed about ${name}?`;
    case 'udot':
      return `What has UDOT or Vineyard said about the ${name} project?`;
    case 'amenities':
      return `What plans, improvements and City Council decisions involve ${name} in Vineyard?`;
    default:
      return `What do Vineyard's records say about ${name}?`;
  }
}

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  const { resolved } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  // Counts loaded map styles. A basemap switch makes a new map whose style can load before React
  // renders the old map's "not ready", so `ready` alone may never change; this always does, and the
  // overlay layers are drawn again on the new map.
  const [mapGen, setMapGen] = useState(0);
  // False until the basemap has drawn its first screen: a small "Loading map" notice shows meanwhile.
  const [painted, setPainted] = useState(false);
  const [catalog, setCatalog] = useState<MapLayerInfo[] | null>(null);
  const [on, setOn] = useState<Set<string>>(() => {
    const s = new Set((params.get('layers') ?? '').split(',').filter(Boolean));
    const [kind, ...rest] = (params.get('focus') ?? '').split(':');
    const layer = kind === 'layer' ? rest.join(':') : FOCUS_LAYER[kind];
    if (layer) s.add(layer);
    return s;
  });
  const [data, setData] = useState<Record<string, FC>>({});
  const [picked, setPicked] = useState<Picked | null>(null);
  const [panel, setPanel] = useState(() => typeof window !== 'undefined' && window.innerWidth > 820);
  // The legend starts folded on phones so it never sits on top of the zoom buttons.
  const [legendOpen, setLegendOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 640);
  // Set when a color-coded layer is turned on: the legend opens with a short highlight.
  const [legendFlash, setLegendFlash] = useState(false);
  const [q, setQ] = useState('');
  const [zoom, setZoom] = useState(13);
  const [error, setError] = useState<string | null>(null);
  const hoverRef = useRef<{ source: string; id: string | number } | null>(null);
  const [base, setBase] = useState<Base>(() => readBase(params.get('base')) ?? savedBase() ?? 'streets');
  // True once the county parcel tiles have failed: the city's 2025 parcel layer is drawn instead.
  const [parcelFallback, setParcelFallback] = useState(false);
  const parcelFallbackRef = useRef(false);
  const parcelSeq = useRef(0);
  // City-wide parcel lines by level (zoom 12 to 15), and whether they could not be loaded (the
  // tiles then start at zoom 15, as before the lines existed).
  const [lines, setLines] = useState<Partial<Record<LineLevel, LineFC>>>({});
  const [linesFailed, setLinesFailed] = useState(false);
  // What a tap needs to know: are parcels on, and are lines (not tiles) drawn at this zoom.
  const parcelTapRef = useRef({ on: false, linesOk: false });
  // Overlays and labels use the dark treatment on dark mode and on satellite imagery.
  const dark = resolved === 'dark' || base === 'satellite';
  const darkRef = useRef(dark);
  const linesUrl = catalog?.find((l) => l.key === 'parcels')?.lines;
  const linesMinZoom = catalog?.find((l) => l.key === 'parcels')?.linesMinZoom ?? LINES_MIN_ZOOM;
  // Lines count as available while they load, so the zoom 15 tiles are not fetched meanwhile.
  const linesOk = Boolean(linesUrl) && !linesFailed;
  useEffect(() => {
    darkRef.current = dark;
    parcelFallbackRef.current = parcelFallback;
    parcelTapRef.current = { on: on.has('parcels'), linesOk };
  });
  const labelsRef = useRef(new Map<string, string>());
  const explicitLayers = useRef(Boolean(params.get('layers')));
  useEffect(() => {
    labelsRef.current = new Map((catalog ?? []).map((l) => [l.key, l.label]));
  }, [catalog]);

  // ?focus=road:Main St | project:Name | park:Name, from answers and records: applied once the map
  // and that layer's data are both ready.
  const focusRef = useRef<string | null>(params.get('focus'));
  // ?lat=..&lng=..&z=17&label=.. from answers about a place: the map opens centered there, with a marker.
  const pointRef = useRef(mapPoint(params));
  const dataRef = useRef<Record<string, FC>>({});
  const readyRef = useRef(false);
  const applyFocus = useCallback(() => {
    const focus = focusRef.current;
    const map = mapRef.current;
    if (!focus || !map || !readyRef.current) return;
    const [kind, ...rest] = focus.split(':');
    const value = rest.join(':').toLowerCase();
    const layer = FOCUS_LAYER[kind];
    if (!layer) {
      focusRef.current = null;
      return;
    }
    const fc = dataRef.current[layer];
    if (!fc) return;
    focusRef.current = null;
    // Exact name first ("1200 North" matches "1200 N"), then names that contain the words asked for.
    const want = norm(value);
    let matches = fc.features.filter((f) => norm(nameOf(layer, f.properties ?? {})) === want);
    if (!matches.length && want.length >= 4) matches = fc.features.filter((f) => ` ${norm(nameOf(layer, f.properties ?? {}))} `.includes(` ${want} `));
    if (!matches.length) return;
    const b = boundsOf(matches);
    if (b) map.fitBounds(b, { padding: fitPadding(), maxZoom: 16, duration: 800 });
    setPicked({ layer, label: labelsRef.current.get(layer) ?? '', name: nameOf(layer, matches[0].properties ?? {}), props: matches[0].properties ?? {} });
    highlight(map, matches.length === 1 ? matches[0] : { type: 'FeatureCollection', features: matches });
  }, []);
  const applyRef = useRef(applyFocus);
  useEffect(() => {
    applyRef.current = applyFocus;
    dataRef.current = data;
    readyRef.current = ready;
  }, [applyFocus, data, ready]);


  useEffect(() => {
    setHead('Map');
  }, []);

  // Layer catalog, then the default layers (or the ones named in the address). The city boundary
  // and any layers named in the address start loading now, alongside the catalog, not after it.
  useEffect(() => {
    for (const key of ['boundary', ...on]) if (LOOK[key] && !TILED.has(key)) loadLayer({ key, pages: 1 }).catch(() => undefined);
    getJson<{ layers: MapLayerInfo[] }>(`/api/map/layers?v=${DATA_VERSION}`).then(
      (j) => {
        setCatalog(j.layers);
        if (!explicitLayers.current) setOn((cur) => new Set([...j.layers.filter((l) => l.on).map((l) => l.key), ...cur]));
      },
      () => setError('The city map layers could not be loaded. Try again shortly.'),
    );
    // Only the layers named when the page opened are fetched early.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A parcel tapped on the map: its number shows at once, then the card fills from the county
  // records (and the city's 2025 layer for property type and year built).
  const pickParcel = useCallback((m: maplibregl.Map, ll: maplibregl.LngLat, props: Record<string, unknown>) => {
    const seq = ++parcelSeq.current;
    const label = labelsRef.current.get('parcels') ?? 'Parcels';
    const no = String(props.PARCEL_NO ?? '');
    // A tap on the city-wide lines has no parcel number yet: "Parcel" until the card arrives.
    const title = (p: Record<string, unknown>) => (p.PARCEL_NO || p.SITE_FULL_ADDRESS ? nameOf('parcels', p) : 'Parcel');
    setPicked({ layer: 'parcels', label, name: title(props), props: { ...props, __loading: true } });
    const shape = no ? dataRef.current.parcels?.features.find((f) => String(f.properties?.PARCEL_NO ?? '') === no)?.geometry : null;
    if (shape) highlightParcel(m, shape, darkRef.current);
    else clearHighlight(m);
    const settle = (next: Record<string, unknown>, geometry?: Geometry | null) => {
      if (seq !== parcelSeq.current) return;
      setPicked((p) => (p?.layer === 'parcels' ? { layer: 'parcels', label, name: title(next), props: next } : p));
      if (geometry && mapRef.current === m) highlightParcel(m, geometry, darkRef.current);
    };
    // Without county records, what the city's 2025 layer gave (fallback mode) or the number alone.
    const fromLayer = { ...props, __src: parcelFallbackRef.current ? 'city' : 'none' };
    // A tap on the city-wide lines carries no parcel number: no parcel there means no card.
    const nothing = () => {
      if (seq !== parcelSeq.current) return;
      setPicked((p) => (p?.layer === 'parcels' ? null : p));
      clearHighlight(m);
    };
    getJson<ParcelCardResponse>(`/api/map/parcel?lng=${ll.lng.toFixed(6)}&lat=${ll.lat.toFixed(6)}`).then(
      (r) => (r.found ? settle({ ...r.properties, __src: r.city.length ? 'county+city' : 'county' }, r.geometry) : no ? settle(fromLayer) : nothing()),
      () => settle(fromLayer),
    );
  }, []);
  const pickParcelRef = useRef(pickParcel);

  // Map instance, re-made when the theme or basemap changes. The style is ready at once for
  // satellite and plain maps, and after one fetch (kept for the visit) for streets.
  useEffect(() => {
    if (!box.current) return;
    let map: maplibregl.Map | null = null;
    let stopWatch = () => {};
    let cancelled = false;
    const isDark = resolved === 'dark';
    const create = (style: maplibregl.StyleSpecification) => {
      if (cancelled || !box.current) return;
      const point = pointRef.current;
      const m = new maplibregl.Map({ container: box.current, style, maxPitch: 70, ...(point ? { center: [point.lng, point.lat] as [number, number], zoom: point.zoom } : { bounds: VINEYARD, fitBoundsOptions: { padding: 24 } }), attributionControl: false, maxZoom: 19, minZoom: 10,
        // Simple movement: one finger pans, pinch and double tap zoom, the wheel zooms; nothing rotates or tilts by accident.
        dragRotate: false, touchPitch: false, pitchWithRotate: false, cooperativeGestures: false });
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();
      map = m;
      stopWatch = whenBasePainted(m, () => setPainted(true));
      if (base === 'satellite') watchSatellite(m);
      if (point) {
        const marker = new maplibregl.Marker({ color: '#f59f00' }).setLngLat([point.lng, point.lat]).addTo(m);
        if (point.label) {
          marker.getElement().setAttribute('aria-label', point.label);
          marker.getElement().setAttribute('title', point.label);
        }
      }
      m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Data: <a href="https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb" target="_blank" rel="noopener">Vineyard City Public GIS</a>' }), 'bottom-right');
      m.addControl(new maplibregl.NavigationControl({ showCompass: base === 'terrain', visualizePitch: true }), 'bottom-right');
      // Full screen sits above the zoom buttons (bottom corners stack upward) and takes the panel and card with it.
      m.addControl(new FullscreenToggle(() => wrapRef.current), 'bottom-right');
      // If the basemap fails before its style is ready, keep the city layers working on a plain background.
      let fellBack = false;
      m.on('error', () => {
        if (fellBack || styleReady.has(m)) return;
        fellBack = true;
        setTimeout(() => m.setStyle(blankStyle(isDark), { diff: false }), 0);
      });
      m.on('style.load', () => {
        styleReady.add(m);
        // The opening zoom, so "zoom in" hints are right before the first zoom gesture.
        setZoom(m.getZoom());
        if (base === 'terrain' && m.getSource('dem')) {
          m.setTerrain({ source: 'dem', exaggeration: 1.6 });
        }
        setReady(true);
        setMapGen((g) => g + 1);
        readyRef.current = true;
        setTimeout(() => applyRef.current(), 0);
      });
      // One click handler for every layer: the topmost feature under the pointer wins.
      m.on('click', (e) => {
        if (window.innerWidth <= 820) setPanel(false);
        const ids = (m.getStyle().layers ?? []).map((l) => l.id).filter((id) => /^vtp-(?!pick|boundary|mask)[a-z]+-(fill|line|dash|circle)$/.test(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
        const hits = m.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: ids });
        const order = (f: MapGeoJSONFeature) => (f.layer.type === 'circle' ? 0 : f.layer.type === 'line' && !f.layer.id.includes('parcels') ? 1 : 2);
        const f = [...hits].sort((a, b) => order(a) - order(b))[0];
        // Zoom 14 and 15 draw parcel lines with no shapes to tap: the parcel under the tap is looked
        // up instead, ahead of the areas drawn under parcels (as at zoom 16), behind points and lines.
        const tap = parcelTapRef.current;
        const fKey = f?.layer.id.replace(/^vtp-/, '').replace(/-(fill|line|dash|circle)$/, '');
        const under = !f || (order(f) === 2 && DRAW_ORDER.indexOf(fKey ?? '') < DRAW_ORDER.indexOf('parcels'));
        if (tap.on && under && tapLooksUpParcel(m.getZoom(), tap.linesOk)) {
          pickParcelRef.current(m, e.lngLat, {});
          return;
        }
        if (!f) return;
        const key = f.layer.id.replace(/^vtp-/, '').replace(/-(fill|line|dash|circle)$/, '');
        if (key === 'parcels') {
          pickParcelRef.current(m, e.lngLat, f.properties ?? {});
          return;
        }
        setPicked({ layer: key, label: labelsRef.current.get(key) ?? '', name: nameOf(key, f.properties ?? {}), props: f.properties ?? {} });
        highlight(m, f);
      });
      m.on('zoomend', () => setZoom(m.getZoom()));
      mapRef.current = m;
    };
    void styleFor(base, isDark).then(create);
    return () => {
      cancelled = true;
      stopWatch();
      setReady(false);
      setPainted(false);
      readyRef.current = false;
      (map as maplibregl.Map | null)?.remove();
      mapRef.current = null;
    };
  }, [resolved, base]);

  // Fetch data for layers that are switched on (and the searchable ones, for the search box).
  useEffect(() => {
    if (!catalog) return;
    // Tiled layers (parcels) are fetched whole only when their tiles have failed.
    const want = catalog.filter((l) => (!l.tiles || parcelFallback) && (on.has(l.key) || SEARCHABLE.includes(l.key) || l.key === 'boundary'));
    for (const l of want) {
      if (data[l.key]) continue;
      loadLayer(l).then(
        (fc) => {
          setData((d) => (d[l.key] ? d : { ...d, [l.key]: fc }));
          dataRef.current = { ...dataRef.current, [l.key]: fc };
          setTimeout(() => applyRef.current(), 0);
        },
        () => setError('Some map layers could not be loaded. Try again shortly.'),
      );
    }
  }, [catalog, on, data, parcelFallback]);

  // County parcel outlines: from zoom 15, the zoom 16 tiles covering the view are fetched (once
  // each, after the map stops moving) and drawn as one source. If the tiles fail before any has
  // loaded, the city's 2025 parcel layer is drawn instead.
  useEffect(() => {
    const map = mapRef.current;
    const template = catalog?.find((l) => l.key === 'parcels')?.tiles;
    if (!map || !ready || !template || parcelFallback || !on.has('parcels')) return;
    let stopped = false;
    let failed = 0;
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    let mergeTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      if (mergeTimer) return;
      mergeTimer = setTimeout(() => {
        mergeTimer = undefined;
        if (stopped) return;
        const fc = mergedParcels();
        dataRef.current = { ...dataRef.current, parcels: fc };
        setData((d) => ({ ...d, parcels: fc }));
      }, 150);
    };
    const refresh = () => {
      if (stopped || map.getZoom() < tilesMinZoom(linesOk)) return;
      const b = map.getBounds();
      for (const [x, y] of tilesFor({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() })) {
        if (hasTile(x, y)) continue;
        void loadTile(x, y, template).then((ok) => {
          if (stopped) return;
          if (ok) publish();
          else if (++failed >= 2 && loadedTileCount() === 0) setParcelFallback(true);
        });
      }
    };
    const onMove = () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(refresh, 250);
    };
    map.on('moveend', onMove);
    refresh();
    // Tiles loaded for an earlier map (before a basemap switch) are drawn at once.
    if (loadedTileCount() && !dataRef.current.parcels) publish();
    return () => {
      stopped = true;
      map.off('moveend', onMove);
      clearTimeout(moveTimer);
      clearTimeout(mergeTimer);
    };
  }, [ready, mapGen, catalog, on, parcelFallback, linesOk]);

  // City-wide parcel lines: the level for the zoom (low at 12 to 13, mid at 14 to 15) is fetched
  // once, when parcels are on and the map stops at that zoom. If a level cannot be loaded, the map
  // goes back to the tiles alone from zoom 15.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !linesUrl || linesFailed || !on.has('parcels')) return;
    let stopped = false;
    const refresh = () => {
      const level = levelFor(map.getZoom(), linesMinZoom);
      if (stopped || !level) return;
      void loadLines(linesUrl, level).then((fc) => {
        if (stopped) return;
        if (fc) setLines((cur) => (cur[level] === fc ? cur : { ...cur, [level]: fc }));
        else setLinesFailed(true);
      });
    };
    map.on('moveend', refresh);
    refresh();
    return () => {
      stopped = true;
      map.off('moveend', refresh);
    };
  }, [ready, mapGen, linesUrl, linesMinZoom, linesFailed, on]);

  // Draw: add sources and layers once per map instance, then toggle visibility.
  useEffect(() => {
    const map = mapRef.current;
    // After a style switch the new map may not have finished loading yet; it redraws on style.load.
    if (!map || !ready || !catalog || !styleReady.has(map)) return;
    try {
      drawLayers(map, catalog);
    } catch (e) {
      console.warn('map draw', e);
    }
    function drawLayers(map: maplibregl.Map, catalog: MapLayerInfo[]) {
    // Areas and outlines go above the basemap but under its labels, under every point and label
    // layer of ours, and under any layer that comes later in DRAW_ORDER, whatever was turned on first.
    const beforeFor = (key: string) => {
      const later = DRAW_ORDER.slice(DRAW_ORDER.indexOf(key) + 1);
      const ours = (l: { id: string; type: string }) => l.type === 'symbol' || l.type === 'circle' || l.id === 'vtp-mask-fill' || l.id.startsWith('vtp-pick') || later.some((k) => l.id.startsWith(`vtp-${k}-`));
      const mine = (map.getStyle().layers ?? []).find((l) => l.id.startsWith('vtp-') && ours(l))?.id;
      const labels = firstLabelLayer(map, (id) => id.startsWith('vtp-'));
      if (!mine) return labels;
      if (!labels) return mine;
      const ids = (map.getStyle().layers ?? []).map((l) => l.id);
      return ids.indexOf(mine) < ids.indexOf(labels) ? mine : labels;
    };
    for (const key of DRAW_ORDER) {
      const fc = data[key];
      const info = catalog.find((l) => l.key === key);
      const look = LOOK[key];
      const src = `vtp-${key}`;
      if (!fc || !info || !look) continue;
      if (key === 'boundary' && !map.getSource(src) && !focusRef.current && !pointRef.current) {
        const b = boundsOf(fc.features);
        const pad = typeof window !== 'undefined' && window.innerWidth > 820 ? { top: 90, bottom: 30, left: 300, right: 30 } : 20;
        // Terrain opens tilted toward the mountains, still framed on Vineyard.
        if (b) map.fitBounds(b, base === 'terrain' ? { padding: pad, pitch: 50, bearing: -20, duration: 0 } : { padding: pad, duration: 0 });
      }
      // Parcel outlines grow as tiles arrive: the source takes each new set.
      if (key === 'parcels' && map.getSource(src) && parcelDrawn.get(map) !== fc) {
        (map.getSource(src) as GeoJSONSource).setData(fc);
        parcelDrawn.set(map, fc);
      }
      if (!map.getSource(src)) {
        map.addSource(src, { type: 'geojson', data: fc, generateId: true });
        if (key === 'parcels') parcelDrawn.set(map, fc);
        const before = beforeFor(key);
        const color = look.by ? (['coalesce', ['get', '__c'], look.color] as unknown as string) : look.color;
        const edge = look.outline ?? color;
        const minzoom = info.minZoom ?? 0;
        const hover = (a: number, b: number) => ['case', ['boolean', ['feature-state', 'hover'], false], b, a] as unknown as number;
        const w = look.width ?? 1;
        const casing = (stops: Array<[number, number]>) => ({ 'line-color': CASING.color, 'line-opacity': CASING.opacity, 'line-width': byZoom(stops) });
        if (key === 'boundary') {
          // Everything outside the city is dimmed and the edge is a bright line on a dark casing, so it is unmistakable.
          map.addSource('vtp-mask', { type: 'geojson', data: maskOf(fc) });
          map.addLayer({ id: 'vtp-mask-fill', type: 'fill', source: 'vtp-mask', paint: { 'fill-color': dark ? '#000000' : '#1b1b1f', 'fill-opacity': dark ? 0.42 : 0.16 } }, before);
          map.addLayer({ id: `${src}-casing`, type: 'line', source: src, layout: { 'line-join': 'round' }, paint: casing(BOUNDARY_CASING) }, before);
          map.addLayer({ id: `${src}-line`, type: 'line', source: src, layout: { 'line-join': 'round' }, paint: { 'line-color': dark ? '#f783ac' : '#862e9c', 'line-width': byZoom(BOUNDARY_WIDTH) } }, before);
        } else if (key === 'parcels') {
          // A clear fill (so a tap anywhere inside picks the parcel), then the outline on its casing.
          const lc = parcelLine(dark);
          map.addLayer({ id: `${src}-fill`, type: 'fill', source: src, minzoom, paint: { 'fill-color': lc, 'fill-opacity': hover(0, 0.16) } }, before);
          map.addLayer({ id: `${src}-casing`, type: 'line', source: src, minzoom, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: casing(PARCEL_CASING) }, before);
          map.addLayer({ id: `${src}-line`, type: 'line', source: src, minzoom, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': lc, 'line-width': byZoom(PARCEL_WIDTH), 'line-opacity': 0.95 } }, before);
        } else if (look.kind === 'fill') {
          map.addLayer({ id: `${src}-fill`, type: 'fill', source: src, minzoom, paint: { 'fill-color': color, 'fill-opacity': hover(look.opacity ?? 0.2, Math.min(0.6, (look.opacity ?? 0.2) + 0.25)) } }, before);
          // Capital projects: a bright edge on a dark casing, thicker when zoomed in.
          if (key === 'projects') map.addLayer({ id: `${src}-casing`, type: 'line', source: src, minzoom, layout: { 'line-join': 'round' }, paint: casing(PROJECT_CASING) }, before);
          map.addLayer(
            {
              id: `${src}-line`,
              type: 'line',
              source: src,
              minzoom,
              layout: { 'line-join': 'round' },
              paint:
                key === 'projects'
                  ? { 'line-color': dark ? '#ff8fab' : edge, 'line-width': ['interpolate', ['linear'], ['zoom'], ...PROJECT_WIDTH.flatMap(([z, v]) => [z, hover(v, v + 2)])] as unknown as number, 'line-opacity': 1 }
                  : { 'line-color': edge, 'line-width': hover(w, w + 2), 'line-opacity': 0.95, ...(look.dash ? { 'line-dasharray': [3, 2] } : {}) },
            },
            before,
          );
        } else if (key === 'snowplow') {
          // Each priority on the same dark casing as the other lines; no priority listed is dashed.
          const pr = ['to-string', ['coalesce', ['get', 'Priority'], '']];
          const widthOf = (scale: number, extra: number) =>
            ['interpolate', ['linear'], ['zoom'], 12, ['match', pr, ...Object.entries(SNOW).flatMap(([v, s]) => [v, s.width * scale * 0.6 + extra]), '', SNOW_NONE.width * scale * 0.6 + extra, 3 * scale * 0.6 + extra], 17, ['match', pr, ...Object.entries(SNOW).flatMap(([v, s]) => [v, s.width * scale * 1.5 + extra]), '', SNOW_NONE.width * scale * 1.5 + extra, 3 * scale * 1.5 + extra]] as unknown as number;
          const listed = ['!=', pr, ''] as unknown as maplibregl.FilterSpecification;
          const unlisted = ['==', pr, ''] as unknown as maplibregl.FilterSpecification;
          map.addLayer({ id: `${src}-casing`, type: 'line', source: src, minzoom, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': CASING.color, 'line-opacity': CASING.opacity, 'line-width': widthOf(1, 2.5) } }, before);
          map.addLayer({ id: `${src}-dash`, type: 'line', source: src, minzoom, filter: unlisted, layout: { 'line-join': 'round' }, paint: { 'line-color': SNOW_NONE.color, 'line-width': widthOf(1, 0), 'line-dasharray': [2, 1.5] } }, before);
          map.addLayer({ id: `${src}-line`, type: 'line', source: src, minzoom, filter: listed, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': widthOf(1, 0), 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.95] as unknown as number } }, before);
        } else if (look.kind === 'line') {
          map.addLayer({
            id: `${src}-line`,
            type: 'line',
            source: src,
            minzoom,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': color,
              'line-width': key === 'roads' ? (['interpolate', ['linear'], ['zoom'], 12, ['case', ['boolean', ['feature-state', 'hover'], false], 3, 1.2], 17, ['case', ['boolean', ['feature-state', 'hover'], false], 9, 5]] as unknown as number) : hover(w, w + 1.5),
              'line-opacity': 0.95,
              ...(look.dash ? { 'line-dasharray': [2, 1.5] } : {}),
            },
          }, before);
        } else {
          map.addLayer({ id: `${src}-circle`, type: 'circle', source: src, minzoom, paint: { 'circle-color': color, 'circle-radius': hover(look.radius ?? 4, (look.radius ?? 4) + 3), 'circle-stroke-color': dark ? '#0a0a0b' : '#ffffff', 'circle-stroke-width': 2 } });
        }
        // Names on the map: neighborhoods, projects, zones, parks, schools and streets. Areas get
        // exactly one label each (at their largest part), never one per tile or per piece.
        const areaLabels = look.kind === 'fill' && key !== 'boundary';
        if (look.label && map.getStyle().glyphs && areaLabels && !map.getSource(`${src}-pts`)) map.addSource(`${src}-pts`, { type: 'geojson', data: labelPoints(fc, look.label, key) });
        if (look.label && map.getStyle().glyphs) {
          map.addLayer({
            id: `${src}-label`,
            type: 'symbol',
            source: areaLabels ? `${src}-pts` : src,
            minzoom: Math.max(minzoom, look.labelZoom ?? 13),
            layout: {
              'text-field': ['get', areaLabels ? '__label' : look.label],
              'text-font': ['Noto Sans Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14],
              'text-max-width': 9,
              'text-padding': 4,
              ...(key === 'roads' ? { 'symbol-placement': 'line', 'text-size': 11 } : look.kind === 'circle' ? { 'text-offset': [0, 1.2], 'text-anchor': 'top' } : {}),
            },
            paint: { 'text-color': dark ? '#f5f5f6' : key === 'roads' ? '#7a2e05' : edge === color && look.by ? (['coalesce', ['get', '__c'], look.color] as unknown as string) : edge, 'text-halo-color': dark ? 'rgba(10,10,11,0.92)' : 'rgba(255,255,255,0.95)', 'text-halo-width': 1.8 },
          });
        }
        for (const id of [`${src}-fill`, `${src}-line`, `${src}-dash`, `${src}-circle`]) {
          if (!map.getLayer(id) || key === 'boundary') continue;
          map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'));
          map.on('mousemove', id, (e) => {
            const f = e.features?.[0];
            if (!f || f.id == null) return;
            const cur = hoverRef.current;
            if (cur && (cur.source !== src || cur.id !== f.id)) map.setFeatureState(cur, { hover: false });
            hoverRef.current = { source: src, id: f.id };
            map.setFeatureState(hoverRef.current, { hover: true });
          });
          map.on('mouseleave', id, () => {
            map.getCanvas().style.cursor = '';
            if (hoverRef.current) map.setFeatureState(hoverRef.current, { hover: false });
            hoverRef.current = null;
          });
        }
      }
      const vis = on.has(key) || key === 'boundary' ? 'visible' : 'none';
      for (const id of [`${src}-fill`, `${src}-casing`, `${src}-line`, `${src}-dash`, `${src}-circle`, `${src}-label`]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      // With the city-wide lines, the tiles draw from zoom 16; without them, from zoom 15.
      if (key === 'parcels') for (const id of [`${src}-fill`, `${src}-casing`, `${src}-line`]) if (map.getLayer(id)) map.setLayerZoomRange(id, linesOk ? FULL_ZOOM : (info.minZoom ?? 0), 24);
    }
    drawLines(map, beforeFor);
    }
    // The parcel lines below zoom 16: low up to zoom 14 (or 16 until mid arrives), mid from 14 to 16.
    function drawLines(map: maplibregl.Map, beforeFor: (key: string) => string | undefined) {
      const lc = parcelLine(dark);
      for (const level of ['low', 'mid'] as const) {
        const fc = lines[level];
        const src = `vtp-plines-${level}`;
        if (!fc) continue;
        const min = level === 'low' ? linesMinZoom : MID_ZOOM;
        const max = level === 'low' && lines.mid ? MID_ZOOM : FULL_ZOOM;
        if (!map.getSource(src)) {
          // Lines need no detail beyond the zoom they are drawn at: fewer tiles to cut.
          map.addSource(src, { type: 'geojson', data: fc, maxzoom: level === 'low' ? 13 : 15, buffer: 16 });
          const before = beforeFor('plines');
          // A dark casing on imagery and dark maps; the light streets map takes the violet line alone.
          if (dark) map.addLayer({ id: `${src}-casing`, type: 'line', source: src, minzoom: min, maxzoom: max, layout: { 'line-join': 'round' }, paint: { 'line-color': CASING.color, 'line-opacity': CASING.opacity, 'line-width': byZoom(PLINE_CASING) } }, before);
          map.addLayer({ id: `${src}-line`, type: 'line', source: src, minzoom: min, maxzoom: max, layout: { 'line-join': 'round' }, paint: { 'line-color': lc, 'line-width': byZoom(PLINE_WIDTH), 'line-opacity': 0.9 } }, before);
          // For measuring (scripts/perf map-perf): when this level first finishes drawing.
          map.once('idle', () => performance.mark?.(`vtp-parcel-lines-${level}`));
        }
        for (const id of [`${src}-casing`, `${src}-line`]) {
          if (!map.getLayer(id)) continue;
          map.setLayoutProperty(id, 'visibility', on.has('parcels') ? 'visible' : 'none');
          map.setLayerZoomRange(id, min, max);
        }
      }
    }
  }, [ready, mapGen, catalog, data, on, dark, base, lines, linesOk, linesMinZoom]);

  const results = useMemo(() => {
    const raw = q.trim().toLowerCase();
    if (raw.length < 2) return [];
    const term = norm(raw);
    const out: Array<{ layer: string; name: string; features: Feature[] }> = [];
    for (const layer of SEARCHABLE) {
      const groups = new Map<string, Feature[]>();
      for (const f of data[layer]?.features ?? []) {
        const n = nameOf(layer, (f.properties ?? {}) as Record<string, unknown>);
        if (norm(n).includes(term) || n.toLowerCase().includes(raw)) groups.set(n, [...(groups.get(n) ?? []), f]);
      }
      for (const [name, features] of groups) out.push({ layer, name, features });
    }
    return out.sort((a, b) => Number(!norm(a.name).startsWith(term)) - Number(!norm(b.name).startsWith(term)) || a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 12);
  }, [q, data]);

  const go = useCallback(
    (r: { layer: string; name: string; features: Feature[] }) => {
      const map = mapRef.current;
      if (!map) return;
      setOn((cur) => new Set([...cur, r.layer]));
      const b = boundsOf(r.features);
      if (b) map.fitBounds(b, { padding: fitPadding(), maxZoom: 16, duration: 800 });
      setPicked({ layer: r.layer, label: catalog?.find((l) => l.key === r.layer)?.label ?? '', name: r.name, props: (r.features[0].properties ?? {}) as Record<string, unknown> });
      highlight(map, r.features.length === 1 ? r.features[0] : { type: 'FeatureCollection', features: r.features });
      setQ('');
      const kind = Object.entries(FOCUS_LAYER).find(([, v]) => v === r.layer)?.[0];
      const next = new URLSearchParams(params);
      next.set('focus', kind ? `${kind}:${r.name}` : `layer:${r.layer}`);
      focusRef.current = null;
      setParams(next, { replace: true });
    },
    [catalog, params, setParams],
  );

  const toggle = (key: string) => {
    const adding = !on.has(key);
    setOn((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // A layer colored by value opens the legend and briefly highlights it, so its key is seen.
    if (adding && LOOK[key]?.by) {
      setLegendOpen(true);
      setLegendFlash(true);
    }
  };

  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => mapRef.current?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 16 }),
      () => setError('Your location is not available.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );

  const groups = useMemo(() => {
    const g = new Map<string, MapLayerInfo[]>();
    for (const l of catalog ?? []) if (l.key !== 'boundary') g.set(l.group, [...(g.get(l.group) ?? []), l]);
    const order = ['Plans', 'Land', 'Streets', 'Places', 'Safety'];
    return [...g.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [catalog]);

  const ask = picked ? `/?q=${encodeURIComponent(askFor(picked))}` : '/';

  return (
    <div className="vc vc-map-page" data-state="page">
      <TopBar />
      <div className="vc-map-wrap" ref={wrapRef} data-panel={panel} data-card={Boolean(picked)}>
        <div ref={box} className="vc-map" aria-label="Map of Vineyard, Utah" role="region" style={{ background: bgFor(base, resolved === 'dark') }} />
        {!painted && (
          <div className="vc-map-loading" role="status">
            <span className="vc-map-loading-dot" aria-hidden="true" />
            Loading map
          </div>
        )}

        <div className="vc-map-top">
          <div className="vc-map-search">
            <Search size={16} strokeWidth={1.9} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a road, project, park or school" aria-label="Search the map" onKeyDown={(e) => e.key === 'Enter' && results[0] && go(results[0])} />
            {q && (
              <button type="button" className="vc-map-x" onClick={() => setQ('')} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
            {results.length > 0 && (
              <ul className="vc-map-results" role="listbox">
                {results.map((r) => (
                  <li key={`${r.layer}:${r.name}`}>
                    <button type="button" onClick={() => go(r)}>
                      <span className="vc-map-swatch" style={{ background: LOOK[r.layer]?.color }} />
                      <span className="vc-map-rname">{r.name}</span>
                      <span className="vc-map-rkind">{catalog?.find((l) => l.key === r.layer)?.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="vc-map-fab" onClick={() => setPanel((p) => !p)} aria-expanded={panel} aria-label="Map layers">
            <Layers size={17} strokeWidth={1.9} />
            <span className="vc-nav-text">Layers</span>
            <ChevronDown size={14} className="vc-map-chev" data-open={panel} />
          </button>
          <button type="button" className="vc-map-fab" data-icon-only="true" onClick={locate} aria-label="Show my location">
            <Crosshair size={17} strokeWidth={1.9} />
          </button>
        </div>

        {panel && (
          <aside className="vc-map-panel" aria-label="Layers">
            <div className="vc-map-panel-head">
              <p className="vc-panel-label">Map style</p>
              <button type="button" className="vc-map-close" onClick={() => setPanel(false)} aria-label="Close layers">
                <X size={16} strokeWidth={2} /> <span>Done</span>
              </button>
            </div>
            <div className="vc-segment vc-map-bases" role="radiogroup" aria-label="Map style">
              {BASES.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={base === b.id}
                  data-on={base === b.id}
                  onClick={() => {
                    setBase(b.id);
                    try {
                      localStorage.setItem('vtp:mapbase', b.id);
                    } catch {
                      /* private mode */
                    }
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
            {!catalog && <div className="vc-skeleton" aria-hidden="true"><span style={{ width: '80%' }} /><span style={{ width: '60%' }} /></div>}
            {groups.map(([group, layers]) => (
              <div key={group} className="vc-map-group">
                <p className="vc-panel-label">{group}</p>
                {layers.map((l) => {
                  // Parcels show from city view with the prebuilt lines, from zoom 15 without them.
                  const minZ = l.key === 'parcels' && linesOk ? linesMinZoom : l.minZoom;
                  const far = minZ != null && zoom < minZ && on.has(l.key);
                  return (
                  <Fragment key={l.key}>
                  <label className="vc-map-layer" data-dim={far}>
                    <span className="vc-map-swatch" data-kind={LOOK[l.key]?.kind} style={{ background: lookOf(l.key, dark)?.color }} />
                    <span className="vc-map-lname">
                      {l.label}
                      {far && <em> · zoom in</em>}
                    </span>
                    <input type="checkbox" className="vc-switch" checked={on.has(l.key)} onChange={() => toggle(l.key)} />
                  </label>
                  {l.key === 'snowplow' && on.has(l.key) && (
                    <ul className="vc-map-layer-key" aria-label="Snow plow priority key">
                      {legendKeys('snowplow').map((v) => (
                        <li key={v || 'none'}>
                          <span className="vc-map-swatch" data-kind="line" style={snowSwatch(v)} />
                          {legendValue('snowplow', v)}
                        </li>
                      ))}
                    </ul>
                  )}
                  </Fragment>
                  );
                })}
              </div>
            ))}
            <p className="vc-panel-note">From the city&apos;s public GIS. Parcel lines from Utah County GIS. No owner names are shown.</p>
          </aside>
        )}

        {!panel && !picked && (() => {
          // Every layer on the map, in drawing order: one swatch, or one per value for color-coded layers.
          const shown = DRAW_ORDER.filter((k) => on.has(k) && (data[k] || catalog?.some((l) => l.key === k && l.tiles))).reverse();
          if (!shown.length) return null;
          const name = (k: string) => catalog?.find((l) => l.key === k)?.label ?? k;
          return (
            <aside className="vc-map-legend" data-open={legendOpen} data-flash={legendFlash} onAnimationEnd={() => setLegendFlash(false)} aria-label="Legend">
              <button type="button" className="vc-map-legend-toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen((o) => !o)}>
                <span className="vc-map-legend-dots" aria-hidden="true">
                  {shown.slice(0, 3).map((k) => (
                    <span key={k} className="vc-map-swatch" data-kind={LOOK[k]?.kind} style={{ background: lookOf(k, dark)?.outline ?? lookOf(k, dark)?.color }} />
                  ))}
                </span>
                Legend
                <ChevronDown size={14} className="vc-map-chev" data-open={legendOpen} />
              </button>
              {legendOpen && (
                <div className="vc-map-legend-body">
                  {shown.map((k) => {
                  const values = LOOK[k]?.by ? LEGENDS.get(k) : null;
                  if (values && (values.length > 1 || k === 'snowplow') && values.length <= 16)
                    return (
                      <div key={k}>
                        <p className="vc-map-legend-title">{LEGEND_TITLE[k] ?? name(k)}</p>
                        <ul>
                          {legendKeys(k).map((v) => [v, values.find((x) => x[0] === v)?.[1] ?? ''] as const).map(([v, c]) => (
                            <li key={v || 'none'}>
                              <span className="vc-map-swatch" data-kind={LOOK[k]?.kind} style={k === 'snowplow' ? snowSwatch(v) : { background: c }} />
                              {legendValue(k, v)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  return (
                    <ul key={k}>
                      <li>
                        <span className="vc-map-swatch" data-kind={LOOK[k]?.kind} style={{ background: lookOf(k, dark)?.outline ?? lookOf(k, dark)?.color }} />
                        {name(k)}
                        {values && values.length > 16 ? ' (colored by area)' : ''}
                      </li>
                    </ul>
                  );
                })}
                </div>
              )}
            </aside>
          );
        })()}

        {picked && (
          <aside className="vc-map-card" aria-label="Details">
            <div className="vc-map-card-head">
              <span className="vc-map-kind">
                <span className="vc-map-swatch" style={{ background: lookOf(picked.layer, dark)?.color }} /> {picked.label}
              </span>
              <button type="button" className="vc-ghost" data-icon-only="true" onClick={() => (setPicked(null), clearHighlight(mapRef.current))} aria-label="Close details">
                <X size={17} />
              </button>
            </div>
            <h2 className="vc-map-card-title">{picked.name}</h2>
            <dl className="vc-map-facts">
              {picked.layer === 'snowplow' ? (
                <>
                  <div>
                    <dt>Plow priority</dt>
                    <dd>
                      <span className="vc-map-swatch" data-kind="line" style={snowSwatch(fmt('Priority', picked.props.Priority) ?? '')} /> {snowPriority(fmt('Priority', picked.props.Priority))}
                    </dd>
                  </div>
                  <div>
                    <dt>Maintained by</dt>
                    <dd>{fmt('Maintained', picked.props.Maintained) ?? 'Not listed'}</dd>
                  </div>
                  {fmt('ROADCLASS', picked.props.ROADCLASS) && (
                    <div>
                      <dt>Road class</dt>
                      <dd>{fmt('ROADCLASS', picked.props.ROADCLASS)}</dd>
                    </div>
                  )}
                </>
              ) : Object.entries(picked.props)
                .filter(([k]) => !HIDE.has(k) && !(NAME_FIELD[picked.layer] ?? []).slice(0, 1).includes(k))
                .map(([k, v]) => [k, fmt(k, v)] as const)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} data-wide={String(v).length > 48}>
                    <dt>{LABEL[k] ?? k.replace(/_/g, ' ')}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {picked.layer === 'parcels' && (
              <p className="vc-map-note">
                {picked.props.__loading
                  ? 'Loading parcel details.'
                  : picked.props.__src === 'county+city'
                    ? `Current Utah County GIS records. ${[picked.props.PROP_TYPE_DESCR != null && 'Property type', picked.props.GLA_WEIGHTED_YRBLT != null && 'year built'].filter(Boolean).join(' and ').replace(/^y/, 'Y')} ${picked.props.PROP_TYPE_DESCR != null && picked.props.GLA_WEIGHTED_YRBLT != null ? 'are' : 'is'} from 2025 city parcel data.`
                    : picked.props.__src === 'county'
                      ? 'Current Utah County GIS records.'
                      : picked.props.__src === 'city'
                        ? 'From 2025 city parcel data (a copy of Utah County records).'
                        : 'Parcel details could not be loaded right now. Try again shortly.'}
              </p>
            )}
            {picked.layer === 'projects' && typeof picked.props.Project_Name === 'string' && (
              <ProjectDetail key={picked.props.Project_Name} project={{ gis: picked.props.Project_Name }} budget="source" />
            )}
            <div className="vc-map-card-actions">
              <Link to={ask} className="vc-primary">
                <MessageSquare size={15} strokeWidth={1.8} /> Ask about this
              </Link>
            </div>
          </aside>
        )}

        {error && (
          <div className="vc-map-toast" role="status" onClick={() => setError(null)}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/** A point from the address (?lat=..&lng=..&z=..&label=..), checked to be a real coordinate near Vineyard. */
function mapPoint(params: URLSearchParams): { lat: number; lng: number; zoom: number; label: string | null } | null {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (!params.get('lat') || !params.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // Utah County and around: anything else is a mistyped link, and the map opens on the city instead.
  if (lat < 39 || lat > 41.5 || lng < -113 || lng > -110.5) return null;
  const z = Number(params.get('z'));
  return { lat, lng, zoom: Number.isFinite(z) && z > 0 ? Math.max(10, Math.min(19, z)) : 17, label: params.get('label')?.slice(0, 120) || null };
}

/** Keep a focused feature clear of the layers panel (left) and the details card (right/bottom). */
function fitPadding() {
  if (typeof window === 'undefined' || window.innerWidth <= 820) return { top: 90, bottom: 320, left: 40, right: 40 };
  return { top: 110, bottom: 80, left: 320, right: 420 };
}

function highlight(map: maplibregl.Map, f: Feature | FeatureCollection) {
  (map.getSource('vtp-pickp') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
  const data: FC = f.type === 'FeatureCollection' ? (f as FC) : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: (f as Feature).geometry, properties: {} }] };
  const src = map.getSource('vtp-pick') as GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    // Keep the highlight above any layer turned on since.
    for (const id of ['vtp-pick-fill', 'vtp-pick-glow', 'vtp-pick-line', 'vtp-pick-pt']) if (map.getLayer(id)) map.moveLayer(id);
  } else {
    map.addSource('vtp-pick', { type: 'geojson', data });
    map.addLayer({ id: 'vtp-pick-fill', type: 'fill', source: 'vtp-pick', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ffd43b', 'fill-opacity': 0.4 } });
    // What was asked about stands out in bright yellow, with a dark edge so it reads on any base map.
    map.addLayer({ id: 'vtp-pick-glow', type: 'line', source: 'vtp-pick', paint: { 'line-color': '#5c3d00', 'line-width': 11, 'line-opacity': 0.55, 'line-blur': 1 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'vtp-pick-line', type: 'line', source: 'vtp-pick', paint: { 'line-color': '#ffd43b', 'line-width': 7, 'line-opacity': 1 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'vtp-pick-pt', type: 'circle', source: 'vtp-pick', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 11, 'circle-color': 'rgba(255,212,59,0.55)', 'circle-stroke-color': '#5c3d00', 'circle-stroke-width': 3 } });
  }
}

function clearHighlight(map: maplibregl.Map | null) {
  for (const id of ['vtp-pick', 'vtp-pickp']) (map?.getSource(id) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
}

/** The selected parcel: a translucent fill in the parcel color and a stronger outline on a dark casing. */
function highlightParcel(map: maplibregl.Map, geometry: Geometry, dark: boolean) {
  (map.getSource('vtp-pick') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
  const data: FC = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: {} }] };
  const ids = ['vtp-pickp-fill', 'vtp-pickp-casing', 'vtp-pickp-line'];
  const src = map.getSource('vtp-pickp') as GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    for (const id of ids) if (map.getLayer(id)) map.moveLayer(id);
    return;
  }
  const lc = parcelLine(dark);
  map.addSource('vtp-pickp', { type: 'geojson', data });
  map.addLayer({ id: ids[0], type: 'fill', source: 'vtp-pickp', paint: { 'fill-color': lc, 'fill-opacity': 0.3 } });
  map.addLayer({ id: ids[1], type: 'line', source: 'vtp-pickp', layout: { 'line-join': 'round' }, paint: { 'line-color': CASING.color, 'line-opacity': 0.7, 'line-width': byZoom([[15, 5], [17, 6.5], [19, 9]]) } });
  map.addLayer({ id: ids[2], type: 'line', source: 'vtp-pickp', layout: { 'line-join': 'round' }, paint: { 'line-color': lc, 'line-width': byZoom([[15, 2.6], [17, 3.6], [19, 5.5]]) } });
}
