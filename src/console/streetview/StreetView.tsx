/**
 * Street view on /map: drop a pin (long press, or the Street view button and then a tap), and see the
 * spot from the street. Where a Mapillary photo exists within 60 m, it opens turned to face the pin
 * (PhotoViewer, its own chunk), with zoning on the ground and a camera cone on the map that follows it.
 * Elsewhere, or when no Mapillary token is set, the map itself tilts to a 3D street level view with the
 * buildings raised and zoning on the ground. Google Street View stays as a secondary link. Full screen on
 * phones with a slim bar; beside the map on wider screens.
 */
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { FeatureCollection, Geometry } from 'geojson';
import { ExternalLink, Layers, X } from 'lucide-react';
import { getJson } from '../api';
import { googleStreetViewUrl, MAX_PHOTO_M, nearestPhoto, parsePhotos, photoSearchUrl, type Photo, type Pos } from './geo';
import { addSvLayers, drawSv, pinMarker, removeSvLayers, type Camera } from './mapDraw';
import { addBuildings, enter3d, fly3d, leave3d, type Saved } from './threeD';
import type { District } from './zoningRenderer';

const PhotoViewer = lazy(() => import('./PhotoViewer'));

/** A viewer that fails while drawing (or its chunk fails to load) falls back to the 3D view, never taking the map page down. */
class ViewerBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('Street photo viewer failed:', error instanceof Error ? error.message : error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type FC = FeatureCollection<Geometry, Record<string, unknown>>;

interface Props {
  getMap: () => maplibregl.Map | null;
  gen: number;
  ready: boolean;
  dark: boolean;
  /** Where the pin starts (a long press), or null to ask for a tap. */
  start: Pos | null;
  /** The zoning layer as the map draws it (each feature's color in __c). */
  loadZoning: () => Promise<FC>;
  /** Shows the zoning layer on the map; returns how to put it back. */
  showMapZoning: () => () => void;
  onClose: () => void;
}

type Phase = 'pick' | 'search' | 'photo' | '3d';

let tokenPromise: Promise<string | null> | null = null;
/** The Mapillary token from GET /api/streetview/config (asked once a visit), or null. */
function mapillaryToken(): Promise<string | null> {
  tokenPromise ??= getJson<{ token: string | null }>('/api/streetview/config').then(
    (r) => (typeof r.token === 'string' && r.token ? r.token : null),
    () => {
      tokenPromise = null;
      return null;
    },
  );
  return tokenPromise;
}

/** Zoning districts for the photo overlay: outer rings grouped by zone, in the map's colors. */
function districtsOf(fc: FC): District[] {
  const by = new Map<string, District>();
  for (const f of fc.features) {
    const zone = String(f.properties?.ZONE ?? '').trim();
    const g = f.geometry;
    if (!zone || !g) continue;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Pos[][][];
    const d = by.get(zone) ?? { zone, color: typeof f.properties?.__c === 'string' ? f.properties.__c : '#3b6ea8', rings: [] };
    for (const p of polys) if (p[0]?.length > 2) d.rings.push(p[0]);
    by.set(zone, d);
  }
  return [...by.values()];
}

const ZONING_KEY = 'vtp-sv-zoning';
const loadShowZoning = () => {
  try {
    return localStorage.getItem(ZONING_KEY) !== 'off';
  } catch {
    return true;
  }
};
const wideQuery = () => typeof window !== 'undefined' && window.innerWidth > 820;

export function StreetView({ getMap, gen, ready, dark, start, loadZoning, showMapZoning, onClose }: Props) {
  const [pin, setPin] = useState<Pos | null>(start);
  const [phase, setPhase] = useState<Phase>(start ? 'search' : 'pick');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [why3d, setWhy3d] = useState<'none' | 'off' | 'error'>('none');
  const [districts, setDistricts] = useState<District[]>([]);
  const [parcel, setParcel] = useState<Pos[] | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [showZoning, setShowZoningState] = useState(loadShowZoning);
  const [wide, setWide] = useState(wideQuery);
  const panelRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  });

  const setShowZoning = (v: boolean) => {
    setShowZoningState(v);
    try {
      localStorage.setItem(ZONING_KEY, v ? 'on' : 'off');
    } catch {
      // Kept for this visit.
    }
  };

  useEffect(() => {
    const r = () => setWide(wideQuery());
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  // Zoning for the photos, loaded once.
  useEffect(() => {
    loadZoning().then(
      (fc) => setDistricts(districtsOf(fc)),
      () => setDistricts([]),
    );
  }, [loadZoning]);

  // The map side: the cone and parcel layers, the pin, and taps that move the pin.
  const pinRef = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    const map = getMap();
    if (!map || !ready) return;
    addSvLayers(map);
    const click = (e: maplibregl.MapMouseEvent) => {
      // On a phone the photo covers the map; on wider screens a tap beside it moves the pin.
      if (phaseRef.current === 'photo' && !wideQuery()) return;
      setPin([e.lngLat.lng, e.lngLat.lat]);
      setPhase('search');
    };
    map.on('click', click);
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', click);
      map.getCanvas().style.cursor = '';
      pinRef.current?.remove();
      pinRef.current = null;
      try {
        removeSvLayers(map);
      } catch {
        // Map removed.
      }
    };
  }, [getMap, gen, ready]);

  useEffect(() => {
    const map = getMap();
    if (!map || !ready || !pin) return;
    pinRef.current?.remove();
    pinRef.current = pinMarker(map, pin);
  }, [getMap, gen, ready, pin]);

  useEffect(() => {
    const map = getMap();
    if (!map || !ready) return;
    drawSv(map, phase === 'photo' ? camera : null, parcel);
  }, [getMap, gen, ready, camera, parcel, phase]);

  // A new pin: the parcel under it, then the nearest photo (or the 3D view).
  useEffect(() => {
    if (!pin || phase !== 'search') return;
    let stale = false;
    getJson<{ found: boolean; geometry: { type: string; coordinates: unknown } | null }>(`/api/map/parcel?lng=${pin[0].toFixed(6)}&lat=${pin[1].toFixed(6)}&v=2`).then(
      (r) => {
        if (stale) return;
        const g = r.found ? r.geometry : null;
        const ring = g?.type === 'Polygon' ? (g.coordinates as Pos[][])[0] : g?.type === 'MultiPolygon' ? (g.coordinates as Pos[][][])[0]?.[0] : null;
        setParcel(ring ?? null);
      },
      () => !stale && setParcel(null),
    );
    mapillaryToken().then(async (t) => {
      if (stale) return;
      setToken(t);
      if (!t) {
        setWhy3d('off');
        setPhase('3d');
        return;
      }
      try {
        const res = await fetch(photoSearchUrl(t, pin), { headers: { accept: 'application/json' } });
        const found = res.ok ? nearestPhoto(parsePhotos(await res.json()), pin) : null;
        if (stale) return;
        if (!res.ok) setWhy3d('error');
        else setWhy3d('none');
        setPhoto(found);
        setCamera(found ? { pos: found.pos, bearing: 0, fov: 0 } : null);
        setPhase(found ? 'photo' : '3d');
      } catch {
        if (stale) return;
        setWhy3d('error');
        setPhase('3d');
      }
    });
    return () => {
      stale = true;
    };
  }, [pin, phase]);

  // The 3D street level view. The camera before it is kept until street view closes or a photo opens,
  // so moving the pin in 3D only flies to the new spot.
  const saved = useRef<{ map: maplibregl.Map; at: Saved } | null>(null);
  useEffect(() => {
    const map = getMap();
    if (!map || !ready || !pin) return;
    if (phase === '3d') {
      if (saved.current?.map === map) fly3d(map, pin);
      else saved.current = { map, at: enter3d(map, pin, dark) };
    } else if (phase === 'photo' && saved.current) {
      leave3d(saved.current.map, saved.current.at);
      saved.current = null;
    }
    // The theme is handled below; this runs for a new pin or phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMap, ready, phase, pin]);
  useEffect(
    () => () => {
      if (!saved.current) return;
      try {
        leave3d(saved.current.map, saved.current.at);
      } catch {
        // Map removed.
      }
      saved.current = null;
    },
    [],
  );
  // Zoning on the ground of the 3D view (the map's own zoning layer), while the toggle is on.
  useEffect(() => {
    if (phase !== '3d' || !showZoning) return;
    return showMapZoning();
  }, [phase, showZoning, showMapZoning]);
  useEffect(() => {
    const map = getMap();
    if (map && ready && phase === '3d') addBuildings(map, dark);
  }, [getMap, gen, ready, phase, dark]);

  // On wider screens the photo sits beside the map: the map keeps the pin and cone in its open part.
  useEffect(() => {
    const map = getMap();
    if (!map || !ready) return;
    const right = phase === 'photo' && wide && panelRef.current ? panelRef.current.getBoundingClientRect().width : 0;
    // Setting the padding stops any camera move under way (the 3D tilt), so it is set only when it changes.
    const pad = (r: number) => {
      try {
        const now = map.getPadding();
        if (now.right !== r || now.left || now.top || now.bottom) map.setPadding({ top: 0, bottom: 0, left: 0, right: r });
      } catch {
        // Map removed.
      }
    };
    pad(right);
    if (pin && phase === 'photo' && wide) map.easeTo({ center: pin, zoom: Math.max(map.getZoom(), 17.5), duration: 400 });
    return () => pad(0);
  }, [getMap, gen, ready, phase, wide, pin]);

  // The map follows the camera when it walks out of view.
  useEffect(() => {
    const map = getMap();
    if (!map || !camera || phase !== 'photo' || !wide) return;
    const p = map.project(camera.pos);
    const c = map.getContainer();
    const right = panelRef.current?.getBoundingClientRect().width ?? 0;
    if (p.x < 40 || p.y < 80 || p.x > c.clientWidth - right - 40 || p.y > c.clientHeight - 40) map.easeTo({ center: camera.pos, duration: 300 });
  }, [getMap, camera, phase, wide]);

  // Escape closes.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const onError = useCallback(() => {
    setWhy3d('error');
    setPhase('3d');
  }, []);

  const google = pin ? (
    <a className="vc-sv-bar-btn" href={googleStreetViewUrl(pin)} target="_blank" rel="noopener noreferrer" aria-label="Open in Google Street View (new tab)" title="Open in Google Street View">
      <ExternalLink size={17} strokeWidth={1.9} aria-hidden="true" />
      <span>Google</span>
    </a>
  ) : null;
  const zoningToggle = (
    <button type="button" className="vc-sv-bar-btn" aria-pressed={showZoning} onClick={() => setShowZoning(!showZoning)} title={showZoning ? 'Hide zoning' : 'Show zoning'}>
      <Layers size={17} strokeWidth={1.9} aria-hidden="true" />
      <span>Zoning</span>
    </button>
  );
  const close = (
    <button type="button" className="vc-sv-bar-btn" data-icon-only="true" onClick={onClose} aria-label="Close street view" title="Close (Escape)">
      <X size={18} strokeWidth={2} />
    </button>
  );

  if (phase === 'photo' && photo && token && pin)
    return (
      <div ref={panelRef} className="vc-svp" data-wide={wide || undefined} role="dialog" aria-label="Street view">
        <div className="vc-sv-bar">
          {close}
          <p className="vc-sv-title">Street view</p>
          {zoningToggle}
          {google}
        </div>
        <ViewerBoundary onError={onError}>
          <Suspense fallback={<p className="vc-sv-loading">Loading the street photo.</p>}>
            <PhotoViewer token={token} photo={photo} pin={pin} districts={districts} parcel={parcel} showZoning={showZoning} onCamera={setCamera} onError={onError} />
          </Suspense>
        </ViewerBoundary>
        <p className="vc-sv-credit">
          Street photos from{' '}
          <a href="https://www.mapillary.com" target="_blank" rel="noopener noreferrer">
            Mapillary
          </a>{' '}
          contributors, CC BY-SA 4.0. Zoning from Vineyard City Public GIS.
        </p>
      </div>
    );

  return (
    <div className="vc-sv-note" role="status">
      <div className="vc-sv-bar">
        {close}
        <p className="vc-sv-title">
          {phase === 'pick'
            ? 'Tap a spot on the map to see it from the street.'
            : phase === 'search'
              ? 'Looking for a street photo near this spot.'
              : why3d === 'off'
                ? 'Street photos are not available right now. This is a 3D view of the map.'
                : why3d === 'error'
                  ? 'The street photo could not be loaded. This is a 3D view of the map.'
                  : `No street photo within ${MAX_PHOTO_M} m of this spot yet. This is a 3D view of the map.`}
        </p>
        {phase === '3d' && zoningToggle}
        {phase === '3d' && google}
      </div>
    </div>
  );
}
