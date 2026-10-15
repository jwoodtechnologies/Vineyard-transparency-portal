/**
 * Google Street View mode. Google's terms allow Google Street View only beside a Google map, so this mode
 * swaps our map for a Google map (Maps JavaScript API) with our zoning, the parcel lines and the pin drawn on
 * it, beside a Google panorama. Moving the person or clicking the map moves the panorama; walking or turning
 * in the panorama moves the pin and its cone on the map. Side by side with a draggable divider on wider
 * screens; on phones the panorama is on top with a handle to resize. Close returns to our map at the same
 * place and zoom.
 *
 * Google's script is loaded only when the mode opens, with the key from POST /api/streetview/google/open
 * (worker/lib/googleSv.ts), which also counts the open against the daily cap. Google's logo, terms and
 * attribution are left exactly as Google draws them.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import type { FeatureCollection, Geometry } from 'geojson';
import { getJson } from '../api';
import { bearing } from '../measure/geo';
import type { Pos } from './geo';
import { clampSplit, fromGoogleZoom, headingCone, needsPan, parcelTiles, splitAt, toGoogleZoom } from './googleSync';
import { SV_COLOR } from './mapDraw';

type FC = FeatureCollection<Geometry, Record<string, unknown>>;

/* Only the parts of the Maps JavaScript API used here. */
interface LatLng {
  lat(): number;
  lng(): number;
}
interface Listener {
  remove(): void;
}
interface Evented {
  addListener(name: string, fn: (e: { latLng?: LatLng }) => void): Listener;
}
interface GFeature {
  getProperty(k: string): unknown;
}
interface GData {
  addGeoJson(fc: object): GFeature[];
  remove(f: GFeature): void;
  setStyle(s: object | ((f: GFeature) => object)): void;
  setMap(m: GMap | null): void;
}
interface GMap extends Evented {
  getZoom(): number | undefined;
  getCenter(): LatLng | undefined;
  getBounds(): { getNorthEast(): LatLng; getSouthWest(): LatLng } | undefined;
  panTo(p: { lat: number; lng: number }): void;
  setStreetView(p: GPano): void;
}
interface GPano extends Evented {
  getPosition(): LatLng | null;
  getPov(): { heading: number; pitch: number };
  getZoom(): number;
  setPano(id: string): void;
  setPov(p: { heading: number; pitch: number }): void;
  setVisible(v: boolean): void;
}
interface GMaps {
  Map: new (el: HTMLElement, o: object) => GMap;
  StreetViewPanorama: new (el: HTMLElement, o: object) => GPano;
  StreetViewService: new () => { getPanorama(req: object): Promise<{ data: { location?: { pano?: string; latLng?: LatLng } } }> };
  Data: new (o: object) => GData;
  SymbolPath: { CIRCLE: number };
  StreetViewSource: { OUTDOOR: string };
  StreetViewPreference: { NEAREST: string };
  importLibrary(name: string): Promise<unknown>;
}
type GoogleWindow = Window & { google?: { maps: GMaps }; __vtpGoogleReady?: () => void; gm_authFailure?: () => void };

let loading: Promise<GMaps> | null = null;
let authFailed: ((m: string) => void) | null = null;

