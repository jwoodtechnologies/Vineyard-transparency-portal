/**
 * The street level 3D view, where no street photo exists near the pin: the map tilts close over the pin on
 * real terrain (AWS Terrain Tiles, with a soft hillshade under the aerial photos), so the Wasatch, the lake
 * shore and the ground's rise and fall show, and OpenFreeMap's buildings are raised to their recorded
 * heights. A light blue sky with a soft horizon replaces the black above it. Leaving puts all of it back.
 */
import type * as maplibregl from 'maplibre-gl';
import type { Pos } from './geo';
import type { MultiPolygon, Polygon } from 'geojson';
import { getJson } from '../api';
import { buildingHeight, StoryIndex, tilesAround } from './heights';
import { addScene, drawScene, removeScene, SCENE_LAYER, setRedraw } from '../scene/buildings';

setRedraw((map) => heights.get(map)?.redraw());
import { EYE_MAX_ZOOM, eyeView } from './eye';
import { addScenery, SNOW_LAYER, WATER_EDGE, WATER_LAYER } from './scenery';

const LAYER = 'vtp-sv-buildings';
/** The same buildings redrawn with the assessor's floors (heights.ts), over the plain ones once ready. */
const OWN_SRC = 'vtp-sv-ofm';
/** OpenFreeMap's vector tiles (already allowed by the CSP for the streets map). */
const OFM = 'https://tiles.openfreemap.org/planet';

/** Elevation tiles (Terrarium encoding, about 30 m apart at zoom 12) on s3.amazonaws.com, already in the CSP. */
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
/**
 * The deepest elevation tiles asked for. The eye level street view draws at map zoom 21 to 22; with tiles
 * only to zoom 12 each was stretched about 650 times, more than some GPUs' coordinate precision holds, and
 * the snow and shading could read wrong heights there (a white view). Zoom 15 tiles exist and bring the
 * stretch back to about 80 times; they are asked for only near the camera.
 */
const DEM_MAX_Z = 15;
const DEM_ATTR = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (USGS 3DEP and others)';
const DEM = 'vtp-sv-dem';
const SHADE_SRC = 'vtp-sv-dem-shade';
const SHADE = 'vtp-sv-hillshade';

/**
 * The sky: a clear light blue overhead going pale at the horizon. Haze starts about four fifths of the way
 * to the horizon: the near Wasatch stays crisp (its snow white), and the Lake Mountains, West Mountain and
 * Nebo show softened by distance, not cut off.
 */
export const SKY: maplibregl.SkySpecification = {
  'sky-color': '#6eaee6',
  'horizon-color': '#e4eef7',
  'fog-color': '#dfe8f0',
  'sky-horizon-blend': 0.65,
  'horizon-fog-blend': 0.5,
  'fog-ground-blend': 0.82,
  'atmosphere-blend': 0,
};

export interface Saved {
  center: maplibregl.LngLatLike;
  zoom: number;
  pitch: number;
  bearing: number;
  maxPitch: number;
  maxZoom?: number;
  sky: maplibregl.SkySpecification | undefined;
}

/** The first layer drawn above the ground (the first line or symbol layer), so shading stays under roads and labels. */
const firstAboveGround = (map: maplibregl.Map) => map.getStyle().layers.find((l) => l.type === 'line' || l.type === 'symbol' || l.type === 'fill-extrusion')?.id;

/** Adds the terrain, hillshade and raised buildings (again after the map is remade). */
export function addBuildings(map: maplibregl.Map, dark: boolean): void {
  map.setSky(SKY);
  if (!map.getSource(DEM)) map.addSource(DEM, { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX_Z, attribution: DEM_ATTR });
  // The shading reads its own copy of the tiles, as MapLibre advises when terrain uses the same data. Shadows
  // only, with a faint highlight: a white highlight washed every slope pale, so the snow no longer stood out.
  if (!map.getSource(SHADE_SRC)) map.addSource(SHADE_SRC, { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: DEM_MAX_Z });
  if (!map.getLayer(SHADE))
    map.addLayer({ id: SHADE, type: 'hillshade', source: SHADE_SRC, paint: { 'hillshade-exaggeration': 0.5, 'hillshade-shadow-color': 'rgba(0, 0, 0, 0.4)', 'hillshade-highlight-color': 'rgba(255, 255, 255, 0.12)', 'hillshade-accent-color': 'rgba(0, 0, 0, 0.2)' } }, firstAboveGround(map));
  if (!map.getTerrain()) map.setTerrain({ source: DEM, exaggeration: 1 });
  // The streets map already has OpenFreeMap's source (and draws water blue); satellite and plain maps get their own.
  const streets = Boolean(map.getSource('openmaptiles'));
  const src = streets ? 'openmaptiles' : OWN_SRC;
  if (src === OWN_SRC && !map.getSource(OWN_SRC)) map.addSource(OWN_SRC, { type: 'vector', url: OFM });
  // The snow reads the terrain's own elevation source: the separate shading source left out far tiles
  // (Timpanogos's among them) that the terrain had, so the snow never drew there.
  if (scenery()) addScenery(map, DEM, streets ? null : src, SHADE, firstAboveGround(map));
  showBuildings(map);
  prefetchTerrain(map.getCenter());
  if (map.getLayer(LAYER)) {
    // Back in 3D with the layers kept: only the recorded heights need watching again.
    addScene(map);
    if (!heights.has(map)) heights.set(map, recordedHeights(map, src, dark));
    return;
  }
  const color = dark ? '#6a6c75' : '#dcd8d0';
  map.addLayer({
    id: LAYER,
    type: 'fill-extrusion',
    source: src,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': color,
      'fill-extrusion-height': buildingHeight(),
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 1,
      'fill-extrusion-vertical-gradient': true,
    },
  });
  // The scene: every building as a mesh with its real roof colour and a shaped roof (scene/buildings.ts).
  addScene(map);
  heights.get(map)?.stop();
  heights.set(map, recordedHeights(map, src, dark));
}

