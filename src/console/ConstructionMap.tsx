/**
 * The Construction page's small map: numbered pins for work the city has posted notices about, and the
 * funded capital projects shaded by stage. Loaded only when the page asks for it (MapLibre is the
 * heavy part), and moved by the cards on the page ("Show on map").
 */
import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import type { LngLatBoundsLike } from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { STAGES, STAGE_COLOR, type ActiveProject, type Stage } from './construction';

maplibregl.setWorkerUrl(workerUrl);

type FC = FeatureCollection<Geometry, object>;

export interface MapFocus {
  /** [[west, south], [east, north]] */
  bounds: [[number, number], [number, number]];
  /** Changes on every request so the same place can be asked for twice. */
  nonce: number;
}

const VINEYARD: LngLatBoundsLike = [
  [-111.772, 40.278],
  [-111.708, 40.338],
];

interface Props {
  plans: FC | null;
  active: ActiveProject[];
  dark: boolean;
  focus: MapFocus | null;
  /** The city's name for the project to outline. */
  selected: string | null;
  onPlan: (gisName: string) => void;
  onActive: (id: string) => void;
}

function pin(n: number, label: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'vc-cp-pin';
  el.textContent = String(n);
  el.setAttribute('aria-label', label);
  return el;
}

export default function ConstructionMap({ plans, active, dark, focus, selected, onPlan, onActive }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  // Project shapes arrive after the map; hold them until the source exists.
  const pending = useRef<FC | null>(null);
  const chosen = useRef<string | null>(selected);
  const cb = useRef({ onPlan, onActive });
  useEffect(() => {
    cb.current = { onPlan, onActive };
  }, [onPlan, onActive]);

  // Create the map once; the page remounts this component when the theme changes.
  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: dark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron',
      bounds: VINEYARD,
      fitBoundsOptions: { padding: 12 },
      attributionControl: { compact: true },
      cooperativeGestures: true,
      maxZoom: 18,
      minZoom: 11,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const markers = active.flatMap((p) =>
      p.sites.map((s) => {
        const el = pin(p.n, `${p.title}: ${s.label}`);
        el.addEventListener('click', () => cb.current.onActive(p.id));
        return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([s.lon, s.lat]).addTo(map);
      }),
    );

    // If the basemap cannot be reached, still draw the pins and project areas on a plain background.
    let plain = false;
    map.on('error', () => {
      if (loaded.current || plain) return;
      plain = true;
      map.setStyle({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? '#16161a' : '#eef0f2' } }] });
    });

    map.on('load', () => {
      loaded.current = true;
      const k = dark ? 'dark' : 'light';
      const color = [...(['match', ['get', 'Project_Phase']] as unknown[]), ...STAGES.flatMap((s: Stage) => [s, STAGE_COLOR[s][k]]), STAGE_COLOR.Planning[k]] as unknown as maplibregl.ExpressionSpecification;
      map.addSource('plans', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as FeatureCollection });
      map.addLayer({ id: 'plans-fill', type: 'fill', source: 'plans', paint: { 'fill-color': color, 'fill-opacity': dark ? 0.55 : 0.5 } });
      map.addLayer({ id: 'plans-line', type: 'line', source: 'plans', paint: { 'line-color': color, 'line-width': 1.6, 'line-opacity': 0.95 } });
      map.addLayer({
        id: 'plans-sel',
        type: 'line',
        source: 'plans',
        filter: ['==', ['get', 'Project_Name'], chosen.current ?? ''],
        paint: { 'line-color': dark ? '#ffffff' : '#0b0b0d', 'line-width': 3.2 },
      });
      map.on('click', 'plans-fill', (e) => {
        const name = e.features?.[0]?.properties?.Project_Name;
        if (typeof name === 'string') cb.current.onPlan(name);
      });
      map.on('mouseenter', 'plans-fill', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'plans-fill', () => (map.getCanvas().style.cursor = ''));
      const src = map.getSource('plans') as maplibregl.GeoJSONSource | undefined;
      if (src && pending.current) src.setData(pending.current as FeatureCollection);
    });

    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
  }, [active, dark]);

  useEffect(() => {
    pending.current = plans;
    const map = mapRef.current;
    if (!map || !loaded.current || !plans) return;
    const src = map.getSource('plans') as maplibregl.GeoJSONSource | undefined;
    src?.setData(plans as FeatureCollection);
  }, [plans]);

  useEffect(() => {
    chosen.current = selected;
    const map = mapRef.current;
    if (map && loaded.current) map.setFilter('plans-sel', ['==', ['get', 'Project_Name'], selected ?? '']);
  }, [selected]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    const [[w, s], [e, n]] = focus.bounds;
    const tiny = Math.abs(e - w) < 0.0004 && Math.abs(n - s) < 0.0004;
    if (tiny) mapRef.current.easeTo({ center: [(w + e) / 2, (s + n) / 2], zoom: 16, duration: 700 });
    else mapRef.current.fitBounds(focus.bounds as LngLatBoundsLike, { padding: 48, maxZoom: 16.5, duration: 700 });
  }, [focus]);

  return <div ref={box} className="vc-cp-map-canvas" role="region" aria-label="Map of construction in Vineyard" />;
}

