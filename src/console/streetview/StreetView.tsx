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
import { ArrowDown, ArrowUp, ExternalLink, Layers, RotateCcw, RotateCw, X } from 'lucide-react';
import { getJson } from '../api';
import { googleStreetViewUrl, parsePhotos, photoSearchUrl, rankPhotos, type Photo, type Pos } from './geo';
import { addSvLayers, drawSv, groundRing, pinMarker, removeHoverShape, removeSvLayers, setHoverShape, type Camera } from './mapDraw';
import { featureAt } from './clickRoute';
import { watchTaps } from './watchTaps';
import { lineNear, mapillaryToken, photoNear, snapToLine } from './coverage';
import { addBuildings, enter3d, leave3d, setEye, type Saved } from './threeD';
import { eyeView } from './eye';
import { enableOrbit, stepFrom, turn } from './orbit';
import { Compass } from './Compass';
import { Sky } from './Sky';
import { createPortal } from 'react-dom';
import type { District } from './zoningRenderer';
import { districtsOf, linesOf, nearLine, projectsOf, type GroundLine } from './ground';
import { groundUnder, pickGround } from './pickGround';

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
  /** Where the pin starts (a long press or a drop), or null to ask for a tap. */
  start: Pos | null;
  /** A photo picked on a blue line (a drop or tap on it): opened as is, facing along the street. */
  startPhoto?: Photo | null;
  /** The zoning layer as the map draws it (each feature's color in __c). */
  loadZoning: () => Promise<FC>;
  /** Shows the zoning layer on the map; returns how to put it back. */
  showMapZoning: () => () => void;
  /** Whether the map's Zoning and Projects layers are on, and the projects' shapes. */
  zoningOn: boolean;
  projectsOn: boolean;
  loadProjects: () => Promise<FC>;
  /** UDOT's construction projects (lines on roads): on, and their lines. */
  udotOn: boolean;
  loadUdot: () => Promise<FC>;
  /** Go here on a project's card: the pin moves to this spot (n changes each time). */
  goTo: { at: Pos; n: number } | null;
  /** A click on a zone or project: the map's details card for it. */
  onPick: (layer: string, name: string, at: Pos) => void;
  /** Opens or closes the map's Layers panel (Zoning, Projects and the rest), from the bar. */
  onLayers: () => void;
  layersOpen: boolean;
  onClose: () => void;
}

type Phase = 'pick' | 'search' | 'photo' | '3d';

/** The map page's zoning fill layer. */
const ZONING_FILL = 'vtp-zoning-fill';
const coarseQuery = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);
const wideQuery = () => typeof window !== 'undefined' && window.innerWidth > 820;

