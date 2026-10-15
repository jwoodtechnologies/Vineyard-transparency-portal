/**
 * Drive mode (Tools, Drive): tap a road, and a car drives along the real roads of Vineyard and a little
 * around it, in its lane, at a steady town speed, on the 3D terrain with buildings and scenery. The camera
 * follows it: drag to swing all the way around the car and tilt, pinch or scroll to go from close behind it to
 * a high view over the town; Reset view eases back to the chase view (camera.ts). Near an intersection,
 * arrows show the ways on; with no choice it goes straight or follows the road, and turns around at a dead
 * end. Stop and Go, three speeds, a small map of where it is, and Exit back to the map at the car's spot.
 * With Zoning or Capital projects on (Tools, Layers), a tap on one opens its card while the car drives on.
 * Keys: left and right arrows (up for straight), space to stop or go, Escape to exit. Pauses while the tab
 * is hidden. Each frame moves the car and eases the camera, and writes to the page only what changed.
 *
 * Its own chunk, loaded only when Drive is picked; the road graph is built in a worker (graph.worker.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { ArrowLeft, ArrowRight, ArrowUp, LocateFixed, Pause, Play, X } from 'lucide-react';
import type { FeatureCollection } from 'geojson';
import { destination } from '../measure/geo';
import { addBuildings, enter3d, removeBuildings, type Saved } from '../streetview/threeD';
import { Sky } from '../streetview/Sky';
import { TapGuard } from '../streetview/tapGuard';
import { featureAt } from '../streetview/clickRoute';
import { groundUnder } from '../streetview/pickGround';
import { districtsOf, projectsOf } from '../streetview/ground';
import type { District } from '../streetview/zoningRenderer';
import { watchTaps } from '../streetview/watchTaps';
import { CHASE, dragged, ease, easeAngle, isChase, lead, zoomed, type View } from './camera';
import { createPortal } from 'react-dom';
import { canDrive, nearestEdge, type Graph, type Leg, type Pos, type SpeedMode } from './graph';
import { carLayer, type CarLayer } from './carLayer';
import { Car, type Choice } from './sim';
import { distance, bearing as bearingOf } from '../measure/geo';

/** Vineyard and about a kilometer and a half around it: the roads Drive mode uses. */
const BOX = { west: -111.79, south: 40.264, east: -111.69, north: 40.352 };
const LAYER_ID = 'vtp-drive-car';

type Phase = 'road' | 'drive';

/** The one car: a red sedan. */
const KIND = 'sedan';
const COLOR = '#c62828';

interface Props {
  getMap: () => maplibregl.Map | null;
  ready: boolean;
  dark: boolean;
  onExit: () => void;
  /** The map's Zoning and Capital projects layers: on, and their shapes, for taps while driving. */
  zoningOn: boolean;
  projectsOn: boolean;
  loadZoning: () => Promise<FeatureCollection>;
  loadProjects: () => Promise<FeatureCollection>;
  /** A tap on a zone or project: the map's card for it (a sheet on phones). */
  onPick: (layer: string, name: string, at: Pos) => void;
}

