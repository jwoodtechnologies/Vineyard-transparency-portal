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

/**
 * The street view pin: a yellow person in a white ring (unlike the orange search and place markers),
 * dropped in with a short bounce and draggable to adjust (`onMoved` gets where it was let go).
 */
export function pinMarker(map: maplibregl.Map, at: Pos, onMoved: (to: Pos) => void): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = 'vc-sv-pin';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', 'Street view pin. Drag to move it.');
  el.innerHTML =
    '<span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="5" r="2.8" fill="#fbbc04" stroke="#7a5b00" stroke-width="1"/><path d="M8 10c0-1 .8-1.8 1.8-1.8h4.4c1 0 1.8.8 1.8 1.8v5h-2V22h-4v-7H8z" fill="#fbbc04" stroke="#7a5b00" stroke-width="1"/></svg></span>';
  // Where the pin stands, for the screenshot checks (a drag to look around must leave it where it is).
  el.dataset.at = `${at[0].toFixed(6)},${at[1].toFixed(6)}`;
  const m = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat(at).addTo(map);
  m.on('dragend', () => {
    const ll = m.getLngLat();
    onMoved([ll.lng, ll.lat]);
  });
  return m;
}

/**
 * A ring lying on the ground where a click would put the pin: under the mouse while it hovers (hidden while
 * dragging), and briefly at a tapped spot before the pin moves there.
 */
export function groundRing(map: maplibregl.Map): { show: (at: Pos, tapped?: boolean) => void; hide: () => void; remove: () => void } {
  const el = document.createElement('div');
  el.className = 'vc-sv-ring';
  el.setAttribute('aria-hidden', 'true');
  const m = new maplibregl.Marker({ element: el, pitchAlignment: 'map', rotationAlignment: 'map' });
  let on = false;
  return {
    show: (at, tapped = false) => {
      m.setLngLat(at);
      el.classList.toggle('is-tap', tapped);
      if (!on) m.addTo(map);
      on = true;
    },
    hide: () => {
      if (on) m.remove();
      on = false;
    },
    remove: () => m.remove(),
  };
}

const HOVER_SRC = 'vtp-sv-hover';
/** The zone or project under the pointer in street view, brightened: a stronger fill and a white edge. */
export function setHoverShape(map: maplibregl.Map, shape: Geometry | null, color = '#ffffff'): void {
  const fc: FC = { type: 'FeatureCollection', features: shape ? [{ type: 'Feature', properties: { c: color }, geometry: shape }] : [] };
  const src = map.getSource(HOVER_SRC) as GeoJSONSource | undefined;
  if (src) {
    src.setData(fc);
    return;
  }
  if (!shape) return;
  map.addSource(HOVER_SRC, { type: 'geojson', data: fc });
  map.addLayer({ id: 'vtp-sv-hover-fill', type: 'fill', source: HOVER_SRC, paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.38 } });
  map.addLayer({ id: 'vtp-sv-hover-line', type: 'line', source: HOVER_SRC, paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.95 } });
}

export function removeHoverShape(map: maplibregl.Map): void {
  for (const id of ['vtp-sv-hover-line', 'vtp-sv-hover-fill']) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(HOVER_SRC)) map.removeSource(HOVER_SRC);
}
