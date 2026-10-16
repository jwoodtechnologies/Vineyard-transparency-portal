/**
 * The street scene's buildings: OpenFreeMap's footprints in view, each with its height from the records
 * (heights.ts), its roof colour read off the county aerial and a roof shaped from its outline, drawn as one
 * mesh (meshLayer.ts) built in a worker (scene.worker.ts). The buildings around the eye level camera are
 * left out so it never stands inside a wall. Keeps each building's outline and top for hit testing
 * (pickGround.ts).
 */
import type * as maplibregl from 'maplibre-gl';
import type { MultiPolygon, Polygon } from 'geojson';
import { centerOf, heightFor, mergedBlocks, OMT_UNKNOWN_M, toneOf, type StoryIndex } from '../streetview/heights';
import { countyAerial } from '../mapBase';
import { meshLayer, type MeshLayer } from './meshLayer';
import { pushOut, toLocal } from './footprint';
import { nearestRoadPoint } from './roadsNear';
import { addCrowd, removeCrowd, setCrowdPaths } from './crowd';
import osmUrl from './data/vineyard-osm.json?url';
import type { SceneAnswer, SceneBuilding, SceneNode, ScenePath, ScenePick, SceneRequest, SceneRoad } from './scene.worker';

type Pos = [number, number];
export const SCENE_LAYER = 'vtp-sv-scene';

/** Warm light wall tones, and shingle roof browns for when the photo gives no colour. */
const WALLS: Array<[number, number, number]> = [
  [0.9, 0.86, 0.8],
  [0.86, 0.8, 0.72],
  [0.93, 0.9, 0.84],
  [0.84, 0.79, 0.71],
];
const WALLS_DARK: Array<[number, number, number]> = [
  [0.46, 0.44, 0.42],
  [0.49, 0.46, 0.42],
  [0.43, 0.41, 0.39],
  [0.48, 0.45, 0.41],
];
const ROOF_DEFAULT: [number, number, number] = [0.43, 0.37, 0.34];

/** The OpenStreetMap data for Vineyard (scripts/data/trim-osm.mjs), loaded once when the scene first draws. */
interface OsmData {
  signs: Array<{ at: [number, number]; kind: string }>;
  /** Marked crossings only. */
  crossings: Array<{ at: [number, number]; kind: string }>;
  paths: Array<{ coords: Array<[number, number]>; kind: string; sidewalk?: boolean; crossing?: boolean }>;
  roads: Array<{ coords: Array<[number, number]>; highway: string; lanes?: string; oneway?: string }>;
  green: Array<{ ring: Array<[number, number]>; kind: string }>;
  trees: Array<[number, number]>;
}
let osm: OsmData | null = null;
let osmLoading: Promise<OsmData> | null = null;
/** The OpenStreetMap data once loaded (loadOsm starts it; Drive mode reads the stop signs from it). */
export function loadOsm(onLoaded: () => void): OsmData | null {
  if (osm) return osm;
  // Fetched as a plain file (compressed on the way, parsed by JSON.parse), not bundled as a script.
  if (!osmLoading)
    osmLoading = fetch(osmUrl)
      .then((r) => r.json())
      .then((m) => {
        osm = m as OsmData;
        onLoaded();
        return osm;
      });
  return null;
}

/** How far from the view's centre road furniture is built, in degrees (about 550 m). */
const NEAR = 0.005;

/** The roads, paths, signs and crossings within NEAR of a point, with the ground's height at each point. */
function furnitureNear(map: maplibregl.Map, c: Pos, originZ: number, data: OsmData): Pick<SceneRequest, 'roads' | 'paths' | 'signs' | 'crossings'> {
  const near = (p: [number, number]) => Math.abs(p[0] - c[0]) < NEAR * 1.3 && Math.abs(p[1] - c[1]) < NEAR;
  const dzAt = (p: [number, number]) => (map.queryTerrainElevation({ lng: p[0], lat: p[1] }) ?? originZ) - originZ;
  const roads: SceneRoad[] = [];
  for (const r of data.roads) {
    if (!r.coords.some(near)) continue;
    const lanes = r.lanes ? parseInt(r.lanes, 10) : undefined;
    roads.push({ coords: r.coords, dz: r.coords.map(dzAt), highway: r.highway, lanes: Number.isFinite(lanes) ? lanes : undefined, oneway: r.oneway === 'yes' || r.oneway === '-1' });
  }
  const paths: ScenePath[] = [];
  for (const p of data.paths) {
    if (p.crossing || !p.coords.some(near)) continue;
    paths.push({ coords: p.coords, dz: p.coords.map(dzAt), sidewalk: p.sidewalk });
  }
  const signs: SceneNode[] = data.signs.filter((s) => near(s.at)).map((s) => ({ at: s.at, dz: dzAt(s.at), kind: s.kind }));
  const crossings: SceneNode[] = data.crossings.filter((x) => near(x.at)).map((x) => ({ at: x.at, dz: dzAt(x.at), kind: x.kind }));
  return { roads, paths, signs, crossings };
}