let graphPromise: Promise<Graph> | null = null;
function loadGraph(): Promise<Graph> {
  graphPromise ??= new Promise<Graph>((resolve, reject) => {
    const w = new Worker(new URL('./graph.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ graph?: Graph; error?: string }>) => {
      w.terminate();
      if (e.data.graph) resolve(e.data.graph);
      else {
        graphPromise = null;
        reject(new Error(e.data.error ?? 'The roads could not be read.'));
      }
    };
    w.onerror = () => {
      w.terminate();
      graphPromise = null;
      reject(new Error('The roads could not be read.'));
    };
    w.postMessage({ box: BOX });
  });
  return graphPromise;
}

export default function DriveMode({ getMap, ready, dark, onExit, zoningOn, projectsOn, loadZoning, loadProjects, onPick }: Props) {
  const [phase, setPhase] = useState<Phase>('road');
  // The camera: where it is asked to be (drags, pinches, Reset view); the frame loop eases toward it.
  const viewRef = useRef<View>(CHASE);
  const [chase, setChase] = useState(true);
  // Zones and projects on the ground, for taps while driving.
  const groundRef = useRef<District[]>([]);
  const [zones, setZones] = useState<District[]>([]);
  const [projects, setProjects] = useState<District[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [mode, setMode] = useState<SpeedMode>('normal');
  const [turns, setTurns] = useState<{ left: boolean; straight: boolean; right: boolean; chosen: Choice | null; auto: Choice | 'uturn' | null; locked: boolean } | null>(null);
  const carRef = useRef<Car | null>(null);
  const layerRef = useRef<CarLayer | null>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const insetRef = useRef<SVGGElement>(null);
  const insetCar = useRef<SVGGElement>(null);
  const coarse = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);

  useEffect(() => {
    let stale = false;
    loadGraph().then(
      (g) => !stale && setGraph(g),
      (e: Error) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, []);

  // Tap a road to start.
  const start = useCallback(
    (at: Pos) => {
      const map = getMap();
      if (!graph || !map) return;
      const hit = nearestEdge(graph, at, 40);
      if (!hit) {
        setError('No road there. Tap closer to a street in or near Vineyard.');
        return;
      }
      setError(null);
      const e = hit.edge;
      // The way that can be driven, the one closer to the way the map faces.
      const h = bearingOf(e.coords[hit.index], e.coords[hit.index + 1]);
      const facing = Math.abs(((h - map.getBearing() + 540) % 360) - 180) < 90;
      const ways = [facing, !facing].filter((f) => canDrive(e, f));
      const leg: Leg = { edge: e.id, forward: ways[0] ?? true };
      let from = 0;
      for (let i = 0; i < hit.index; i++) from += distance(e.coords[i], e.coords[i + 1]);
      from += distance(e.coords[hit.index], hit.at);
      if (!leg.forward) from = e.len - from;
      carRef.current = new Car(graph, leg, from);
      setPhase('drive');
    },
    [graph, getMap],
  );

  useEffect(() => {
    const map = getMap();
    if (!map || !ready || phase !== 'road') return;
    const stop = watchTaps(map.getCanvasContainer(), ({ x, y }) => {
      const ll = map.unproject([x, y]);
      start([ll.lng, ll.lat]);
    });
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      stop();
      map.getCanvas().style.cursor = '';
    };
  }, [getMap, ready, phase, start]);

  // Zones and projects for taps, loaded while their layer is on.
  useEffect(() => {
    if (!zoningOn) return;
    let stale = false;
    loadZoning().then(
      (fc) => !stale && setZones(districtsOf(fc)),
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [zoningOn, loadZoning]);
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
    groundRef.current = [...(zoningOn ? zones : []), ...(projectsOn ? projects : [])];
  }, [zoningOn, projectsOn, zones, projects]);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  });

  // Driving: 3D on, the car layer, the camera, one step a frame.
  useEffect(() => {
    const map = getMap();
    const car = carRef.current;
    if (!map || !car || phase !== 'drive') return;
    const first = car.pose();
    const saved: Saved = enter3d(map, first.at);
    const handlers = [map.dragPan, map.scrollZoom, map.boxZoom, map.dragRotate, map.keyboard, map.doubleClickZoom, map.touchZoomRotate, map.touchPitch];
    const was = handlers.map((h) => h.isEnabled());
    handlers.forEach((h) => h.disable());
    let frame = 0;
    let addFrame = requestAnimationFrame(() => (addFrame = requestAnimationFrame(() => addBuildings(map, dark))));
    const layer = carLayer(LAYER_ID, KIND, COLOR);
    layerRef.current = layer;
    if (!map.getLayer(LAYER_ID)) map.addLayer(layer);

    // The camera's own gestures on the map: one finger or the mouse turns and tilts it around the car, two
    // fingers pinch, the wheel zooms; a tap (TapGuard) opens what is under it.
    const el = map.getCanvasContainer();
    const touchWas = el.style.touchAction;
    el.style.touchAction = 'none';
    // A press that stays put is a tap however long it lasts: nothing else is done by holding still here.
    const guard = new TapGuard(Infinity);
    const pts = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const setView = (v: View) => {
      viewRef.current = v;
      setChase(isChase(v));
    };
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pinch = () => {
      const [a, b] = [...pts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const down = (e: PointerEvent) => {
      const p = local(e);
      pts.set(e.pointerId, p);
      guard.down(e.pointerId, p.x, p.y, e.timeStamp, e.pointerType === 'touch', e.button);
      if (pts.size === 2) spread = pinch();
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      const p = local(e);
      guard.move(e.pointerId, p.x, p.y);
      pts.set(e.pointerId, p);
      if (pts.size === 1 && guard.dragging) setView(dragged(viewRef.current, p.x - prev.x, p.y - prev.y));
      else if (pts.size === 2) {
        const d = pinch();
        if (spread > 0 && d > 0) setView(zoomed(viewRef.current, Math.log2(d / spread)));
        spread = d;
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      const p = local(e);
      const t = guard.up(e.pointerId, p.x, p.y, e.timeStamp);
      spread = pts.size === 2 ? pinch() : 0;
      if (!t) return;
      // On a building, the zone or project under that building (pickGround.ts).
      const ll = groundUnder(map, t.x, t.y);
      const hit = featureAt(groundRef.current.map((g) => ({ ...g, layer: g.layer ?? 'zoning', name: g.zone })), [ll.lng, ll.lat]);
      if (hit) pickRef.current(hit.layer, hit.name, [ll.lng, ll.lat]);
    };
    const cancel = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      guard.cancel(e.pointerId);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      guard.wheel();
      setView(zoomed(viewRef.current, -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)));
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('wheel', wheel, { passive: false });

    let cam: View = { ...viewRef.current };
    let carHeading = first.heading;
    let elevation = map.queryTerrainElevation({ lng: first.at[0], lat: first.at[1] }) ?? 0;
    let last = performance.now();
    let turnKey = '';
    let shownMph = -1;
    let insetAt: Pos | null = null;
    let insetKey = '';
    // Frame times for the debug check (localStorage vtp:debug): the last 600 frames, and the time this
    // loop itself takes.
    const debug = (() => {
      try {
        return localStorage.getItem('vtp:debug') === '1';
      } catch {
        return false;
      }
    })();
    const stats = { frames: [] as number[], work: [] as number[] };
    if (debug) (window as unknown as { __vtpDrive?: typeof stats }).__vtpDrive = stats;
    const drawInset = (at: Pos) => {
      const g = insetRef.current;
      if (!g || !graph) return;
      insetAt = at;
      // Roads within about 500 m, in meters around the car (north up), 70 px for 500 m.
      const k = 70 / 500;
      const kx = 111320 * Math.cos((at[1] * Math.PI) / 180);
      const px = (p: Pos) => `${(((p[0] - at[0]) * kx * k) + 70).toFixed(1)},${(70 - (p[1] - at[1]) * 110540 * k).toFixed(1)}`;
      // Roads whose extent overlaps the inset's window (a long straight road may have no point inside it).
      const near = graph.edges.filter((e) => {
        let w = Infinity, east = -Infinity, so = Infinity, n = -Infinity;
        for (const p of e.coords) {
          w = Math.min(w, p[0]);
          east = Math.max(east, p[0]);
          so = Math.min(so, p[1]);
          n = Math.max(n, p[1]);
        }
        return (east - at[0]) * kx > -700 && (w - at[0]) * kx < 700 && (n - at[1]) * 110540 > -700 && (so - at[1]) * 110540 < 700;
      });
      g.innerHTML = near.map((e) => `<polyline points="${e.coords.map(px).join(' ')}" />`).join('');
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // Real time, in steps of at most a tenth of a second, so a slow frame does not slow the car (a long
      // gap, such as a hidden tab, counts as half a second at most).
      const dt = Math.min(0.5, (now - last) / 1000);
      if (debug) {
        stats.frames.push(now - last);
        if (stats.frames.length > 600) stats.frames.shift();
      }
      last = now;
      for (let left = dt; left > 1e-6; left -= 0.1) car.step(Math.min(0.1, left));
      const { at, heading } = car.pose();
      // The ground height eases too: the elevation tiles change detail as the car moves, and a raw read
      // would make the car and camera hop.
      const ground = map.queryTerrainElevation({ lng: at[0], lat: at[1] });
      if (ground != null) elevation += (ground - elevation) * (1 - Math.exp(-dt * 6));
      layer.place(at, heading, elevation);
      // The camera eases toward the asked for view, and its heading follows the car's a little behind.
      carHeading = easeAngle(carHeading, heading, dt, 2.5);
      cam = ease(cam, viewRef.current, dt);
      const bearing = carHeading + cam.yaw;
      map.jumpTo({ center: destination(at, bearing, lead(cam.zoom)), bearing, pitch: cam.pitch, zoom: cam.zoom });
      // Only what changed is written to the page.
      const mph = Math.round(car.v / 0.44704);
      if (mph !== shownMph && speedRef.current) {
        shownMph = mph;
        speedRef.current.textContent = String(mph);
      }
      const o = car.options();
      const auto = o ? (o.deadEnd ? 'uturn' : o.auto === o.straight ? 'straight' : o.auto === o.left ? 'left' : o.auto === o.right ? 'right' : 'straight') : null;
      const key = o ? `${Boolean(o.left)}${Boolean(o.straight)}${Boolean(o.right)}${car.choice}${auto}${car.locked}` : '';
      if (key !== turnKey) {
        turnKey = key;
        setTurns(o ? { left: Boolean(o.left), straight: Boolean(o.straight), right: Boolean(o.right), chosen: car.choice, auto: auto as Choice | 'uturn' | null, locked: car.locked } : null);
      }
      if (!insetAt || distance(insetAt, at) > 60) drawInset(at);
      if (insetCar.current && insetAt) {
        const kx = 111320 * Math.cos((at[1] * Math.PI) / 180);
        const x = 70 + (at[0] - insetAt[0]) * kx * (70 / 500),
          y = 70 - (at[1] - insetAt[1]) * 110540 * (70 / 500);
        const t = `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${Math.round(heading)})`;
        if (t !== insetKey) {
          insetKey = t;
          insetCar.current.setAttribute('transform', t);
        }
      }
      if (debug) {
        stats.work.push(performance.now() - now);
        if (stats.work.length > 600) stats.work.shift();
      }
    };
    frame = requestAnimationFrame(tick);
    // A hidden tab stops drawing; when it comes back the car carries on from where it was, not further on.
    const vis = () => {
      last = performance.now();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(addFrame);
      document.removeEventListener('visibilitychange', vis);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('wheel', wheel);
      el.style.touchAction = touchWas;
      layerRef.current = null;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        removeBuildings(map);
        map.setSky(saved.sky ?? {});
        map.setMaxPitch(saved.maxPitch);
        handlers.forEach((h, i) => was[i] && h.enable());
        const end = car.pose().at;
        map.jumpTo({ center: end, zoom: 17, pitch: 0, bearing: 0 });
      } catch {
        // Map removed.
      }
    };
    // Set up once per drive; the controls are passed on below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMap, phase]);
  useEffect(() => {
    if (carRef.current) carRef.current.stopped = stopped;
  }, [stopped]);
  useEffect(() => {
    if (carRef.current) carRef.current.mode = mode;
  }, [mode]);

  const choose = useCallback((c: Choice) => {
    const car = carRef.current;
    if (!car || car.locked) return;
    car.choice = car.choice === c ? null : c;
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'Escape') onExit();
      else if (phase !== 'drive') return;
      else if (e.key === 'ArrowLeft') choose('left');
      else if (e.key === 'ArrowRight') choose('right');
      else if (e.key === 'ArrowUp') choose('straight');
      else if (e.key === ' ') setStopped((s) => !s);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [phase, choose, onExit]);

  const map = getMap();
  const exit = (
    <button type="button" className="vc-sv-bar-btn" data-icon-only="true" onClick={onExit} aria-label="Exit drive mode" title="Exit (Escape)">
      <X size={18} strokeWidth={2} />
    </button>
  );

  if (phase === 'road')
    return (
      <div className="vc-sv-note vc-drive-note" role="status">
        <div className="vc-sv-bar">
          {exit}
          <p className="vc-sv-title">{graph ? `${coarse ? 'Tap' : 'Click'} a road to start driving.` : error ? '' : 'Loading the roads.'}</p>
        </div>
        {error && <p className="vc-sv-hint">{error}</p>}
      </div>
    );

  const arrow = (c: Choice, on: boolean, icon: React.ReactNode, label: string) =>
    on && (
      <button type="button" className="vc-drive-turn" aria-pressed={turns?.chosen === c} data-auto={!turns?.chosen && turns?.auto === c ? 'true' : undefined} disabled={turns?.locked} onClick={() => choose(c)} aria-label={label}>
        {icon}
      </button>
    );

  return (
    <>
      {map && createPortal(<Sky getMap={getMap} />, map.getContainer())}
      <div className="vc-drive-hud">
        <div className="vc-sv-bar vc-drive-bar">
          {exit}
          <p className="vc-drive-speed" aria-live="off">
            <span ref={speedRef}>0</span> mph
          </p>
          <button type="button" className="vc-sv-bar-btn" onClick={() => setStopped((s) => !s)} aria-label={stopped ? 'Go' : 'Stop'} title={stopped ? 'Go (space)' : 'Stop (space)'}>
            {stopped ? <Play size={17} strokeWidth={2} aria-hidden="true" /> : <Pause size={17} strokeWidth={2} aria-hidden="true" />}
            <span>{stopped ? 'Go' : 'Stop'}</span>
          </button>
          <button
            type="button"
            className="vc-sv-bar-btn vc-drive-reset"
            onClick={() => {
              viewRef.current = CHASE;
              setChase(true);
            }}
            disabled={chase}
            aria-label="Reset view"
            title="Reset view: back behind the car"
          >
            <LocateFixed size={17} strokeWidth={2} aria-hidden="true" />
            <span>Reset view</span>
          </button>
          <div className="vc-drive-modes" role="radiogroup" aria-label="Speed">
            {(['slow', 'normal', 'fast'] as SpeedMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
                {m === 'slow' ? 'Slow' : m === 'normal' ? 'Normal' : 'Fast'}
              </button>
            ))}
          </div>
        </div>
        {turns && (
          <div className="vc-drive-turns" role="group" aria-label={turns.auto === 'uturn' ? 'Dead end ahead: turning around' : 'Turn at the next intersection'}>
            {turns.auto === 'uturn' ? (
              <p className="vc-drive-uturn">Dead end: turning around</p>
            ) : (
              <>
                {arrow('left', turns.left, <ArrowLeft size={24} strokeWidth={2.2} />, 'Turn left')}
                {arrow('straight', turns.straight, <ArrowUp size={24} strokeWidth={2.2} />, 'Go straight')}
                {arrow('right', turns.right, <ArrowRight size={24} strokeWidth={2.2} />, 'Turn right')}
              </>
            )}
          </div>
        )}
        <svg className="vc-drive-inset" viewBox="0 0 140 140" role="img" aria-label="Small map of where the car is">
          <rect width="140" height="140" rx="12" />
          <g ref={insetRef} className="vc-drive-inset-roads" />
          <g ref={insetCar}>
            <path d="M0 -7 L5 6 L0 3 L-5 6 Z" className="vc-drive-inset-car" />
          </g>
        </svg>
      </div>
    </>
  );
}
