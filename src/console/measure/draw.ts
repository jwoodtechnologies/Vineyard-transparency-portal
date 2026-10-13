/**
 * The measurement on the map: the shape (line, outline and fill), segment length labels, the dashed
 * guide to the pointer or crosshair, and the handles: a draggable point for each vertex and a tap
 * target at each segment's middle that inserts a point there. Also snapping to parcel corners and road
 * lines. All map work for the measure tool lives here; the panel (MeasureTool.tsx) holds the state.
 */
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import { midpoint, nearestOnSegment, distance, type Pos } from './geo';
import type { Mode } from './shape';
import type { Summary } from './summary';
import { fmtLength, type System } from './units';

export const SRC = 'vtp-measure';
const GUIDE = 'vtp-measure-guide';
const LAYERS = ['vtp-measure-fill', 'vtp-measure-casing', 'vtp-measure-line', 'vtp-measure-guide-line', 'vtp-measure-label'];
export const COLOR = '#ff5a1f';

type FC = FeatureCollection<Geometry, Record<string, unknown>>;
const fc = (features: FC['features']): FC => ({ type: 'FeatureCollection', features });

/** Adds the sources and layers (again after the map is remade for a new theme or base map). */
export function addLayers(map: maplibregl.Map): void {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: fc([]) });
  map.addSource(GUIDE, { type: 'geojson', data: fc([]) });
  map.addLayer({ id: 'vtp-measure-fill', type: 'fill', source: SRC, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': COLOR, 'fill-opacity': 0.14 } });
  map.addLayer({
    id: 'vtp-measure-casing',
    type: 'line',
    source: SRC,
    filter: ['!=', ['geometry-type'], 'Point'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.9 },
  });
  map.addLayer({ id: 'vtp-measure-line', type: 'line', source: SRC, filter: ['!=', ['geometry-type'], 'Point'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COLOR, 'line-width': 3 } });
  map.addLayer({ id: 'vtp-measure-guide-line', type: 'line', source: GUIDE, paint: { 'line-color': COLOR, 'line-width': 2.5, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.9 } });
  if (map.getStyle().glyphs)
    map.addLayer({
      id: 'vtp-measure-label',
      type: 'symbol',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.5], 'text-allow-overlap': false, 'text-padding': 2 },
      paint: { 'text-color': '#1a1a1a', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
    });
}

export function removeLayers(map: maplibregl.Map): void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC, GUIDE]) if (map.getSource(id)) map.removeSource(id);
}

/** Draws the shape: the path or outline, the area, and a length label on each segment. */
export function drawShape(map: maplibregl.Map, mode: Mode, pts: Pos[], closed: boolean, sum: Summary, system: System): void {
  const features: FC['features'] = [];
  if (sum.ring) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [sum.ring] }, properties: {} });
  else if (mode === 'distance' && pts.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: closed ? [...pts, pts[0]] : pts }, properties: {} });
  if (mode === 'circle' && pts.length === 2) {
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: {} });
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: midpoint(pts[0], pts[1]) }, properties: { label: fmtLength(sum.radius, system) } });
  }
  if (mode === 'distance' || mode === 'area')
    for (const s of sum.segments) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: midpoint(s.from, s.to) }, properties: { label: fmtLength(s.meters, system) } });
  (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(fc(features));
}

/** The dashed guide from the last point (or a circle's center) to where the next point would go. */
export function drawGuide(map: maplibregl.Map, from: Pos | null, to: Pos | null): void {
  const src = map.getSource(GUIDE) as GeoJSONSource | undefined;
  src?.setData(fc(from && to ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [from, to] }, properties: {} }] : []));
}

export interface HandleEvents {
  /** A point dragged: `phase` start (before the first move), move, or end. */
  onDrag: (index: number, at: Pos, phase: 'start' | 'move' | 'end') => void;
  onInsert: (after: number, at: Pos) => void;
  onPointTap: (index: number) => void;
}

/** The draggable points and the insert targets between them, kept as map markers (44 px targets). */
export class Handles {
  private points: maplibregl.Marker[] = [];
  private mids: maplibregl.Marker[] = [];
  private lastDrag = 0;
  private segs: Array<[Pos, Pos]> = [];
  constructor(
    private map: maplibregl.Map,
    private ev: HandleEvents,
  ) {
    map.on('zoomend', this.fit);
  }

  /** An insert target shows only where its segment is long enough on screen that it cannot cover a point's target. */
  private fit = () => {
    this.mids.forEach((m, k) => {
      const seg = this.segs[k];
      if (!seg) return;
      const a = this.map.project(seg[0]),
        b = this.map.project(seg[1]);
      m.getElement().style.display = Math.hypot(a.x - b.x, a.y - b.y) < 88 ? 'none' : '';
    });
  };