interface State {
  layer: MeshLayer;
  /** Told where to stand when the eye was inside a building (the pin moves there). */
  onEyeOut: ((at: Pos) => void) | null;
  worker: Worker | null;
  picks: ScenePick[];
  busy: number;
  queued: SceneRequest | null;
  next: number;
}
const states = new WeakMap<maplibregl.Map, State>();

/** Street view listens here: when its pin lands inside a building, the spot just outside it to stand at. */
export function onEyeOut(map: maplibregl.Map, cb: ((at: Pos) => void) | null): void {
  const st = states.get(map);
  if (st) st.onEyeOut = cb;
}

/** Where to stand when `eye` is inside a building: just outside its nearest wall, EYE_CLEAR_M out. */
export function standOutside(eye: Pos, rings: Pos[][]): Pos | null {
  const local = toLocal(eye);
  const kx = 111320 * Math.cos((eye[1] * Math.PI) / 180);
  for (const ring of rings) {
    if (!inRing(ring, eye)) continue;
    const out = pushOut(ring.map(local), [0, 0], EYE_CLEAR_M);
    return [eye[0] + out[0] / kx, eye[1] + out[1] / 110540];
  }
  return null;
}

/** Set by threeD.ts: asks for the scene to be drawn again (when the OpenStreetMap data arrives). */
export let heightsRedraw: ((map: maplibregl.Map) => void) | null = null;
export function setRedraw(fn: (map: maplibregl.Map) => void): void {
  heightsRedraw = fn;
}

/** The building outlines and tops now drawn, for hit testing. */
export function scenePicks(map: maplibregl.Map): ScenePick[] {
  return states.get(map)?.picks ?? [];
}

/** Adds the scene layer (before `before`) if it is not there. */
export function addScene(map: maplibregl.Map, before?: string): void {
  let st = states.get(map);
  if (!st) {
    st = { layer: meshLayer(SCENE_LAYER), onEyeOut: null, worker: null, picks: [], busy: 0, queued: null, next: 1 };
    states.set(map, st);
  }
  if (!map.getLayer(SCENE_LAYER)) map.addLayer(st.layer, before);
  addCrowd(map, before);
}

export function removeScene(map: maplibregl.Map): void {
  const st = states.get(map);
  if (!st) return;
  st.worker?.terminate();
  st.worker = null;
  st.picks = [];
  removeCrowd(map);
  try {
    if (map.getLayer(SCENE_LAYER)) map.removeLayer(SCENE_LAYER);
  } catch {
    // Map removed.
  }
  states.delete(map);
}

const EYE_CLEAR_M = 8;

/** Whether a ring covers a point or comes within EYE_CLEAR_M of it. */
function aroundEye(ring: Pos[], eye: Pos): boolean {
  const kx = 111320 * Math.cos((eye[1] * Math.PI) / 180);
  const probes: Pos[] = [eye];
  for (let a = 0; a < 360; a += 45) probes.push([eye[0] + (EYE_CLEAR_M * Math.sin((a * Math.PI) / 180)) / kx, eye[1] + (EYE_CLEAR_M * Math.cos((a * Math.PI) / 180)) / 110540]);
  return probes.some((p) => inRing(ring, p));
}
function inRing(r: Pos[], p: Pos): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  return inside;
}

/** Square kilometers of a ring (flat, for sizing). */
function ringM2(r: Pos[]): number {
  const k = 111320 * Math.cos(((r[0]?.[1] ?? 0) * Math.PI) / 180);
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] * k + r[i][0] * k) * (r[j][1] * 110540 - r[i][1] * 110540);
  return Math.abs(a / 2);
}

