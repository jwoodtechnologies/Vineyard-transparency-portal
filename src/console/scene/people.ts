/**
 * Pedestrians for the street scene: small figures walking the sidewalks and paths (OpenStreetMap lines in
 * local meters with the ground's height at each point). Pure: spawning, stepping and the triangles for a
 * frame (interleaved x, y, z, r, g, b, lit like the rest of the scene). A figure is a few boxes 1.7 m tall:
 * two legs that swing as it walks, a body, a head, in its own clothes colours.
 */
import { MeshOut, type RGB } from './buildingMesh';
import type { XY } from './footprint';

export interface WalkPath {
  coords: XY[];
  dz: number[];
}

export interface Walker {
  path: number;
  /** Meters along the path. */
  s: number;
  /** +1 along the path, -1 back. */
  dir: 1 | -1;
  /** Meters a second. */
  speed: number;
  /** Where in the stride the legs are, radians. */
  phase: number;
  shirt: RGB;
  pants: RGB;
  skin: RGB;
  hair: RGB;
}

export const WALK_SPEED = 1.3;
const SHIRTS: RGB[] = [
  [0.85, 0.25, 0.2],
  [0.2, 0.4, 0.75],
  [0.92, 0.9, 0.85],
  [0.25, 0.6, 0.35],
  [0.95, 0.75, 0.2],
  [0.3, 0.3, 0.35],
  [0.75, 0.4, 0.7],
  [0.1, 0.55, 0.6],
];
const PANTS: RGB[] = [
  [0.2, 0.25, 0.4],
  [0.15, 0.15, 0.17],
  [0.55, 0.5, 0.42],
  [0.35, 0.35, 0.4],
];
const SKINS: RGB[] = [
  [0.95, 0.8, 0.68],
  [0.85, 0.65, 0.5],
  [0.6, 0.42, 0.3],
  [0.4, 0.27, 0.2],
];
const HAIRS: RGB[] = [
  [0.1, 0.08, 0.06],
  [0.35, 0.22, 0.12],
  [0.7, 0.55, 0.3],
  [0.5, 0.5, 0.5],
];

export function pathLength(p: WalkPath): number {
  let l = 0;
  for (let i = 1; i < p.coords.length; i++) l += Math.hypot(p.coords[i][0] - p.coords[i - 1][0], p.coords[i][1] - p.coords[i - 1][1]);
  return l;
}

/** `n` walkers spread over the paths (longer paths get more), with `rand` in [0, 1). */
export function spawnWalkers(paths: WalkPath[], n: number, rand: () => number = Math.random): Walker[] {
  const lens = paths.map(pathLength);
  const total = lens.reduce((a, b) => a + b, 0);
  const out: Walker[] = [];
  if (!total) return out;
  for (let k = 0; k < n; k++) {
    let pick = rand() * total;
    let path = 0;
    while (path < lens.length - 1 && pick > lens[path]) pick -= lens[path++];
    const choose = <T>(list: T[]) => list[Math.floor(rand() * list.length) % list.length];
    out.push({ path, s: Math.min(pick, lens[path]), dir: rand() < 0.5 ? 1 : -1, speed: WALK_SPEED * (0.8 + 0.4 * rand()), phase: rand() * Math.PI * 2, shirt: choose(SHIRTS), pants: choose(PANTS), skin: choose(SKINS), hair: choose(HAIRS) });
  }
  return out;
}

/** Walks everyone on by `dt` seconds; at a path's end a walker turns round. */
export function stepWalkers(walkers: Walker[], paths: WalkPath[], dt: number): void {
  for (const w of walkers) {
    const len = pathLength(paths[w.path]);
    w.s += w.dir * w.speed * dt;
    if (w.s > len) {
      w.s = len;
      w.dir = -1;
    } else if (w.s < 0) {
      w.s = 0;
      w.dir = 1;
    }
    w.phase += (w.speed / 0.7) * dt;
  }
}

/** Where a walker stands and which way it faces (unit, along its walk). */
export function walkerAt(w: Walker, p: WalkPath): { at: [number, number, number]; d: XY } {
  const c = p.coords;
  let s = w.s;
  for (let i = 1; i < c.length; i++) {
    const l = Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
    if (s <= l || i === c.length - 1) {
      const t = l > 0 ? Math.min(1, s / l) : 0;
      const d: XY = l > 0 ? [((c[i][0] - c[i - 1][0]) / l) * w.dir, ((c[i][1] - c[i - 1][1]) / l) * w.dir] : [1, 0];
      return { at: [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t, (p.dz[i - 1] ?? 0) + ((p.dz[i] ?? 0) - (p.dz[i - 1] ?? 0)) * t], d };
    }
    s -= l;
  }
  return { at: [c[0][0], c[0][1], p.dz[0] ?? 0], d: [1, 0] };
}

/** A box in the walker's own frame (x across, y along the walk, z up) at `at`, turned to face `d`. */
function box(out: MeshOut, at: [number, number, number], d: XY, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB): void {
  const p = (x: number, y: number, z: number): [number, number, number] => [at[0] + x * d[1] + y * d[0], at[1] - x * d[0] + y * d[1], at[2] + z];
  const a = p(x0, y0, z0),
    b = p(x1, y0, z0),
    cc = p(x1, y1, z0),
    dd = p(x0, y1, z0),
    e = p(x0, y0, z1),
    f = p(x1, y0, z1),
    g = p(x1, y1, z1),
    h = p(x0, y1, z1);
  out.quad(e, f, g, h, c);
  out.quad(a, b, f, e, c);
  out.quad(b, cc, g, f, c);
  out.quad(cc, dd, h, g, c);
  out.quad(dd, a, e, h, c);
}

/** The frame's triangles for everyone within `within` meters of `near` (all of them when near is null). */
export function peopleMesh(walkers: Walker[], paths: WalkPath[], near: XY | null = null, within = 250): Float32Array {
  const out = new MeshOut();
  for (const w of walkers) {
    const { at, d } = walkerAt(w, paths[w.path]);
    if (near && Math.hypot(at[0] - near[0], at[1] - near[1]) > within) continue;
    const swing = Math.sin(w.phase) * 0.22;
    // Legs (0 to 0.8 m), each swung the other way; body to 1.45; head to 1.7.
    box(out, at, d, -0.16, -0.02, -0.08 + swing, 0.08 + swing, 0, 0.8, w.pants);
    box(out, at, d, 0.02, 0.16, -0.08 - swing, 0.08 - swing, 0, 0.8, w.pants);
    box(out, at, d, -0.22, 0.22, -0.11, 0.11, 0.8, 1.45, w.shirt);
    box(out, at, d, -0.1, 0.1, -0.1, 0.1, 1.47, 1.68, w.skin);
    box(out, at, d, -0.11, 0.11, -0.11, 0.06, 1.6, 1.72, w.hair);
  }
  return new Float32Array(out.data);
}
