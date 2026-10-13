/**
 * The street level 3D view, where no street photo exists near the pin: the map tilts close over the pin on
 * real terrain (AWS Terrain Tiles, with a soft hillshade under the aerial photos), so the Wasatch, the lake
 * shore and the ground's rise and fall show, and OpenFreeMap's buildings are raised to their recorded
 * heights. A light blue sky with a soft horizon replaces the black above it. Leaving puts all of it back.
 */
import type * as maplibregl from 'maplibre-gl';
import type { Pos } from './geo';
import { buildingHeight } from './heights';

const LAYER = 'vtp-sv-buildings';
const OWN_SRC = 'vtp-sv-ofm';
/** OpenFreeMap's vector tiles (already allowed by the CSP for the streets map). */
const OFM = 'https://tiles.openfreemap.org/planet';

/** Elevation tiles (Terrarium encoding, about 30 m apart at zoom 12) on s3.amazonaws.com, already in the CSP. */
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const DEM_ATTR = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> (USGS 3DEP and others)';
const DEM = 'vtp-sv-dem';
const SHADE_SRC = 'vtp-sv-dem-shade';
const SHADE = 'vtp-sv-hillshade';

/** The sky: light blue overhead, paler at a soft horizon, distant ground fading into it. */
export const SKY: maplibregl.SkySpecification = {
  'sky-color': '#7fb8e6',
  'horizon-color': '#dceaf6',
  'fog-color': '#e4edf5',
  'sky-horizon-blend': 0.7,
  'horizon-fog-blend': 0.6,
  'fog-ground-blend': 0.85,
  'atmosphere-blend': 0,
};

export interface Saved {
  center: maplibregl.LngLatLike;
  zoom: number;
  pitch: number;
  bearing: number;
  maxPitch: number;
  sky: maplibregl.SkySpecification | undefined;
}

/** The first layer drawn above the ground (the first line or symbol layer), so shading stays under roads and labels. */
const firstAboveGround = (map: maplibregl.Map) => map.getStyle().layers.find((l) => l.type === 'line' || l.type === 'symbol' || l.type === 'fill-extrusion')?.id;

/** Adds the terrain, hillshade and raised buildings (again after the map is remade). */
export function addBuildings(map: maplibregl.Map, dark: boolean): void {
  map.setSky(SKY);
  if (!map.getSource(DEM)) map.addSource(DEM, { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: DEM_ATTR });
  // The shading reads its own copy of the tiles, as MapLibre advises when terrain uses the same data.
  if (!map.getSource(SHADE_SRC)) map.addSource(SHADE_SRC, { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
  if (!map.getLayer(SHADE))
    map.addLayer({ id: SHADE, type: 'hillshade', source: SHADE_SRC, paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#2b2b33', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#3a3a40' } }, firstAboveGround(map));
  if (!map.getTerrain()) map.setTerrain({ source: DEM, exaggeration: 1 });
  if (map.getLayer(LAYER)) return;
  // The streets map already has OpenFreeMap's source; satellite and plain maps get their own.
  const src = map.getSource('openmaptiles') ? 'openmaptiles' : OWN_SRC;
  if (src === OWN_SRC && !map.getSource(OWN_SRC)) map.addSource(OWN_SRC, { type: 'vector', url: OFM });
  map.addLayer({
    id: LAYER,
    type: 'fill-extrusion',
    source: src,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': dark ? '#6a6c75' : '#dcd8d0',
      'fill-extrusion-height': buildingHeight(),
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    },
  });
}

export function removeBuildings(map: maplibregl.Map): void {
  if (map.getLayer(LAYER)) map.removeLayer(LAYER);
  if (map.getSource(OWN_SRC)) map.removeSource(OWN_SRC);
  if (map.getTerrain()) map.setTerrain(null);
  if (map.getLayer(SHADE)) map.removeLayer(SHADE);
  for (const s of [SHADE_SRC, DEM]) if (map.getSource(s)) map.removeSource(s);
}

const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Tilts down to street level over the pin and returns where the camera was. */
export function enter3d(map: maplibregl.Map, pin: Pos, dark: boolean): Saved {
  const saved: Saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), maxPitch: map.getMaxPitch(), sky: map.getSky() };
  map.setMaxPitch(80);
  addBuildings(map, dark);
  fly3d(map, pin);
  return saved;
}

/** Street level over the pin: close in, tilted about 75 degrees, facing the way the map already faces. */
export function fly3d(map: maplibregl.Map, pin: Pos): void {
  map.easeTo({ center: pin, zoom: 18.6, pitch: 75, bearing: map.getBearing(), duration: still() ? 0 : 1200 });
}

export function leave3d(map: maplibregl.Map, saved: Saved): void {
  removeBuildings(map);
  map.setSky(saved.sky ?? {});
  map.easeTo({ center: saved.center, zoom: saved.zoom, pitch: saved.pitch, bearing: saved.bearing, duration: still() ? 0 : 700 });
  map.once('moveend', () => map.setMaxPitch(saved.maxPitch));
}