/**
 * Builds the scene from the map's building features: once each (the same building comes from every tile it
 * touches), without blocks merged by lower zoom tiles, without anything around the eye, with the records'
 * heights and the ground's height at each. The worker answers with the mesh, which replaces the last one.
 */
export function drawScene(map: maplibregl.Map, feats: Array<{ geometry: Polygon | MultiPolygon; properties: Record<string, unknown> | null }>, index: StoryIndex, eye: Pos | null, dark: boolean, onDone?: (a: SceneAnswer) => void): void {
  const st = states.get(map);
  if (!st) return;
  const c = map.getCenter();
  const originZ = map.queryTerrainElevation(c) ?? 0;
  const origin: [number, number, number] = [c.lng, c.lat, originZ];
  const merged = mergedBlocks(feats);
  const seen = new Set<string>();
  const list: SceneBuilding[] = [];
  feats.forEach((f, i) => {
    if (merged.has(i)) return;
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      const ring = poly[0] as Pos[];
      if (!ring || ring.length < 4) continue;
      const mid = centerOf({ type: 'Polygon', coordinates: [ring] });
      if (!mid) continue;
      const m2 = ringM2(ring);
      const key = `${mid[0].toFixed(5)},${mid[1].toFixed(5)},${Math.round(m2 / 5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (eye && inRing(ring, eye)) {
        // The camera stands inside this building: street view moves the pin to the nearest street, or just outside the wall.
        const out = (osm && nearestRoadPoint(osm.roads, eye, 40)) ?? standOutside(eye, [ring]);
        if (out && st.onEyeOut) {
          const cb = st.onEyeOut;
          setTimeout(() => cb(out), 0);
        }
        continue;
      }
      if (eye && aroundEye(ring, eye)) continue;
      const p = f.properties ?? {};
      const osmH = Number(p.render_height);
      const recorded = Number.isFinite(osmH) && osmH > 0 && osmH !== OMT_UNKNOWN_M;
      const base = Number(p.render_min_height) || 0;
      const height = Math.max(base + 1, heightFor(p.render_height, index.at(mid)));
      const dz = (map.queryTerrainElevation({ lng: mid[0], lat: mid[1] }) ?? originZ) - originZ;
      const k = toneOf(mid);
      list.push({ ring, height, base, recorded, dz, wall: (dark ? WALLS_DARK : WALLS)[k], roof: ROOF_DEFAULT });
    }
  });
  const data = loadOsm(() => heightsRedraw?.(map));
  const near = data ? furnitureNear(map, [c.lng, c.lat], originZ, data) : null;
  const req: SceneRequest = { id: st.next++, origin, buildings: list, aerial: countyAerial(), ...(near ?? {}) };
  if (near) {
    // The pedestrians walk the sidewalks and paths around the view.
    const local = toLocal([origin[0], origin[1]]);
    setCrowdPaths(map, origin, near.paths!.map((p) => ({ key: p.coords[0].join(','), coords: p.coords.map(local), dz: p.dz })), eye ? local(eye) : null);
  }
  if (st.busy) {
    st.queued = req;
    return;
  }
  send(map, st, req, dark, onDone);
}

function send(map: maplibregl.Map, st: State, req: SceneRequest, dark: boolean, onDone?: (a: SceneAnswer) => void): void {
  if (!st.worker) {
    st.worker = new Worker(new URL('./scene.worker.ts', import.meta.url), { type: 'module' });
    st.worker.onerror = () => {
      st.busy = 0;
    };
  }
  st.busy = req.id;
  st.worker.onmessage = (e: MessageEvent<SceneAnswer & { error?: string }>) => {
    st.busy = 0;
    const a = e.data;
    if (!a.error && a.id === req.id) {
      st.layer.setMesh({ origin: a.origin, data: a.mesh });
      st.picks = a.picks;
      onDone?.(a);
      // For the live checks only (localStorage vtp:debug): what the scene holds.
      try {
        if (localStorage.getItem('vtp:debug')) (window as Window & { __vtpScene?: unknown }).__vtpScene = { buildings: a.picks.length, photoRoofs: a.photoRoofs, triangles: a.mesh.length / 18, note: a.note ?? null, at: Date.now() };
      } catch {
        // Storage blocked.
      }
    }
    if (st.queued) {
      const q = st.queued;
      st.queued = null;
      send(map, st, q, dark, onDone);
    }
  };
  st.worker.postMessage(req);
}
