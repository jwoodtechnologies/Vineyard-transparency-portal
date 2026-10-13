/**
 * Street view on the map: the pin, the camera cone that follows the photo viewer, and the outline of the
 * parcel under the pin. Kept in the map's main chunk (small); the viewer itself loads on demand.
 */
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import { coneRing, type Pos } from './geo';

const SRC = 'vtp-sv';
const LAYERS = ['vtp-sv-parcel', 'vtp-sv-cone', 'vtp-sv-cone-line', 'vtp-sv-cam'];
export const SV_COLOR = '#ff5a1f';

type FC = FeatureCollection<Geometry, Record<string, unknown>>;

export function addSvLayers(map: maplibregl.Map): void {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'vtp-sv-parcel', type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'parcel'], paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'vtp-sv-cone', type: 'fill', source: SRC, filter: ['==', ['get', 'k'], 'cone'], paint: { 'fill-color': SV_COLOR, 'fill-opacity': 0.28 } });
  map.addLayer({ id: 'vtp-sv-cone-line', type: 'line', source: SRC, filter: ['==', ['get', 'k'], 'cone'], paint: { 'line-color': SV_COLOR, 'line-width': 1.5 } });
  map.addLayer({
    id: 'vtp-sv-cam',
    type: 'circle',
    source: SRC,
    filter: ['==', ['get', 'k'], 'cam'],
    paint: { 'circle-radius': 7, 'circle-color': SV_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
  });
}

export function removeSvLayers(map: maplibregl.Map): void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);
}

export interface Camera {
  pos: Pos;
  bearing: number;
  fov: number;
}

/** Draws the camera and its cone (about 40 pixels long at any zoom) and the parcel outline. */
export function drawSv(map: maplibregl.Map, cam: Camera | null, parcel: Pos[] | null): void {
  const src = map.getSource(SRC) as GeoJSONSource | undefined;
  if (!src) return;
  const features: FC['features'] = [];
  if (parcel) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: parcel }, properties: { k: 'parcel' } });
  if (cam) {
    const mPerPx = (40075016.686 * Math.cos((cam.pos[1] * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coneRing(cam.pos, cam.bearing, cam.fov, 48 * mPerPx)] }, properties: { k: 'cone' } });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: cam.pos }, properties: { k: 'cam' } });
  }
  src.setData({ type: 'FeatureCollection', features });
}

/** The pin: a marker the size of a finger tip, announced to screen readers. */
export function pinMarker(map: maplibregl.Map, at: Pos): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = 'vc-sv-pin';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Street view pin');
  el.innerHTML = '<span aria-hidden="true"></span>';
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(at).addTo(map);
}