/** The Wasatch from Timpanogos to Nebo, Utah Lake and the mountains west of it: what 3D shows at the horizon. */
const VALLEY = { west: -112.05, south: 39.75, east: -111.45, north: 40.55 };
let prefetched = false;

/** Elevation tile numbers covering a box at a zoom. */
function demTiles(b: { west: number; south: number; east: number; north: number }, z: number): Array<[number, number, number]> {
  const n = 2 ** z;
  const tx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const out: Array<[number, number, number]> = [];
  for (let x = tx(b.west); x <= tx(b.east); x++) for (let y = ty(b.north); y <= ty(b.south); y++) out.push([z, x, y]);
  return out;
}

/**
 * In the browser's spare time, once a visit: the elevation tiles the 3D view uses for the far mountains and
 * the lake (zoom 9 to 11 over the valley) and the near ground (zoom 12 within about 6 km), so turning and
 * stepping never wait for terrain. They land in the browser's and the service worker's caches (sw.js).
 */
function prefetchTerrain(c: { lng: number; lat: number }): void {
  if (prefetched || typeof window === 'undefined') return;
  prefetched = true;
  const near = { west: c.lng - 0.07, east: c.lng + 0.07, south: c.lat - 0.055, north: c.lat + 0.055 };
  const list = [9, 10, 11].flatMap((z) => demTiles(VALLEY, z)).concat(demTiles(near, 12));
  const run = () => {
    const next = list.splice(0, 6);
    if (!next.length) return;
    Promise.all(next.map(([z, x, y]) => fetch(DEM_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), { mode: 'cors' }).catch(() => undefined))).then(() => later());
  };
  const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const later = () => (ric ? ric(run, { timeout: 4000 }) : window.setTimeout(run, 300));
  later();
}

/** How far from the view's center buildings are redrawn with recorded heights, in degrees of latitude. */
const NEAR_DEG = 0.011;

const heights = new WeakMap<maplibregl.Map, { stop: () => void; redraw: () => void }>();

/** Where the street view camera stands (eye.ts), per map; a building around it is left out. */
const eyes = new WeakMap<maplibregl.Map, Pos | null>();

/**
 * Tells the 3D view where the eye level camera stands. Any building whose outline is within EYE_CLEAR_M of
 * that spot is left out, so the camera is never inside a wall (OpenStreetMap has small buildings mapped on
 * or beside some roads). The plain building layer is hidden meanwhile; the redrawn one holds every other
 * building.
 */
export function setEye(map: maplibregl.Map, at: Pos | null): void {
  eyes.set(map, at);
  heights.get(map)?.redraw();
}
/**
 * Keeps the buildings at their recorded heights: when the view settles, loads the assessor's floors for
 * the zoom 16 tiles around it (once each), reads OpenFreeMap's buildings in view, and redraws them with the
 * chosen heights. The plain layer stays underneath, invisible, so its tiles keep loading.
 */
