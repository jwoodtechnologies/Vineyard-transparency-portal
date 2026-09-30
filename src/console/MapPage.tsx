/**
 * /map : Vineyard's own map. City GIS layers (capital projects, zoning, future land use, parcels,
 * subdivisions, roads, parks, schools, businesses) served through the portal's API, drawn with
 * MapLibre on free OpenFreeMap basemaps. Click anything for details; search any road or project.
 */
import '@fontsource-variable/inter';
import './console.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, MapGeoJSONFeature } from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
// MapLibre parses tiles in a Web Worker; bundle it with the app and tell MapLibre where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, Crosshair, Layers, MessageSquare, Search, X } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { TopBar } from './Chrome';
import { getJson, type MapLayerInfo } from './api';

type FC = FeatureCollection<Geometry, Record<string, unknown>>;

type Base = 'streets' | 'satellite' | 'terrain' | 'blank';
const BASES: Array<{ id: Base; label: string }> = [
  { id: 'streets', label: 'Streets' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'terrain', label: 'Terrain' },
  { id: 'blank', label: 'Blank' },
];
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const USGS = (svc: string) => `https://basemap.nationalmap.gov/arcgis/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

/** Free basemaps only: OpenFreeMap streets, USGS imagery and topo (public domain), AWS open elevation tiles. */
function styleFor(base: Base, dark: boolean): string | maplibregl.StyleSpecification {
  if (base === 'streets') return dark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron';
  if (base === 'blank') return { version: 8, glyphs: GLYPHS, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#0a0a0b' : '#ffffff' } }] };
  if (base === 'satellite')
    return {
      version: 8,
      glyphs: GLYPHS,
      sources: { img: { type: 'raster', tiles: [USGS('USGSImageryOnly')], tileSize: 256, maxzoom: 16, attribution: USGS_ATTR } },
      layers: [{ id: 'img', type: 'raster', source: 'img' }],
    };
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      topo: { type: 'raster', tiles: [USGS('USGSTopo')], tileSize: 256, maxzoom: 16, attribution: USGS_ATTR },
      dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>' },
    },
    layers: [
      { id: 'topo', type: 'raster', source: 'topo', paint: dark ? { 'raster-brightness-max': 0.7, 'raster-saturation': -0.3 } : {} },
      { id: 'hill', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#2b2b30' } },
    ],
  };
}

const readBase = (v: string | null): Base | null => (v === 'streets' || v === 'satellite' || v === 'terrain' || v === 'blank' ? v : null);
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
  parcels: { color: '#5c5f66', kind: 'line', width: 0.8 },
  subdivisions: { color: '#1098ad', kind: 'fill', by: 'Subdivision', opacity: 0.14, width: 2.4, label: 'Subdivision', labelZoom: 12.5 },
  rda: { color: '#7048e8', kind: 'fill', opacity: 0.16, outline: '#5f3dc4', width: 2.6, dash: true, label: 'REDEV', labelZoom: 12 },
  rdaparcels: { color: '#7048e8', kind: 'fill', by: 'RDA', opacity: 0.3, width: 0.7, label: 'RDA', labelZoom: 15.5 },
  pdoverlay: { color: '#f76707', kind: 'fill', opacity: 0.12, outline: '#d9480f', width: 2.6, dash: true, label: 'GRANTEE', labelZoom: 12.5 },
  ura: { color: '#c2255c', kind: 'fill', opacity: 0.08, outline: '#c2255c', width: 3, dash: true, label: 'Name', labelZoom: 12 },
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
  pdoverlay: ['GRANTEE'],
  rda: ['REDEV', 'REDLAB'],
  watersedge: ['District', 'ZONE'],
  amenities: ['Facility'],
  trails: ['FULLNAME', 'Facilities'],
  rdaparcels: ['RDA', 'PARCEL_ADD'],
  ura: ['Name'],
  snowplow: ['ROADNAME'],
  evacroutes: ['ToCity', 'Direction'],
  evaczones: ['Zone'],
  crossings: ['School_Name'],
  greenspace: ['Category'],
  wayfinding: ['Description', 'Type'],
  boundary: ['NAME'],
};

const LABEL: Record<string, string> = {
  Project_Name: 'Project',
  Department: 'Department',
  Project_Phase: 'Phase',
  Phase_Status: 'Status',
  Total_Budget: 'Total budget',
  Funding_Source: 'Funding',
  Location: 'Location',
  Description: 'Description',
  Construction_Fiscal: 'Construction year',
  Start_Date: 'Starts',
  Finish_Date: 'Finishes',
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
  PROP_TYPE_DESCR: 'Property type',
  GLA_WEIGHTED_YRBLT: 'Year built',
  MKT_CUR_VALUE: 'Market value (county)',
  TAX_DISTRICT_DESCR: 'Tax district',
  GRANTEE: 'Planned development',
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
};

const HIDE = new Set(['OBJECTID', 'FID', 'GlobalID', 'Shape__Area', 'Shape__Length', '__c', '__label', 'CULDESAC', 'SITE_STATE']);

function fmt(key: string, v: unknown): string | null {
  if (v == null || v === '' || v === ' ') return null;
  if ((key === 'Total_Budget' || key === 'total_taxable' || key === 'MKT_CUR_VALUE') && Number.isFinite(Number(v))) return `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if ((key === 'OrdinanceDate' || key === 'LASTUPDATE') && Number.isFinite(Number(v)) && Number(v) > 1e11) return new Date(Number(v)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
    if (v) return layer === 'roads' ? streetOf(v) : v;
  }
  return 'Map feature';
}