  private point(i: number): maplibregl.Marker {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'vc-mh';
    el.innerHTML = '<span aria-hidden="true"></span>';
    const m = new maplibregl.Marker({ element: el, draggable: true });
    m.on('dragstart', () => this.ev.onDrag(Number(el.dataset.i), toPos(m.getLngLat()), 'start'));
    m.on('drag', () => this.ev.onDrag(Number(el.dataset.i), toPos(m.getLngLat()), 'move'));
    m.on('dragend', () => {
      this.lastDrag = Date.now();
      this.ev.onDrag(Number(el.dataset.i), toPos(m.getLngLat()), 'end');
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - this.lastDrag < 350) return;
      this.ev.onPointTap(Number(el.dataset.i));
    });
    el.dataset.i = String(i);
    return m;
  }

  private mid(): maplibregl.Marker {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'vc-mh vc-mh-mid';
    el.innerHTML = '<span aria-hidden="true"></span>';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const after = Number(el.dataset.after);
      this.ev.onInsert(after, toPos(this.mids[Number(el.dataset.k)].getLngLat()));
    });
    return new maplibregl.Marker({ element: el });
  }

  /** Puts a point on each vertex and an insert target on each segment (none while dragging is impossible). */
  update(mode: Mode, pts: Pos[], closed: boolean): void {
    const shown = mode === 'parcel' ? [] : pts;
    while (this.points.length > shown.length) this.points.pop()!.remove();
    while (this.points.length < shown.length) this.points.push(this.point(this.points.length).setLngLat(shown[this.points.length]).addTo(this.map));
    shown.forEach((p, i) => {
      const m = this.points[i];
      const el = m.getElement();
      el.dataset.i = String(i);
      el.dataset.role = mode === 'circle' ? (i ? 'edge' : 'center') : i === 0 ? 'first' : '';
      el.setAttribute('aria-label', mode === 'circle' ? (i ? 'Circle edge. Drag to change the radius.' : 'Circle center. Drag to move the circle.') : `Point ${i + 1} of ${shown.length}. Drag to move.`);
      const ll = m.getLngLat();
      if (ll.lng !== p[0] || ll.lat !== p[1]) m.setLngLat(p);
    });
    const segs: Array<[number, Pos, Pos]> = [];
    if (mode === 'distance' || mode === 'area') {
      for (let i = 1; i < pts.length; i++) segs.push([i - 1, pts[i - 1], pts[i]]);
      if ((mode === 'area' || closed) && pts.length > 2) segs.push([pts.length - 1, pts[pts.length - 1], pts[0]]);
    }
    while (this.mids.length > segs.length) this.mids.pop()!.remove();
    while (this.mids.length < segs.length) this.mids.push(this.mid().setLngLat(midpoint(segs[this.mids.length][1], segs[this.mids.length][2])).addTo(this.map));
    segs.forEach(([after, a, b], k) => {
      const el = this.mids[k].getElement();
      el.dataset.after = String(after);
      el.dataset.k = String(k);
      el.setAttribute('aria-label', `Add a point between points ${after + 1} and ${after + 2 > pts.length ? 1 : after + 2}`);
      this.mids[k].setLngLat(midpoint(a, b));
    });
    this.segs = segs.map(([, a, b]) => [a, b]);
    this.fit();
  }

  clear(): void {
    this.map.off('zoomend', this.fit);
    for (const m of [...this.points, ...this.mids]) m.remove();
    this.points = [];
    this.mids = [];
  }
}

const toPos = (ll: maplibregl.LngLat): Pos => [ll.lng, ll.lat];

/** The parcel shapes and roads the map has loaded, for snapping. */
export interface SnapData {
  parcels: FC | null;
  roads: FC | null;
}

/** Snap distance: a few meters, or less when zoomed out far enough that a few meters is under a finger. */
export function snapMeters(map: maplibregl.Map, at: Pos): number {
  const p = map.project(at);
  const q = map.unproject([p.x + 14, p.y]);
  return Math.min(4, distance(at, [q.lng, q.lat]));
}

function linesOf(g: Geometry | null | undefined): Pos[][] {
  if (!g) return [];
  switch (g.type) {
    case 'LineString':
      return [g.coordinates as Pos[]];
    case 'MultiLineString':
    case 'Polygon':
      return g.coordinates as Pos[][];
    case 'MultiPolygon':
      return (g.coordinates as Pos[][][]).flat();
    default:
      return [];
  }
}

/**
 * The spot to use for `at`: the nearest parcel corner within `within` meters, else the nearest point
 * on a road line within it, else `at` itself.
 */
export function snap(at: Pos, data: SnapData, within: number): { at: Pos; to: 'corner' | 'road' | null } {
  if (within <= 0) return { at, to: null };
  // A rough box first (a degree of latitude is about 111 km), so only nearby shapes are measured.
  const dy = (within / 111_000) * 1.5;
  const dx = dy / Math.cos((at[1] * Math.PI) / 180);
  const near = (p: Pos) => Math.abs(p[0] - at[0]) <= dx && Math.abs(p[1] - at[1]) <= dy;
  let best: { at: Pos; d: number } | null = null;
  for (const f of data.parcels?.features ?? [])
    for (const line of linesOf(f.geometry))
      for (const p of line)
        if (near(p)) {
          const d = distance(at, p);
          if (d <= within && (!best || d < best.d)) best = { at: p, d };
        }
  if (best) return { at: best.at, to: 'corner' };
  let road: { at: Pos; d: number } | null = null;
  for (const f of data.roads?.features ?? [])
    for (const line of linesOf(f.geometry))
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i];
        if (Math.min(a[0], b[0]) - dx > at[0] || Math.max(a[0], b[0]) + dx < at[0] || Math.min(a[1], b[1]) - dy > at[1] || Math.max(a[1], b[1]) + dy < at[1]) continue;
        const n = nearestOnSegment(at, a, b);
        if (n.d <= within && (!road || n.d < road.d)) road = n;
      }
  return road ? { at: road.at, to: 'road' } : { at, to: null };
}