export function StreetView({ getMap, gen, ready, dark, start, startPhoto = null, loadZoning, showMapZoning, zoningOn, projectsOn, loadProjects, udotOn, loadUdot, goTo, onPick, onLayers, layersOpen, onClose }: Props) {
  const [pin, setPin] = useState<Pos | null>(start);
  // The pin for code outside React's render (the camera stands there in 3D).
  const pinRefPos = useRef<Pos | null>(start);
  useEffect(() => {
    pinRefPos.current = pin;
  }, [pin]);
  const pinNow = useCallback(() => pinRefPos.current, []);
  const [phase, setPhase] = useState<Phase>(start ? 'search' : 'pick');
  const [photo, setPhoto] = useState<Photo | null>(null);
  // The next nearest photos, tried in turn when one does not load (at most three in all).
  const [spare, setSpare] = useState<Photo[]>([]);
  // A photo picked on a blue line, opened ahead of the search's own pick.
  const direct = useRef<Photo | null>(startPhoto);
  const [token, setToken] = useState<string | null>(null);
  const [districts, setDistricts] = useState<District[]>([]);
  const [parcel, setParcel] = useState<Pos[] | null>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  // Zoning shows while the map's Zoning layer is on (Layers in the bar or in Tools).
  const showZoning = zoningOn;
  const [wide, setWide] = useState(wideQuery);
  const [coarse] = useState(coarseQuery);
  // The 3D buttons join the map's own control stack at the bottom right (above full screen and zoom), so
  // the stack lays them out and nothing overlaps.
  const [stackHost, setStackHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const map = getMap();
    const corner = phase === '3d' ? map?.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-bottom-right') : null;
    if (!corner) return;
    const host = document.createElement('div');
    host.className = 'vc-sv-3d-host';
    corner.prepend(host);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the host exists only once the 3D view opens
    setStackHost(host);
    return () => {
      host.remove();
      setStackHost(null);
    };
  }, [getMap, gen, phase]);
  const panelRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  // A tap moves, except inside a capital project or on a UDOT construction project, which opens its card.
  // Zoning never takes taps (it covers all the ground): the chip by the bar names the zone under the pin.
  // With a layer on, the mouse highlights the zone or project under it.
  const layersOn = projectsOn || zoningOn || udotOn;
  const routeRef = useRef({ layersOn, onPick });
  useEffect(() => {
    phaseRef.current = phase;
    routeRef.current = { layersOn, onPick };
  });
  // Go here on a project's card: move to that spot, as a tap there would.
  const lastGo = useRef(goTo?.n ?? 0);
  useEffect(() => {
    if (!goTo || goTo.n === lastGo.current) return;
    lastGo.current = goTo.n;
    setPin(goTo.at);
    if (phaseRef.current !== '3d') setPhase('search');
  }, [goTo]);
  const [projects, setProjects] = useState<District[]>([]);
  const [udot, setUdot] = useState<GroundLine[]>([]);
  const linesRef = useRef<GroundLine[]>([]);
  useEffect(() => {
    linesRef.current = udotOn ? udot : [];
  });
  useEffect(() => {
    if (!udotOn) return;
    let stale = false;
    loadUdot().then(
      (fc) => !stale && setUdot(linesOf(fc, 'udot', 'pin_desc')),
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [udotOn, loadUdot]);
  // What can be clicked for details on the map: zoning while it is shown, projects while that layer is on.
  const groundRef = useRef<District[]>([]);
  useEffect(() => {
    groundRef.current = [...(zoningOn ? districts : []), ...(projectsOn ? projects : [])];
  });
  useEffect(() => {
    if (!projectsOn) return;
    let stale = false;
    loadProjects().then(
      (fc) => !stale && setProjects(projectsOf(fc)),
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [projectsOn, loadProjects]);

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
    // A double click would zoom the map under street view: the map's own double click zoom is off meanwhile.
    const dblZoom = map.doubleClickZoom.isEnabled();
    map.doubleClickZoom.disable();
    // Only a deliberate click or tap moves the pin, never the end of a drag, pan, pinch or twist (tapGuard.ts).
    const ring = groundRing(map);
    const click = (point: { x: number; y: number }, lngLat: maplibregl.LngLat) => {
      // On a phone the photo covers the map; on wider screens a tap beside it moves the pin.
      if (phaseRef.current === 'photo' && !wideQuery()) return;
      // On or near a blue line: the photo there. Away from the lines: the spot itself, as before.
      const near = photoNear(map, point, 28);
      if (near) {
        direct.current = near;
        setPin(near.pos);
      } else if (phaseRef.current === '3d') {
        // In the 3D view a tap on the ground moves the pin there and keeps looking the same way.
        setPin([lngLat.lng, lngLat.lat]);
        return;
      } else setPin(lineNear(map, point, 18)?.at ?? [lngLat.lng, lngLat.lat]);
      setPhase('search');
    };
    const el = map.getCanvasContainer();
    let tapTimer = 0;
    /** The zone or project on the ground under a point of the map, if any (found in the shapes themselves). */
    const hitAt = (x: number, y: number) => {
      const ll = groundUnder(map, x, y);
      const d = featureAt(groundRef.current.map((g) => ({ ...g, layer: g.layer ?? 'zoning', name: g.zone })), [ll.lng, ll.lat]);
      if (!d) return null;
      const shape: Geometry = { type: 'MultiPolygon', coordinates: d.rings.map((r) => [r]) };
      return { layer: d.layer, name: d.name, shape, color: d.color };
    };
    /** What a tap there opens instead of moving: a capital project's outline, or a UDOT project's line. */
    const cardAt = (ll: maplibregl.LngLat, plain?: maplibregl.LngLat) => {
      // Inside a project counts at either point: the ground under the pointer, or the middle of the building
      // it is on (a tap on a building in a project, or on the project's ground just past one).
      const at: Pos = [ll.lng, ll.lat];
      if (plain) {
        const p0 = featureAt(groundRef.current.filter((g) => g.layer === 'projects').map((g) => ({ ...g, layer: 'projects', name: g.zone })), [plain.lng, plain.lat]);
        if (p0) return { layer: 'projects', name: p0.name, shape: { type: 'MultiPolygon', coordinates: p0.rings.map((r) => [r]) } as Geometry, color: p0.color };
      }
      const p = featureAt(groundRef.current.filter((g) => g.layer === 'projects').map((g) => ({ ...g, layer: 'projects', name: g.zone })), at);
      if (p) return { layer: 'projects', name: p.name, shape: { type: 'MultiPolygon', coordinates: p.rings.map((r) => [r]) } as Geometry, color: p.color };
      const line = nearLine(linesRef.current, at, 12);
      if (line) return { layer: line.layer, name: line.name, shape: { type: 'MultiLineString', coordinates: line.lines } as Geometry, color: '#5c7cfa' };
      return null;
    };
    // For the live checks only (localStorage vtp:debug): what street view holds, and what a point would open.
    try {
      if (localStorage.getItem('vtp:debug'))
        (window as Window & { __vtpSv?: unknown }).__vtpSv = {
          ground: () => groundRef.current.map((g) => ({ layer: g.layer ?? 'zoning', name: g.zone, rings: g.rings.length })),
          at: (x: number, y: number) => {
            const g = pickGround(map, x, y);
            return { ground: g.at.toArray(), stand: g.stand.toArray(), plain: g.plain.toArray(), card: cardAt(g.at, g.plain)?.name ?? null, phase: phaseRef.current };
          },
        };
    } catch {
      // Storage blocked.
    }
    const moveAt = (p: { x: number; y: number }, point: maplibregl.LngLat, touch: boolean) => {
      if (!touch) {
        ring.hide();
        click(p, point);
        return;
      }
      // On touch the tapped spot lights up for a moment first.
      ring.show([point.lng, point.lat], true);
      tapTimer = window.setTimeout(() => {
        ring.hide();
        click(p, point);
      }, 220);
    };
    const stopTaps = watchTaps(
      el,
      ({ x, y, touch }) => {
        if (phaseRef.current === 'photo' && !wideQuery()) return;
        clearTimeout(tapTimer);
        const g = pickGround(map, x, y);
        const card = cardAt(g.at, g.plain);
        if (card) {
          ring.hide();
          // Go here on the card moves to the street side of what was tapped, never into a building.
          routeRef.current.onPick(card.layer, card.name, [g.stand.lng, g.stand.lat]);
          return;
        }
        moveAt({ x, y }, g.stand, touch);
      },
      () => ring.hide(),
    );
    // The name of the zone or project under the mouse, beside the pointer.
    const label = document.createElement('span');
    label.className = 'vc-sv-hover-label';
    label.hidden = true;
    map.getContainer().appendChild(label);
    let hovered = '';
    let hoverFrame = 0;
    const hover = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cancelAnimationFrame(hoverFrame);
      if (e.buttons !== 0 || (phaseRef.current === 'photo' && !wideQuery())) return leave();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      hoverFrame = requestAnimationFrame(() => {
        const g = pickGround(map, x, y);
        const card = routeRef.current.layersOn ? cardAt(g.at, g.plain) : null;
        const hit = card ?? (routeRef.current.layersOn ? hitAt(x, y) : null);
        const key = hit ? `${hit.layer}:${hit.name}` : '';
        if (key !== hovered) setHoverShape(map, hit?.shape ?? null, hit?.color);
        hovered = key;
        label.hidden = !hit;
        if (hit) {
          label.textContent = card ? `${hit.name}: click for details` : hit.name;
          label.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 14)}px)`;
        }
        // A project opens its card; anywhere else (a zone too) a click moves, and the circle shows where.
        if (card) {
          ring.hide();
          map.getCanvas().style.cursor = 'pointer';
          return;
        }
        map.getCanvas().style.cursor = 'crosshair';
        ring.show([g.stand.lng, g.stand.lat]);
      });
    };
    const leave = () => {
      cancelAnimationFrame(hoverFrame);
      ring.hide();
      label.hidden = true;
      if (hovered) setHoverShape(map, null);
      hovered = '';
    };
    el.addEventListener('pointermove', hover);
    el.addEventListener('pointerleave', leave);
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      if (dblZoom) map.doubleClickZoom.enable();
      stopTaps();
      clearTimeout(tapTimer);
      cancelAnimationFrame(hoverFrame);
      label.remove();
      try {
        removeHoverShape(map);
      } catch {
        // Map removed.
      }
      el.removeEventListener('pointermove', hover);
      el.removeEventListener('pointerleave', leave);
      ring.remove();
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
    // The pin can be dragged to adjust; it snaps onto a blue line within about 25 m.
    pinRef.current = pinMarker(map, pin, (to) => {
      setPin(snapToLine(map, to));
      setPhase('search');
    });
  }, [getMap, gen, ready, pin]);

  useEffect(() => {
    const map = getMap();
    if (!map || !ready) return;
    drawSv(map, phase === 'photo' ? camera : null, parcel);
  }, [getMap, gen, ready, camera, parcel, phase]);

  // A new pin: the parcel under it, then the nearest photo (or the 3D view).
  // The parcel under the pin, outlined on the map and in the photo, wherever the pin goes.
  useEffect(() => {
    if (!pin) return;
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
    return () => {
      stale = true;
    };
  }, [pin]);

  useEffect(() => {
    if (!pin || phase !== 'search') return;
    let stale = false;
    mapillaryToken().then(async (t) => {
      if (stale) return;
      setToken(t);
      if (!t) {
        setPhase('3d');
        return;
      }
      try {
        const res = await fetch(photoSearchUrl(t, pin), { headers: { accept: 'application/json' } });
        const searched = res.ok ? rankPhotos(parsePhotos(await res.json()), pin) : [];
        const first = direct.current;
        direct.current = null;
        const ranked = first ? [first, ...searched.filter((p) => p.id !== first.id)] : searched;
        const found = ranked[0] ?? null;
        if (stale) return;
        setSpare(ranked.slice(1, 3));
        setPhoto(found);
        setCamera(found ? { pos: found.pos, bearing: 0, fov: 0 } : null);
        setPhase(found ? 'photo' : '3d');
      } catch {
        if (stale) return;
        setPhase('3d');
      }
    });
    return () => {
      stale = true;
    };
  }, [pin, phase]);

  // The 3D street level view. The camera before it is kept until street view closes or a photo opens,
  // so moving the pin in 3D only flies to the new spot.
  const saved = useRef<{ map: maplibregl.Map; at: Saved; orbitOff: () => void } | null>(null);
  useEffect(() => {
    const map = getMap();
    if (!map || !ready || !pin) return;
    if (phase === '3d') {
      if (saved.current?.map === map) map.easeTo({ ...eyeView(map, pin, map.getBearing(), map.getPitch()), duration: 450 });
      else saved.current = { map, at: enter3d(map, pin), orbitOff: enableOrbit(map, pinNow) };
      // No building around the camera is drawn, so it never stands inside a wall.
      setEye(map, pin);
    } else if (phase === 'photo' && saved.current) {
      setEye(saved.current.map, null);
      saved.current.orbitOff();
      leave3d(saved.current.map, saved.current.at);
      saved.current = null;
    }
  }, [getMap, ready, phase, pin, pinNow]);
  useEffect(
    () => () => {
      if (!saved.current) return;
      try {
        setEye(saved.current.map, null);
        saved.current.orbitOff();
        leave3d(saved.current.map, saved.current.at);
      } catch {
        // Map removed.
      }
      saved.current = null;
    },
    [],
  );
  // Capital projects stand out on the ground of the 3D view (a stronger fill and edge), so it is clear where a
  // tap opens a card instead of moving.
  useEffect(() => {
    const map = getMap();
    if (!map || phase !== '3d' || !projectsOn) return;
    const FILL = 'vtp-projects-fill',
      LINE = 'vtp-projects-line';
    let saved: { fill?: unknown; width?: unknown } | null = null;
    const boost = () => {
      if (saved || !map.getLayer(FILL)) return;
      saved = { fill: map.getPaintProperty(FILL, 'fill-opacity'), width: map.getLayer(LINE) ? map.getPaintProperty(LINE, 'line-width') : undefined };
      map.setPaintProperty(FILL, 'fill-opacity', 0.42);
      if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-width', 4);
    };
    boost();
    map.on('styledata', boost);
    return () => {
      map.off('styledata', boost);
      try {
        if (saved && map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', saved.fill as number);
        if (saved?.width !== undefined && map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-width', saved.width as number);
      } catch {
        // Map removed.
      }
    };
  }, [getMap, phase, projectsOn]);
  // Zoning on the ground of the 3D view (the map's own zoning layer), while the toggle is on.
  useEffect(() => {
    if (phase !== '3d' || !showZoning) return;
    const undo = showMapZoning();
    const map = getMap();
    if (!map) return undo;
    // On the ground under the raised buildings the usual light fill is hard to see: stronger while in 3D only.
    let saved: maplibregl.DataDrivenPropertyValueSpecification<number> | undefined;
    const boost = () => {
      if (!map.getLayer(ZONING_FILL) || saved !== undefined) return;
      saved = (map.getPaintProperty(ZONING_FILL, 'fill-opacity') ?? 0.22) as maplibregl.DataDrivenPropertyValueSpecification<number>;
      map.setPaintProperty(ZONING_FILL, 'fill-opacity', 0.42);
    };
    boost();
    map.on('styledata', boost);
    return () => {
      map.off('styledata', boost);
      try {
        if (saved !== undefined && map.getLayer(ZONING_FILL)) map.setPaintProperty(ZONING_FILL, 'fill-opacity', saved);
      } catch {
        // Map removed.
      }
      undo();
    };
  }, [getMap, phase, showZoning, showMapZoning]);
  useEffect(() => {
    const map = getMap();
    if (!map || !ready || phase !== '3d') return;
    // After the first 3D frame is on screen: the terrain and buildings then stream in.
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => addBuildings(map, dark))));
    return () => cancelAnimationFrame(frame);
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
      if (e.key === 'Escape') return onClose();
      // In the 3D view: arrows and W A S D turn and step, as the on screen buttons do.
      const map = getMap();
      const t = e.target as HTMLElement | null;
      if (phaseRef.current !== '3d' || !map || e.metaKey || e.ctrlKey || e.altKey || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'arrowleft') turn(map, -20, pinRefPos.current);
      else if (k === 'd' || k === 'arrowright') turn(map, 20, pinRefPos.current);
      else if (k === 'w' || k === 'arrowup') setPin(stepFrom(map, 12, pinRefPos.current));
      else if (k === 's' || k === 'arrowdown') setPin(stepFrom(map, -12, pinRefPos.current));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, getMap]);

  const onError = useCallback(() => {
    if (spare.length) {
      setPhoto(spare[0]);
      setCamera({ pos: spare[0].pos, bearing: 0, fov: 0 });
      setSpare(spare.slice(1));
      return;
    }
    setPhase('3d');
  }, [spare]);

  const google = pin ? (
    <a className="vc-sv-bar-btn" href={googleStreetViewUrl(pin)} target="_blank" rel="noopener noreferrer" aria-label="Open in Google Street View (new tab)" title="Open in Google Street View">
      <ExternalLink size={17} strokeWidth={1.9} aria-hidden="true" />
      <span>Google</span>
    </a>
  ) : null;
  const layersButton = (
    <button type="button" className="vc-sv-bar-btn" aria-pressed={layersOpen} onClick={onLayers} title="Layers: zoning, projects and more">
      <Layers size={17} strokeWidth={1.9} aria-hidden="true" />
      <span>Layers</span>
    </button>
  );
  // What a click does here, in one line.
  const act = coarse ? 'Tap' : 'Click';
  // The zone under the pin, named in a chip by the bar; tapping it opens the zone's card.
  const zoneHere = pin ? featureAt(districts.map((d) => ({ ...d, layer: 'zoning', name: d.zone })), pin) : null;
  const zoneChip = zoneHere && pin && (phase === '3d' || phase === 'photo') ? (
    <button type="button" className="vc-sv-zone" onClick={() => onPick('zoning', zoneHere.name, pin)} title="Details of this zone">
      <span className="vc-map-swatch" style={{ background: zoneHere.color }} aria-hidden="true" />
      Zone: {zoneHere.name}
    </button>
  ) : null;
  const hint = `${act} to move. ${act} a project for details.`;
  const hintLine = (
    <p className="vc-sv-hint">{hint}</p>
  );
  const close = (
    <button type="button" className="vc-sv-bar-btn" onClick={onClose} aria-label="Close street view" title="Close (Escape)">
      <X size={18} strokeWidth={2} aria-hidden="true" />
      <span>Close</span>
    </button>
  );

  if (phase === 'photo' && photo && token && pin)
    return (
      <div ref={panelRef} className="vc-svp" data-wide={wide || undefined} role="dialog" aria-label="Street view">
        <div className="vc-sv-bar">
          {close}
          <p className="vc-sv-title">Street view</p>
          {layersButton}
          {google}
        </div>
        {zoneChip}
        {hintLine}
        <ViewerBoundary key={photo.id} onError={onError}>
          <Suspense fallback={<p className="vc-sv-loading">Loading the street photo.</p>}>
            <PhotoViewer token={token} photo={photo} pin={pin} districts={districts} projects={projectsOn ? projects : []} parcel={parcel} showZoning={showZoning} onPickFeature={onPick} onCamera={setCamera} onError={onError} dark={dark} wide={wide} />
          </Suspense>
        </ViewerBoundary>
        <p className="vc-sv-credit">
          Street photos from{' '}
          <a href="https://www.mapillary.com" target="_blank" rel="noopener noreferrer">
            Mapillary
          </a>{' '}
          contributors, CC BY-SA 4.0.{wide ? '' : ' Small map imagery: Utah County GIS and USGS.'} Zoning from Vineyard City Public GIS.
        </p>
      </div>
    );

  return (
    <>
      <div className="vc-sv-note" role="status" data-compact={phase === '3d' || undefined}>
        {phase === '3d' && zoneChip}
        <div className="vc-sv-bar">
          {close}
          <p className="vc-sv-title">
            {phase === 'pick' ? (coarse ? 'Tap a street' : 'Click a street') : phase === 'search' ? 'Looking for a street photo near this spot.' : ''}
          </p>
          {phase === '3d' && layersButton}
          {phase === '3d' && google}
        </div>
        {phase === '3d' && hintLine}
      </div>
      {phase === '3d' && getMap() && createPortal(<Sky getMap={getMap} />, getMap()!.getContainer())}
      {phase === '3d' && stackHost && createPortal(
        <div className="vc-sv-3d maplibregl-ctrl" role="group" aria-label="Look around">
          <Compass getMap={getMap} pin={pinNow} />
          <button type="button" className="vc-sv-3d-btn" onClick={() => getMap() && turn(getMap()!, -30, pinRefPos.current)} aria-label="Turn left" title="Turn left (A)">
            <RotateCcw size={18} strokeWidth={2} />
          </button>
          <button type="button" className="vc-sv-3d-btn" onClick={() => getMap() && turn(getMap()!, 30, pinRefPos.current)} aria-label="Turn right" title="Turn right (D)">
            <RotateCw size={18} strokeWidth={2} />
          </button>
          <button type="button" className="vc-sv-3d-btn" onClick={() => getMap() && setPin(stepFrom(getMap()!, 12, pinRefPos.current))} aria-label="Forward" title="Forward (W)">
            <ArrowUp size={18} strokeWidth={2} />
          </button>
          <button type="button" className="vc-sv-3d-btn" onClick={() => getMap() && setPin(stepFrom(getMap()!, -12, pinRefPos.current))} aria-label="Back" title="Back (S)">
            <ArrowDown size={18} strokeWidth={2} />
          </button>
        </div>,
        stackHost,
      )}
    </>
  );
}
