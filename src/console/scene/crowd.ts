/**
 * The walking pedestrians of the street scene: a mesh layer (meshLayer.ts) redrawn each frame from people.ts
 * while the scene is up. Given the paths around the view (local meters around the scene's origin), it spawns
 * a crowd and keeps them walking; the frame loop runs only while the layer is on the map and the tab shows.
 */
import type * as maplibregl from 'maplibre-gl';
import { meshLayer, type MeshLayer } from './meshLayer';
import { peopleMesh, spawnWalkers, stepWalkers, type Walker, type WalkPath } from './people';
import type { XY } from './footprint';

export const PEOPLE_LAYER = 'vtp-sv-people';
/** Walkers around a view. */
const CROWD = 48;

interface Crowd {
  layer: MeshLayer;
  paths: WalkPath[];
  /** Each path's key (its first point in longitude and latitude), so walkers keep their path across redraws. */
  keys: string[];
  walkers: Walker[];
  origin: [number, number, number];
  near: XY | null;
  frame: number;
  last: number;
}
const crowds = new WeakMap<maplibregl.Map, Crowd>();

export function addCrowd(map: maplibregl.Map, before?: string): void {
  let c = crowds.get(map);
  if (!c) {
    c = { layer: meshLayer(PEOPLE_LAYER), paths: [], keys: [], walkers: [], origin: [0, 0, 0], near: null, frame: 0, last: 0 };
    crowds.set(map, c);
  }
  if (!map.getLayer(PEOPLE_LAYER)) map.addLayer(c.layer, before);
}

/**
 * The paths to walk (local meters around `origin`, each with its key). Walkers whose path is still there keep
 * walking it; the rest are spawned afresh, so a redraw as the view moves never makes anyone jump.
 */
export function setCrowdPaths(map: maplibregl.Map, origin: [number, number, number], paths: Array<WalkPath & { key: string }>, near: XY | null): void {
  const c = crowds.get(map);
  if (!c) return;
  const kept = paths.filter((p) => p.coords.length >= 2);
  const index = new Map(kept.map((p, i) => [p.key, i]));
  const stay = c.walkers.filter((w) => index.has(c.keys[w.path])).map((w) => ({ ...w, path: index.get(c.keys[w.path])! }));
  c.origin = origin;
  c.paths = kept.map(({ coords, dz }) => ({ coords, dz }));
  c.keys = kept.map((p) => p.key);
  c.near = near;
  c.walkers = [...stay, ...spawnWalkers(c.paths, Math.max(0, CROWD - stay.length))];
  c.last = 0;
  if (!c.frame) tick(map, c);
}

function tick(map: maplibregl.Map, c: Crowd): void {
  c.frame = requestAnimationFrame((now) => {
    c.frame = 0;
    if (crowds.get(map) !== c || !map.getLayer(PEOPLE_LAYER)) return;
    const dt = c.last ? Math.min(0.1, (now - c.last) / 1000) : 0;
    c.last = now;
    if (c.walkers.length) {
      stepWalkers(c.walkers, c.paths, dt);
      c.layer.setMesh({ origin: c.origin, data: peopleMesh(c.walkers, c.paths, c.near) });
    }
    tick(map, c);
  });
}

export function removeCrowd(map: maplibregl.Map): void {
  const c = crowds.get(map);
  if (!c) return;
  if (c.frame) cancelAnimationFrame(c.frame);
  c.frame = 0;
  try {
    if (map.getLayer(PEOPLE_LAYER)) map.removeLayer(PEOPLE_LAYER);
  } catch {
    // Map removed.
  }
  crowds.delete(map);
}
