/**
 * The street level 3D view, where no street photo exists near the pin: the map tilts to about 75
 * degrees close over the pin with OpenFreeMap's building shapes raised to their heights (zoning is shown
 * on the ground by the map page). Leaving puts the camera back where it was.
 */
import type * as maplibregl from 'maplibre-gl';
import type { Pos } from './geo';

const LAYER = 'vtp-sv-buildings';
const OWN_SRC = 'vtp-sv-ofm';
/** OpenFreeMap's vector tiles (already allowed by the CSP for the streets map). */
const OFM = 'https://tiles.openfreemap.org/planet';

export interface Saved {
  center: maplibregl.LngLatLike;
  zoom: number;
  pitch: number;
  bearing: number;
  maxPitch: number;
}

/** Adds the raised buildings (again after the map is remade). */
export function addBuildings(map: maplibregl.Map, dark: boolean): void {
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
      'fill-extrusion-color': dark ? '#5b5d66' : '#d9d6d0',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.88,
    },
  });
}

export function removeBuildings(map: maplibregl.Map): void {
  if (map.getLayer(LAYER)) map.removeLayer(LAYER);
  if (map.getSource(OWN_SRC)) map.removeSource(OWN_SRC);
}

const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Tilts down to street level over the pin and returns where the camera was. */
export function enter3d(map: maplibregl.Map, pin: Pos, dark: boolean): Saved {
  const saved: Saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), maxPitch: map.getMaxPitch() };
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
  map.easeTo({ center: saved.center, zoom: saved.zoom, pitch: saved.pitch, bearing: saved.bearing, duration: still() ? 0 : 700 });
  map.once('moveend', () => map.setMaxPitch(saved.maxPitch));
}
