import { useEffect, useRef, useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import type * as maplibregl from 'maplibre-gl';
import { useTheme } from '@/hooks/useTheme';
import { blankStyle, streetsStyle } from '../mapBase';
import { loadMapLibre } from './maplibreLoader';
import { PLACE_BOUNDS, SHAPE_MIN, geometryOf, parseLatLng, type LngLat, type Shape } from './noticesLib';

const VINEYARD: maplibregl.LngLatBoundsLike = [
  [-111.772, 40.278],
  [-111.708, 40.338],
];

const show = (p: LngLat) => `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;

/** The hint under the map: what to do next. */
function nextStep(shape: Shape, count: number): string {
  const need = SHAPE_MIN[shape];
  if (shape === 'Point') return count ? 'Drag the dot to move it, or tap another place.' : 'Tap the map where it is.';
  if (count === 0) return shape === 'LineString' ? 'Tap the map at one end of the road or path.' : 'Tap the map at one corner of the area.';
  if (count < need) return `Tap to add ${need - count} more point${need - count === 1 ? '' : 's'}.`;
  return shape === 'LineString' ? 'Keep tapping along the road to follow its bends. Drag a dot to move it.' : 'Tap to add corners. Drag a dot to move it.';
}

/**
 * Where a notice is on the map. Staff tap the map to add points (a spot, along a road, around an area), drag a dot to
 * correct it, or type a latitude and longitude. The numbered list below the map does everything the map does, for
 * keyboards and screen readers.
 */
export default function PlacePicker({ shape, points, color, onChange }: { shape: Shape; points: LngLat[]; color: string; onChange: (points: LngLat[]) => void }) {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const pins = useRef<maplibregl.Marker[]>([]);
  const latest = useRef({ shape, points, onChange });
  // The map's own handlers read the newest props from here.
  useEffect(() => {
    latest.current = { shape, points, onChange };
  });
  const quiet = useRef(0);
  const framed = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState('');

  const add = (p: LngLat) => {
    const { shape: sh, points: pts, onChange: change } = latest.current;
    const last = pts[pts.length - 1];
    // The same place twice in a row is a double tap, not a new point.
    if (sh !== 'Point' && last && last[0] === p[0] && last[1] === p[1]) return;
    change(sh === 'Point' ? [p] : [...pts, p]);
  };

  // The map itself: made once when the picker opens, and rebuilt if the theme changes.
  useEffect(() => {
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    (async () => {
      try {
        const [lib, style] = await Promise.all([loadMapLibre(), streetsStyle(dark).catch(() => blankStyle(dark))]);
        if (cancelled || !box.current) return;
        libRef.current = lib;
        map = new lib.Map({
          container: box.current,
          style,
          bounds: VINEYARD,
          fitBoundsOptions: { padding: 24 },
          maxBounds: [
            [PLACE_BOUNDS[0] - 0.05, PLACE_BOUNDS[1] - 0.05],
            [PLACE_BOUNDS[2] + 0.05, PLACE_BOUNDS[3] + 0.05],
          ],
          minZoom: 10,
          maxZoom: 19,
          attributionControl: { compact: true },
          dragRotate: false,
          touchPitch: false,
          pitchWithRotate: false,
          // On a phone one finger scrolls the form and two move the map, so the form never gets stuck behind a map.
          cooperativeGestures: true,
        });
        map.touchZoomRotate.disableRotation();
        map.keyboard.disableRotation();
        map.addControl(new lib.NavigationControl({ showCompass: false }), 'bottom-right');
        map.on('click', (e) => {
          if (Date.now() < quiet.current) return;
          add([Math.round(e.lngLat.lng * 1e6) / 1e6, Math.round(e.lngLat.lat * 1e6) / 1e6]);
        });
        map.on('style.load', () => {
          if (!map) return;
          map.addSource('place', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'place-fill', type: 'fill', source: 'place', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color, 'fill-opacity': 0.25 } });
          map.addLayer({
            id: 'place-casing',
            type: 'line',
            source: 'place',
            filter: ['!=', ['geometry-type'], 'Point'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#000000', 'line-opacity': 0.55, 'line-width': 9 },
          });
          map.addLayer({
            id: 'place-line',
            type: 'line',
            source: 'place',
            filter: ['!=', ['geometry-type'], 'Point'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': color, 'line-width': 5 },
          });
          mapRef.current = map;
          framed.current = false;
          setReady(true);
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      for (const m of pins.current) m.remove();
      pins.current = [];
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // The colour is applied by the sync below; only the theme rebuilds the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  // Keep the drawing and the dots in step with the points (from taps, the list, or typing).
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !ready) return;
    const g = geometryOf(shape, points, true);
    (map.getSource('place') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: g ? [{ type: 'Feature', properties: {}, geometry: g as never }] : [] });
    for (const id of ['place-fill']) if (map.getLayer(id)) map.setPaintProperty(id, 'fill-color', color);
    if (map.getLayer('place-line')) map.setPaintProperty('place-line', 'line-color', color);
    for (const m of pins.current) m.remove();
    pins.current = points.map((p, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'vs-pin';
      el.style.background = color;
      el.textContent = shape === 'Point' ? '' : String(i + 1);
      el.setAttribute('aria-label', `Point ${i + 1} of ${points.length}`);
      // A tap on a dot is not a tap on the map.
      el.addEventListener('click', (e) => e.stopPropagation());
      const marker = new lib.Marker({ element: el, draggable: true }).setLngLat(p).addTo(map);
      marker.on('dragend', () => {
        const at = marker.getLngLat();
        quiet.current = Date.now() + 350;
        const next = latest.current.points.slice();
        next[i] = [Math.round(at.lng * 1e6) / 1e6, Math.round(at.lat * 1e6) / 1e6];
        latest.current.onChange(next);
      });
      return marker;
    });
    // When a notice with a place opens for editing, frame it once.
    if (!framed.current && points.length) {
      framed.current = true;
      if (points.length === 1) map.jumpTo({ center: points[0], zoom: 16 });
      else {
        const b = new lib.LngLatBounds(points[0], points[0]);
        for (const p of points) b.extend(p);
        map.fitBounds(b, { padding: 50, maxZoom: 17, duration: 0 });
      }
    }
  }, [shape, points, color, ready]);

  function addTyped(e: { preventDefault: () => void }) {
    e.preventDefault();
    const p = parseLatLng(typed);
    if (!p) return setTypedError('Write the latitude and then the longitude, such as 40.3085, -111.7517, for a place in Vineyard.');
    setTypedError('');
    setTyped('');
    add(p);
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    // Keep every point in view: a typed point may be well away from the rest.
    const all = shape === 'Point' ? [p] : [...points, p];
    if (all.length === 1) return void map.easeTo({ center: p, zoom: Math.max(map.getZoom(), 15), duration: 400 });
    const b = new lib.LngLatBounds(all[0], all[0]);
    for (const q of all) b.extend(q);
    map.fitBounds(b, { padding: 50, maxZoom: 17, duration: 400 });
  }

  const removeAt = (i: number) => onChange(points.filter((_, j) => j !== i));

  return (
    <div className="vs-picker">
      <div className="vs-picker-map" ref={box} role="group" aria-label="Map for placing the notice. The numbered list below does the same thing without the map.">
        {!ready && !failed && <p className="vs-picker-wait">Loading the map...</p>}
        {failed && <p className="vs-picker-wait">The map could not load. Type the latitude and longitude below instead.</p>}
      </div>
      <p className="vs-hint" role="status">
        {nextStep(shape, points.length)}
      </p>
      {points.length > 0 && (
        <ol className="vs-points" aria-label="Points on the map">
          {points.map((p, i) => (
            <li key={`${i}-${p[0]}-${p[1]}`}>
              <span>{shape === 'Point' ? 'Spot' : `Point ${i + 1}`}</span> <code>{show(p)}</code>
              <button type="button" className="vs-link" onClick={() => removeAt(i)} aria-label={`Remove point ${i + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={!points.length} onClick={() => onChange(points.slice(0, -1))}>
          <Undo2 size={14} aria-hidden="true" /> Undo last point
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={!points.length} onClick={() => onChange([])}>
          <Trash2 size={14} aria-hidden="true" /> Start over
        </button>
      </div>
      <div className="vs-field">
        <label htmlFor="vs-latlng">Or type a location</label>
        <div className="vs-inline">
          <input
            id="vs-latlng"
            inputMode="decimal"
            autoComplete="off"
            value={typed}
            placeholder="40.3085, -111.7517"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTyped(e)}
          />
          <button type="button" className="vs-btn vs-btn-quiet" onClick={addTyped}>
            Add point
          </button>
        </div>
        <p className="vs-hint">Latitude, then longitude. Press and hold a place on Google Maps to copy it.</p>
        {typedError && (
          <p className="vs-error" role="alert">
            {typedError}
          </p>
        )}
      </div>
    </div>
  );
}