function recordedHeights(map: maplibregl.Map, src: string, dark: boolean): { stop: () => void; redraw: () => void } {
  const index = new StoryIndex();
  const asked = new Set<string>();
  let stopped = false;
  let shown = '';
  const draw = () => {
    if (stopped || !map.getLayer(SCENE_LAYER) || map.getZoom() < 14) return;
    // Only the buildings within NEAR_DEG of the view (about 1.2 km), which is what street level shows close up.
    const c = map.getCenter();
    const feats = map.querySourceFeatures(src, { sourceLayer: 'building' }).filter((f) => {
      const g = f.geometry;
      const p = g.type === 'Polygon' ? g.coordinates[0]?.[0] : g.type === 'MultiPolygon' ? g.coordinates[0]?.[0]?.[0] : null;
      return p != null && Math.abs(p[0] - c.lng) < NEAR_DEG * 1.3 && Math.abs(p[1] - c.lat) < NEAR_DEG;
    });
    const eye = eyes.get(map) ?? null;
    const key = `${feats.length}:${index.size}:${eye?.join(',') ?? ''}`;
    if (key === shown || !feats.length) return;
    shown = key;
    drawScene(map, feats.map((f) => ({ geometry: f.geometry as Polygon | MultiPolygon, properties: f.properties })), index, eye, dark, () => {
      // The plain buildings underneath stay invisible once the scene draws them.
      if (map.getLayer(LAYER)) map.setPaintProperty(LAYER, 'fill-extrusion-opacity', 0);
    });
  };
  const settle = () => {
    if (stopped) return;
    const c = map.getCenter();
    for (const [x, y] of tilesAround([c.lng, c.lat])) {
      const k = `${x}/${y}`;
      if (asked.has(k)) continue;
      asked.add(k);
      getJson<GeoJSON.FeatureCollection>(`/api/map/stories/16/${x}/${y}.json`).then(
        (fc) => {
          if (stopped) return;
          index.add(fc);
          draw();
        },
        () => undefined, // Outside Vineyard or the records are down: OSM heights and the default stand.
      );
    }
    draw();
  };
  // In the browser's spare time, so turning the view never waits on it.
  let pending = 0;
  const later = () => {
    if (pending) return;
    const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    pending = ric ? ric(() => ((pending = 0), settle()), { timeout: 1500 }) : window.setTimeout(() => ((pending = 0), settle()), 200);
  };
  map.on('idle', later);
  settle();
  return {
    stop: () => {
      stopped = true;
      map.off('idle', later);
    },
    redraw: () => {
      shown = '';
      draw();
    },
  };
}

/** Every layer the 3D view adds. */
const LAYERS_3D = [SHADE, SNOW_LAYER, WATER_LAYER, WATER_EDGE, LAYER, SCENE_LAYER];

/**
 * Leaving 3D hides the terrain, shading, scenery and buildings instead of removing them: their sources and
 * tiles stay loaded, so going back into 3D shows the mountains at once with no new downloads. (A new base
 * map style drops them anyway.)
 */
export function removeBuildings(map: maplibregl.Map): void {
  heights.get(map)?.stop();
  heights.delete(map);
  for (const id of LAYERS_3D) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  removeScene(map);
  if (map.getTerrain()) map.setTerrain(null);
}

function showBuildings(map: maplibregl.Map): void {
  for (const id of LAYERS_3D) if (map.getLayer(id) && map.getLayoutProperty(id, 'visibility') === 'none') map.setLayoutProperty(id, 'visibility', 'visible');
}

/** Scenery is on unless turned off for a timing comparison (localStorage vtp:scenery = off). */
export const scenery = () => {
  try {
    return localStorage.getItem('vtp:scenery') !== 'off';
  } catch {
    return true;
  }
};

const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Street level over the pin at once (no flight), tilted so a band of sky shows at the top, facing the way
 * the map already faces; returns where the camera was. The terrain and buildings are added after this first
 * frame is drawn (StreetView), so the view opens fast and they stream in. Marks vtp-3d-first-frame.
 */
export function enter3d(map: maplibregl.Map, pin: Pos): Saved {
  const saved: Saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), maxPitch: map.getMaxPitch(), maxZoom: map.getMaxZoom(), sky: map.getSky() };
  map.setMaxPitch(MAX_PITCH);
  map.setMaxZoom(EYE_MAX_ZOOM);
  map.setSky(SKY);
  // The camera stands at the pin at eye height (eye.ts).
  map.jumpTo(eyeView(map, pin, map.getBearing(), START_PITCH));
  map.once('render', () => performance.mark?.('vtp-3d-first-frame'));
  map.triggerRepaint();
  return saved;
}

/**
 * The 3D view's first tilt: 7 degrees short of level. The view then reaches about 11 degrees above the
 * horizon, enough to show the tops of Timpanogos and the high Wasatch (about 8 degrees up from Vineyard)
 * with a band of sky over them.
 */
export const START_PITCH = 83;
const MAX_PITCH = 85;

export function leave3d(map: maplibregl.Map, saved: Saved): void {
  removeBuildings(map);
  map.setSky(saved.sky ?? {});
  map.easeTo({ center: saved.center, zoom: saved.zoom, pitch: saved.pitch, bearing: saved.bearing, duration: still() ? 0 : 700 });
  map.once('moveend', () => {
    map.setMaxPitch(saved.maxPitch);
    if (saved.maxZoom != null) map.setMaxZoom(saved.maxZoom);
  });
}