/** Loads Google's script once a visit, then the map and Street View libraries. */
function loadGoogle(key: string): Promise<GMaps> {
  const w = window as GoogleWindow;
  loading ??= new Promise<GMaps>((resolve, reject) => {
    w.__vtpGoogleReady = () => {
      const g = w.google?.maps;
      if (!g) return reject(new Error('Google Maps did not load.'));
      Promise.all(['core', 'maps', 'streetView'].map((n) => g.importLibrary(n))).then(() => resolve(w.google!.maps), reject);
    };
    // Google calls this when it refuses the key (wrong site, API off, billing).
    w.gm_authFailure = () => authFailed?.('Google refused the map key for this site.');
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__vtpGoogleReady`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Google Maps could not be reached.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

const wideQuery = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 821px)').matches;
const ll = (p: Pos) => ({ lat: p[1], lng: p[0] });
const pos = (p: LatLng): Pos => [p.lng(), p.lat()];

interface Props {
  start: Pos;
  /** Our map's zoom. */
  zoom: number;
  loadZoning: () => Promise<FC>;
  /** Back to our map, at this place and zoom (ours). */
  onClose: (at: Pos, zoom: number) => void;
  /** Today's cap was reached: the Tools item goes away. */
  onCapped: () => void;
}

export default function GoogleView({ start, zoom, loadZoning, onClose, onCapped }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const panoEl = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(() => !wideQuery());
  const [split, setSplit] = useState(0.5);
  const [note, setNote] = useState<string | null>('Loading Google Street View.');
  const [failed, setFailed] = useState(false);
  const live = useRef<{ map: GMap; pano: GPano } | null>(null);
  const cbs = useRef({ onClose, onCapped, loadZoning });
  useEffect(() => {
    cbs.current = { onClose, onCapped, loadZoning };
  });

  useEffect(() => {
    const r = () => setStacked(!wideQuery());
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  useEffect(() => {
    let gone = false;
    const listeners: Listener[] = [];
    authFailed = (m) => {
      if (gone) return;
      setFailed(true);
      setNote(m);
    };
    (async () => {
      const res = await fetch('/api/streetview/google/open', { method: 'POST', headers: { accept: 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as { key?: string; message?: string };
      if (gone) return;
      if (res.status === 429) cbs.current.onCapped();
      if (!res.ok || !body.key) throw new Error(body.message ?? 'Google Street View is not available now.');
      const g = await loadGoogle(body.key);
      if (gone || !mapEl.current || !panoEl.current) return;
      const map = new g.Map(mapEl.current, {
        center: ll(start),
        zoom: toGoogleZoom(zoom),
        mapTypeId: 'roadmap',
        streetViewControl: true,
        fullscreenControl: false,
        mapTypeControl: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
      });
      const pano = new g.StreetViewPanorama(panoEl.current, { position: ll(start), pov: { heading: 0, pitch: 0 }, zoom: 1, fullscreenControl: false, motionTracking: false, motionTrackingControl: false, enableCloseButton: false, addressControl: true, visible: false });
      // Bound to the map: dropping Google's person on the map opens this panorama there.
      map.setStreetView(pano);
      live.current = { map, pano };

      // Our overlays: zoning under everything, then parcel lines, then the cone and the pin.
      const zoning = new g.Data({ map });
      zoning.setStyle((f: GFeature) => {
        const c = String(f.getProperty('__c') ?? '#888888');
        return { fillColor: c, fillOpacity: 0.22, strokeColor: c, strokeOpacity: 0.7, strokeWeight: 1, clickable: false, zIndex: 1 };
      });
      cbs.current.loadZoning().then((fc) => !gone && zoning.addGeoJson(fc), () => undefined);
      const parcels = new g.Data({ map });
      parcels.setStyle({ fillOpacity: 0, strokeColor: '#ffffff', strokeOpacity: 0.9, strokeWeight: 1.2, clickable: false, zIndex: 2 });
      const asked = new Set<string>();
      listeners.push(
        map.addListener('idle', () => {
          const b = map.getBounds();
          if (!b || (map.getZoom() ?? 0) < 17) return;
          const ne = b.getNorthEast(),
            sw = b.getSouthWest();
          for (const [x, y] of parcelTiles({ west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat() })) {
            const k = `${x}/${y}`;
            if (asked.has(k)) continue;
            asked.add(k);
            getJson<FC>(`/api/map/parcels/16/${x}/${y}.json`).then((fc) => !gone && parcels.addGeoJson(fc), () => asked.delete(k));
          }
        }),
      );
      const marks = new g.Data({ map });
      marks.setStyle((f: GFeature) =>
        f.getProperty('k') === 'cone'
          ? { fillColor: SV_COLOR, fillOpacity: 0.3, strokeColor: SV_COLOR, strokeWeight: 1.5, clickable: false, zIndex: 3 }
          : { icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: '#fbbc04', fillOpacity: 1, strokeColor: '#7a5b00', strokeWeight: 2 }, clickable: false, zIndex: 4 },
      );
      let drawn: GFeature[] = [];
      const draw = () => {
        const p = pano.getPosition();
        drawn.forEach((f) => marks.remove(f));
        if (!p) return (drawn = []);
        const at = pos(p);
        const ring = headingCone(at, pano.getPov().heading, pano.getZoom());
        drawn = marks.addGeoJson({
          type: 'FeatureCollection',
          features: [
            { type: 'Feature', properties: { k: 'cone' }, geometry: { type: 'Polygon', coordinates: [ring] } },
            { type: 'Feature', properties: { k: 'pin' }, geometry: { type: 'Point', coordinates: at } },
          ],
        });
      };

      // The panorama nearest a spot (within 50 m, outdoors), facing the spot.
      const svc = new g.StreetViewService();
      const openAt = async (at: Pos, face?: Pos) => {
        try {
          const { data } = await svc.getPanorama({ location: ll(at), radius: 50, source: g.StreetViewSource.OUTDOOR, preference: g.StreetViewPreference.NEAREST });
          if (gone || !data.location?.pano) return;
          const from = data.location.latLng ? pos(data.location.latLng) : at;
          pano.setPano(data.location.pano);
          const target = face ?? at;
          if (Math.hypot(target[0] - from[0], target[1] - from[1]) > 1e-6) pano.setPov({ heading: bearing(from, target), pitch: 0 });
          pano.setVisible(true);
          setNote(null);
        } catch {
          if (!gone) setNote('No Google Street View within 50 m of that spot. Click the map near a road, or drag the person onto a blue line.');
        }
      };
      listeners.push(
        pano.addListener('position_changed', () => {
          draw();
          const p = pano.getPosition();
          const b = map.getBounds();
          if (p && b) {
            const ne = b.getNorthEast(),
              sw = b.getSouthWest();
            if (needsPan({ west: sw.lng(), south: sw.lat(), east: ne.lng(), north: ne.lat() }, pos(p))) map.panTo({ lat: p.lat(), lng: p.lng() });
          }
        }),
        pano.addListener('pov_changed', draw),
        pano.addListener('zoom_changed', draw),
        pano.addListener('visible_changed', () => setNote(null)),
        // Google's own click (it never fires for the end of a drag): the panorama there.
        map.addListener('click', (e) => e.latLng && void openAt(pos(e.latLng))),
      );
      await openAt(start);
    })().catch((e: unknown) => {
      if (gone) return;
      setFailed(true);
      setNote(e instanceof Error ? e.message : 'Google Street View could not be opened.');
    });
    return () => {
      gone = true;
      authFailed = null;
      listeners.forEach((l) => l.remove());
      live.current = null;
    };
    // Opened once, at the spot it was opened from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    const l = live.current;
    const p = l?.pano.getPosition() ?? l?.map.getCenter() ?? null;
    const z = l?.map.getZoom();
    cbs.current.onClose(p ? pos(p) : start, z != null ? fromGoogleZoom(z) : zoom);
  }, [start, zoom]);

  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close]);

  // The divider (side by side) or handle (stacked): drag, or arrow keys.
  const dragging = useRef(false);
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setSplit(stacked ? splitAt(e.clientY, r.top, r.height, true) : splitAt(e.clientX, r.left, r.width, false));
  };
  const up = () => (dragging.current = false);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const more = stacked ? 'ArrowDown' : 'ArrowLeft';
    const less = stacked ? 'ArrowUp' : 'ArrowRight';
    if (e.key === more || e.key === less) {
      e.preventDefault();
      setSplit((s) => clampSplit(s + (e.key === more ? 0.05 : -0.05)));
    }
  };

  const pct = Math.round(split * 100);
  return (
    <div className="vc-gsv" role="dialog" aria-label="Google Street View" data-stacked={stacked || undefined}>
      <div className="vc-sv-bar vc-gsv-bar">
        <button type="button" className="vc-sv-bar-btn" data-icon-only="true" onClick={close} aria-label="Close Google Street View" title="Close (Escape)">
          <X size={18} strokeWidth={2} />
        </button>
        <p className="vc-sv-title">Google Street View</p>
      </div>
      <div ref={box} className="vc-gsv-split" style={{ ['--gsv-pano' as string]: `${pct}%` }}>
        <div ref={panoEl} className="vc-gsv-pano" aria-label="Street View panorama" />
        <div
          className="vc-gsv-divider"
          role="separator"
          aria-orientation={stacked ? 'horizontal' : 'vertical'}
          aria-label="Resize the panorama and the map"
          aria-valuenow={pct}
          aria-valuemin={30}
          aria-valuemax={75}
          tabIndex={0}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={keys}
        >
          <span aria-hidden="true" />
        </div>
        <div ref={mapEl} className="vc-gsv-map" aria-label="Google map" />
        {note && (
          <p className="vc-gsv-note" role="status" data-failed={failed || undefined}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}