function colorize(layer: string, fc: FC): FC {
  const by = LOOK[layer]?.by;
  if (!by) return fc;
  const values = [...new Set(fc.features.map((f) => String(f.properties?.[by] ?? '')))].sort();
  const idx = new Map(values.map((v, i) => [v, PALETTE[i % PALETTE.length]]));
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
const DATA_VERSION = 3;
const loaded = new Map<string, Promise<FC>>();
function loadLayer(info: MapLayerInfo): Promise<FC> {
  let p = loaded.get(info.key);
  if (!p) {
    p = Promise.all(Array.from({ length: info.pages }, (_, i) => getJson<FC>(`/api/map/layers/${info.key}?page=${i}&v=${DATA_VERSION}`)))
      .then((pages) => {
        const fc = colorize(info.key, { type: 'FeatureCollection', features: pages.flatMap((pg) => pg.features ?? []) });
        if (info.key !== 'roads') return fc;
        return { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, __label: titleWords(String(f.properties?.FULLNAME ?? '')) } })) };
      })
      .catch((e) => {
        loaded.delete(info.key);
        throw e;
      });
    loaded.set(info.key, p);
  }
  return p;
}

const FOCUS_LAYER: Record<string, string> = { road: 'roads', project: 'projects', park: 'parks', school: 'schools', business: 'businesses', subdivision: 'subdivisions' };
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
const SEARCHABLE = ['projects', 'roads', 'parks', 'schools', 'subdivisions', 'businesses', 'rda', 'ura'];
const DRAW_ORDER = ['landuse', 'zoning', 'watersedge', 'evaczones', 'rdaparcels', 'rda', 'ura', 'pdoverlay', 'subdivisions', 'greenspace', 'parks', 'projects', 'parcels', 'boundary', 'roads', 'snowplow', 'trails', 'evacroutes', 'amenities', 'wayfinding', 'businesses', 'crossings', 'schools'];

