/**
 * Drive mode (Tools, Drive): pick one of three cars and a color, tap a road, and the car drives along the real
 * roads of Vineyard and a little around it, in its lane, at a steady town speed, with the camera just behind
 * and above it on the 3D terrain with buildings and scenery. Near an intersection, arrows show the ways on;
 * with no choice it goes straight or follows the road, and turns around at a dead end. Stop and Go, three
 * speeds, a small map of where it is, and Exit back to the map at the car's spot. Keys: left and right
 * arrows (up for straight), space to stop or go, Escape to exit. Pauses while the tab is hidden.
 *
 * Its own chunk, loaded only when Drive is picked; the road graph is built in a worker (graph.worker.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { ArrowLeft, ArrowRight, ArrowUp, Pause, Play, X } from 'lucide-react';
import { destination } from '../measure/geo';
import { addBuildings, enter3d, removeBuildings, type Saved } from '../streetview/threeD';
import { Sky } from '../streetview/Sky';
import { watchTaps } from '../streetview/watchTaps';
import { createPortal } from 'react-dom';
import { canDrive, nearestEdge, type Graph, type Leg, type Pos, type SpeedMode } from './graph';
import { CAR_COLORS, CAR_KINDS, carLayer, type CarKind, type CarLayer } from './carLayer';
import { Car, type Choice } from './sim';
import { distance, bearing as bearingOf } from '../measure/geo';

/** Vineyard and about a kilometer and a half around it: the roads Drive mode uses. */
const BOX = { west: -111.79, south: 40.264, east: -111.69, north: 40.352 };
const LAYER_ID = 'vtp-drive-car';

type Phase = 'car' | 'road' | 'drive';

interface Props {
  getMap: () => maplibregl.Map | null;
  ready: boolean;
  dark: boolean;
  onExit: () => void;
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

/** A side view of each car for the picker. */
function CarIcon({ kind, color }: { kind: CarKind; color: string }) {
  const body = { sedan: 'M6 26h52l-3-8-10-1-6-7H22l-7 7-8 2z', suv: 'M5 26h54l-2-10-9-1-4-7H16l-5 7-5 2z', hatch: 'M8 26h47l-3-9-6-1-7-7H24l-8 8-7 2z' }[kind];
  return (
    <svg viewBox="0 0 64 34" width="64" height="34" aria-hidden="true">
      <path d={body} fill={color} stroke="#222" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="18" cy="27" r="4.5" fill="#1b1b1d" />
      <circle cx="46" cy="27" r="4.5" fill="#1b1b1d" />
    </svg>
  );
}

export default function DriveMode({ getMap, ready, dark, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>('car');
  const [kind, setKind] = useState<CarKind>('sedan');
  const [color, setColor] = useState(CAR_COLORS[0].hex);
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

  // Driving: 3D on, the car layer, the chase camera, one step a frame.
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
    const layer = carLayer(LAYER_ID, kind, color);
    layerRef.current = layer;
    if (!map.getLayer(LAYER_ID)) map.addLayer(layer);
    let camHeading = first.heading;
    let last = performance.now();
    let turnKey = '';
    let insetAt: Pos | null = null;
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
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      car.step(dt);
      const { at, heading } = car.pose();
      const elevation = map.queryTerrainElevation({ lng: at[0], lat: at[1] }) ?? 0;
      layer.place(at, heading, elevation);
      // The camera follows smoothly, a little behind the car's turns.
      const d = ((heading - camHeading + 540) % 360) - 180;
      camHeading += d * Math.min(1, dt * 2.5);
      // Close behind and above, low enough to see the car's back (lights, wheels): about a sixth of the screen's width.
      map.jumpTo({ center: destination(at, camHeading, 7), bearing: camHeading, pitch: 66, zoom: 20.3 });
      if (speedRef.current) speedRef.current.textContent = String(Math.round(car.v / 0.44704));
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
        insetCar.current.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${heading.toFixed(0)})`);
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
    // Set up once per drive; the car's look and controls are passed on below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getMap, phase]);

  useEffect(() => layerRef.current?.setLook(kind, color), [kind, color]);
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

  if (phase === 'car')
    return (
      <div className="vc-drive-pick" role="dialog" aria-label="Pick a car">
        <div className="vc-drive-pick-head">
          <p className="vc-drive-title">Pick a car</p>
          {exit}
        </div>
        <div className="vc-drive-cars" role="radiogroup" aria-label="Car">
          {CAR_KINDS.map((c) => (
            <button key={c.kind} type="button" role="radio" aria-checked={kind === c.kind} className="vc-drive-car" onClick={() => setKind(c.kind)}>
              <CarIcon kind={c.kind} color={color} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <div className="vc-drive-colors" role="radiogroup" aria-label="Color">
          {CAR_COLORS.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={color === c.hex} aria-label={c.label} className="vc-drive-color" style={{ background: c.hex }} onClick={() => setColor(c.hex)} />
          ))}
        </div>
        <button type="button" className="vc-drive-go" onClick={() => setPhase('road')}>
          Next: pick a road
        </button>
      </div>
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