export default function MapPage() {
  const [params, setParams] = useSearchParams();
  const { resolved } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
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
  const [q, setQ] = useState('');
  const [zoom, setZoom] = useState(13);
  const [error, setError] = useState<string | null>(null);
  const hoverRef = useRef<{ source: string; id: string | number } | null>(null);
  const [base, setBase] = useState<Base>(() => readBase(params.get('base')) ?? savedBase() ?? 'streets');
  // Overlays and labels use the dark treatment on dark mode and on satellite imagery.
  const dark = resolved === 'dark' || base === 'satellite';
  const labelsRef = useRef(new Map<string, string>());
  const explicitLayers = useRef(Boolean(params.get('layers')));
  useEffect(() => {
    labelsRef.current = new Map((catalog ?? []).map((l) => [l.key, l.label]));
  }, [catalog]);

  // ?focus=road:Main St | project:Name | park:Name, from answers and records: applied once the map
  // and that layer's data are both ready.
  const focusRef = useRef<string | null>(params.get('focus'));
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
    const matches = fc.features.filter((f) => nameOf(layer, f.properties ?? {}).toLowerCase() === value);
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
    document.title = 'Map | Vineyard Transparency Portal';
  }, []);

  // Layer catalog, then the default layers (or the ones named in the address).
  useEffect(() => {
    getJson<{ layers: MapLayerInfo[] }>(`/api/map/layers?v=${DATA_VERSION}`).then(
      (j) => {
        setCatalog(j.layers);
        if (!explicitLayers.current) setOn((cur) => new Set([...j.layers.filter((l) => l.on).map((l) => l.key), ...cur]));
      },
      () => setError('The city map layers could not be loaded. Try again shortly.'),
    );
  }, []);

  // Map instance, re-styled when the theme changes.
  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({ container: box.current, style: styleFor(base, resolved === 'dark'), maxPitch: 70, bounds: VINEYARD, fitBoundsOptions: { padding: 24 }, attributionControl: false, maxZoom: 19, minZoom: 10 });
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Data: <a href="https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb" target="_blank" rel="noopener">Vineyard City Public GIS</a>' }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: base === 'terrain', visualizePitch: true }), 'bottom-right');
    // If the basemap service is unreachable, keep the city layers working on a plain background.
    let fellBack = false;
    map.on('error', () => {
      if (fellBack || map.isStyleLoaded()) return;
      fellBack = true;
      setTimeout(() => map.setStyle(styleFor('blank', resolved === 'dark') as maplibregl.StyleSpecification, { diff: false }), 0);
    });
    map.on('style.load', () => {
      if (base === 'terrain' && map.getSource('dem')) {
        map.setTerrain({ source: 'dem', exaggeration: 1.6 });
      }
      setReady(true);
      readyRef.current = true;
      setTimeout(() => applyRef.current(), 0);
    });
    // One click handler for every layer: the topmost feature under the pointer wins.
    map.on('click', (e) => {
      const ids = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => /^vtp-(?!pick|boundary)[a-z]+-(fill|line|circle)$/.test(id) && map.getLayoutProperty(id, 'visibility') !== 'none');
      const hits = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: ids });
      const order = (f: MapGeoJSONFeature) => (f.layer.type === 'circle' ? 0 : f.layer.type === 'line' && !f.layer.id.includes('parcels') ? 1 : 2);
      const f = [...hits].sort((a, b) => order(a) - order(b))[0];
      if (!f) return;
      const key = f.layer.id.replace(/^vtp-/, '').replace(/-(fill|line|circle)$/, '');
      setPicked({ layer: key, label: labelsRef.current.get(key) ?? '', name: nameOf(key, f.properties ?? {}), props: f.properties ?? {} });
      highlight(map, f);
    });
    map.on('zoomend', () => setZoom(map.getZoom()));
    mapRef.current = map;
    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [resolved, base]);

  // Fetch data for layers that are switched on (and the searchable ones, for the search box).
  useEffect(() => {
    if (!catalog) return;
    const want = catalog.filter((l) => on.has(l.key) || SEARCHABLE.includes(l.key) || l.key === 'boundary');
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
  }, [catalog, on, data]);

  // Draw: add sources and layers once per map instance, then toggle visibility.
  useEffect(() => {
    const map = mapRef.current;
    // After a style switch the new map may not have finished loading yet; it redraws on style.load.
    if (!map || !ready || !catalog || !map.isStyleLoaded()) return;
    try {
      drawLayers(map, catalog);
    } catch (e) {
      console.warn('map draw', e);
    }
    function drawLayers(map: maplibregl.Map, catalog: MapLayerInfo[]) {
    for (const key of DRAW_ORDER) {
      const fc = data[key];
      const info = catalog.find((l) => l.key === key);
      const look = LOOK[key];
      if (!fc || !info || !look) continue;
      const src = `vtp-${key}`;
      if (key === 'boundary' && !map.getSource(src) && !focusRef.current) {
        const b = boundsOf(fc.features);
        const pad = typeof window !== 'undefined' && window.innerWidth > 820 ? { top: 90, bottom: 30, left: 300, right: 30 } : 20;
        // Terrain opens tilted toward the mountains, still framed on Vineyard.
        if (b) map.fitBounds(b, base === 'terrain' ? { padding: pad, pitch: 50, bearing: -20, duration: 0 } : { padding: pad, duration: 0 });
      }
      if (!map.getSource(src)) {
        map.addSource(src, { type: 'geojson', data: fc, generateId: true });
        const color = look.by ? (['coalesce', ['get', '__c'], look.color] as unknown as string) : look.color;
        const edge = look.outline ?? color;
        const minzoom = info.minZoom ?? 0;
        const hover = (a: number, b: number) => ['case', ['boolean', ['feature-state', 'hover'], false], b, a] as unknown as number;
        const w = look.width ?? 1;
        if (key === 'boundary') {
          // Everything outside the city is dimmed and the line has a light casing, so the city edge is unmistakable.
          map.addSource('vtp-mask', { type: 'geojson', data: maskOf(fc) });
          map.addLayer({ id: 'vtp-mask-fill', type: 'fill', source: 'vtp-mask', paint: { 'fill-color': dark ? '#000000' : '#1b1b1f', 'fill-opacity': dark ? 0.42 : 0.16 } });
          map.addLayer({ id: `${src}-casing`, type: 'line', source: src, layout: { 'line-join': 'round' }, paint: { 'line-color': dark ? '#0a0a0b' : '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } });
          map.addLayer({ id: `${src}-line`, type: 'line', source: src, layout: { 'line-join': 'round' }, paint: { 'line-color': dark ? '#e6a9c6' : color, 'line-width': w } });
        } else if (look.kind === 'fill') {
          map.addLayer({ id: `${src}-fill`, type: 'fill', source: src, minzoom, paint: { 'fill-color': color, 'fill-opacity': hover(look.opacity ?? 0.2, Math.min(0.6, (look.opacity ?? 0.2) + 0.25)) } });
          map.addLayer({
            id: `${src}-line`,
            type: 'line',
            source: src,
            minzoom,
            layout: { 'line-join': 'round' },
            paint: { 'line-color': edge, 'line-width': hover(w, w + 2), 'line-opacity': 0.95, ...(look.dash ? { 'line-dasharray': [3, 2] } : {}) },
          });
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
              'line-opacity': key === 'parcels' ? 0.7 : 0.95,
              ...(look.dash ? { 'line-dasharray': [2, 1.5] } : {}),
            },
          });
        } else {
          map.addLayer({ id: `${src}-circle`, type: 'circle', source: src, minzoom, paint: { 'circle-color': color, 'circle-radius': hover(look.radius ?? 4, (look.radius ?? 4) + 3), 'circle-stroke-color': dark ? '#0a0a0b' : '#ffffff', 'circle-stroke-width': 2 } });
        }
        // Names on the map: neighborhoods, projects, zones, parks, schools and streets.
        if (look.label && map.getStyle().glyphs) {
          map.addLayer({
            id: `${src}-label`,
            type: 'symbol',
            source: src,
            minzoom: Math.max(minzoom, look.labelZoom ?? 13),
            layout: {
              'text-field': ['get', look.label],
              'text-font': ['Noto Sans Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 14],
              'text-max-width': 9,
              'text-padding': 4,
              ...(key === 'roads' ? { 'symbol-placement': 'line', 'text-size': 11 } : look.kind === 'circle' ? { 'text-offset': [0, 1.2], 'text-anchor': 'top' } : {}),
            },
            paint: { 'text-color': dark ? '#f5f5f6' : key === 'roads' ? '#7a2e05' : edge === color && look.by ? (['coalesce', ['get', '__c'], look.color] as unknown as string) : edge, 'text-halo-color': dark ? 'rgba(10,10,11,0.92)' : 'rgba(255,255,255,0.95)', 'text-halo-width': 1.8 },
          });
        }
        for (const id of [`${src}-fill`, `${src}-line`, `${src}-circle`]) {
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
      for (const id of [`${src}-fill`, `${src}-line`, `${src}-circle`, `${src}-label`]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    }
    }
  }, [ready, catalog, data, on, dark, base]);

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

  const toggle = (key: string) =>
    setOn((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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

  const ask = picked ? `/?q=${encodeURIComponent(picked.layer === 'roads' ? `What projects, decisions and plans involve ${picked.name} in Vineyard?` : picked.layer === 'projects' ? `What is the status of the ${picked.name} project?` : `Tell me about ${picked.name} in Vineyard.`)}` : '/';

  return (
    <div className="vc vc-map-page" data-state="page">
      <TopBar />
      <div className="vc-map-wrap">
        <div ref={box} className="vc-map" aria-label="Map of Vineyard, Utah" role="region" />

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
            <p className="vc-panel-label">Map style</p>
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
                {layers.map((l) => (
                  <label key={l.key} className="vc-map-layer" data-dim={l.minZoom != null && zoom < l.minZoom && on.has(l.key)}>
                    <span className="vc-map-swatch" data-kind={LOOK[l.key]?.kind} style={{ background: LOOK[l.key]?.color }} />
                    <span className="vc-map-lname">
                      {l.label}
                      {l.minZoom != null && zoom < l.minZoom && on.has(l.key) && <em> · zoom in</em>}
                    </span>
                    <input type="checkbox" className="vc-switch" checked={on.has(l.key)} onChange={() => toggle(l.key)} />
                  </label>
                ))}
              </div>
            ))}
            <p className="vc-panel-note">From the city&apos;s public GIS. Parcel owner names are not shown.</p>
          </aside>
        )}

        {picked && (
          <aside className="vc-map-card" aria-label="Details">
            <div className="vc-map-card-head">
              <span className="vc-map-kind">
                <span className="vc-map-swatch" style={{ background: LOOK[picked.layer]?.color }} /> {picked.label}
              </span>
              <button type="button" className="vc-ghost" data-icon-only="true" onClick={() => (setPicked(null), clearHighlight(mapRef.current))} aria-label="Close details">
                <X size={17} />
              </button>
            </div>
            <h2 className="vc-map-card-title">{picked.name}</h2>
            <dl className="vc-map-facts">
              {Object.entries(picked.props)
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

/** Keep a focused feature clear of the layers panel (left) and the details card (right/bottom). */
function fitPadding() {
  if (typeof window === 'undefined' || window.innerWidth <= 820) return { top: 90, bottom: 320, left: 40, right: 40 };
  return { top: 110, bottom: 80, left: 320, right: 420 };
}

function highlight(map: maplibregl.Map, f: Feature | FeatureCollection) {
  const data: FC = f.type === 'FeatureCollection' ? (f as FC) : { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: (f as Feature).geometry, properties: {} }] };
  const src = map.getSource('vtp-pick') as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else {
    map.addSource('vtp-pick', { type: 'geojson', data });
    map.addLayer({ id: 'vtp-pick-fill', type: 'fill', source: 'vtp-pick', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#7a2d52', 'fill-opacity': 0.18 } });
    map.addLayer({ id: 'vtp-pick-line', type: 'line', source: 'vtp-pick', paint: { 'line-color': '#7a2d52', 'line-width': 4, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'vtp-pick-pt', type: 'circle', source: 'vtp-pick', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 10, 'circle-color': 'rgba(122,45,82,0.2)', 'circle-stroke-color': '#7a2d52', 'circle-stroke-width': 2.5 } });
  }
}

function clearHighlight(map: maplibregl.Map | null) {
  const src = map?.getSource('vtp-pick') as GeoJSONSource | undefined;
  src?.setData({ type: 'FeatureCollection', features: [] });
}
