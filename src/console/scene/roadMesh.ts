/**
 * Road furniture for the 3D street scene, drawn over the aerial photo (which already shows the asphalt):
 * lane markings (a yellow centre line, dashed on neighbourhood streets and double on bigger roads, white
 * edge lines on bigger roads), curbs along the road edges, sidewalks along OpenStreetMap's sidewalk lines,
 * crosswalk bars at marked crossings, and stop signs (a post and a red octagon) and traffic signal poles at
 * their nodes. Pure; positions are local meters (x east, y north, z up from the ground). Built in
 * scene.worker.ts with the buildings.
 */
import { MeshOut, type RGB } from './buildingMesh';
import type { XY } from './footprint';

export interface RoadIn {
  coords: XY[];
  /** Ground height above the origin's at each point. */
  dz: number[];
  highway: string;
  lanes?: number;
  oneway?: boolean;
}
export interface PathIn {
  coords: XY[];
  dz: number[];
  sidewalk?: boolean;
}
export interface SignIn {
  at: XY;
  dz: number;
  kind: 'stop' | 'give_way' | 'traffic_signals';
  /** Direction of the road at the sign, radians from east (the plate faces across it). */
  along: number;
}
export interface CrossingIn {
  at: XY;
  dz: number;
  /** Direction of the road, radians from east: the bars run across it. */
  along: number;
  width: number;
}

const YELLOW: RGB = [0.95, 0.78, 0.2];
const WHITE: RGB = [0.95, 0.95, 0.93];
const CURB: RGB = [0.82, 0.8, 0.76];
const WALK: RGB = [0.86, 0.85, 0.82];
const POST: RGB = [0.45, 0.46, 0.48];
const STOP_RED: RGB = [0.78, 0.1, 0.12];
const SIGNAL: RGB = [0.2, 0.2, 0.22];

/** Road width in meters by OpenStreetMap class (lanes tag overrides at 3.4 m a lane). */
export function roadWidth(highway: string, lanes?: number): number {
  if (lanes && lanes > 0) return Math.min(24, lanes * 3.4);
  switch (highway) {
    case 'motorway':
    case 'trunk':
      return 16;
    case 'primary':
      return 14;
    case 'secondary':
      return 12;
    case 'tertiary':
      return 10;
    case 'service':
    case 'living_street':
      return 5.5;
    default:
      return 8;
  }
}

/** Points along a polyline every `step` meters: position, direction (unit) and ground height. */
export function samples(coords: XY[], dz: number[], step: number, from = 0): Array<{ p: XY; d: XY; z: number; s: number }> {
  const out: Array<{ p: XY; d: XY; z: number; s: number }> = [];
  let total = 0;
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    total += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
    cum.push(total);
  }
  let seg = 0;
  for (let s = from; s <= total; s += step) {
    while (seg < coords.length - 2 && cum[seg + 1] < s) seg++;
    const a = coords[seg],
      b = coords[seg + 1];
    const l = cum[seg + 1] - cum[seg] || 1;
    const t = (s - cum[seg]) / l;
    const d: XY = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d, z: (dz[seg] ?? 0) + ((dz[seg + 1] ?? 0) - (dz[seg] ?? 0)) * t, s });
  }
  return out;
}

/** A flat strip `width` wide along the line, offset `off` to its left (negative: right), `z` up, with height `h` as a box when given. */
export function strip(out: MeshOut, coords: XY[], dz: number[], off: number, width: number, z: number, color: RGB, h = 0): void {
  const pts = samples(coords, dz, 2);
  if (pts.length < 2) return;
  const left = (q: { p: XY; d: XY }, o: number): XY => [q.p[0] - q.d[1] * o, q.p[1] + q.d[0] * o];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const a0 = left(a, off - width / 2),
      a1 = left(a, off + width / 2),
      b0 = left(b, off - width / 2),
      b1 = left(b, off + width / 2);
    const za = a.z + z,
      zb = b.z + z;
    out.quad([a0[0], a0[1], za + h], [b0[0], b0[1], zb + h], [b1[0], b1[1], zb + h], [a1[0], a1[1], za + h], color);
    if (h > 0) {
      out.quad([a0[0], a0[1], za], [b0[0], b0[1], zb], [b0[0], b0[1], zb + h], [a0[0], a0[1], za + h], color);
      out.quad([b1[0], b1[1], zb], [a1[0], a1[1], za], [a1[0], a1[1], za + h], [b1[0], b1[1], zb + h], color);
    }
  }
}

/** Dashes `dash` long with `gap` between, `width` wide, offset `off` left of the line. */
export function dashes(out: MeshOut, coords: XY[], dz: number[], off: number, width: number, dash: number, gap: number, z: number, color: RGB): void {
  const pts = samples(coords, dz, dash + gap, gap / 2);
  for (const q of pts) {
    const e: XY = [q.p[0] + q.d[0] * dash, q.p[1] + q.d[1] * dash];
    const nL: XY = [-q.d[1], q.d[0]];
    const c = (p: XY, o: number): [number, number, number] => [p[0] + nL[0] * o, p[1] + nL[1] * o, q.z + z];
    out.quad(c(q.p, off - width / 2), c(e, off - width / 2), c(e, off + width / 2), c(q.p, off + width / 2), color);
  }
}

/** A square post of side `side` from z0 to z1 at a point. */
export function post(out: MeshOut, at: XY, z0: number, z1: number, side: number, color: RGB): void {
  const h = side / 2;
  const c = [
    [at[0] - h, at[1] - h],
    [at[0] + h, at[1] - h],
    [at[0] + h, at[1] + h],
    [at[0] - h, at[1] + h],
  ] as XY[];
  for (let i = 0; i < 4; i++) {
    const a = c[i],
      b = c[(i + 1) % 4];
    out.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], color);
  }
  out.quad([c[0][0], c[0][1], z1], [c[1][0], c[1][1], z1], [c[2][0], c[2][1], z1], [c[3][0], c[3][1], z1], color);
}

/** A thin plate (an octagon with `sides` 8, a square with 4) standing at `at`, facing along `facing`, centred at height zc. */
function plate(out: MeshOut, at: XY, zc: number, r: number, facing: number, sides: number, color: RGB): void {
  // The plate's own axes: across (perpendicular to facing) and up.
  const ax: XY = [-Math.sin(facing), Math.cos(facing)];
  const rim: Array<[number, number, number]> = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / sides;
    rim.push([at[0] + ax[0] * r * Math.cos(a), at[1] + ax[1] * r * Math.cos(a), zc + r * Math.sin(a)]);
  }
  const c: [number, number, number] = [at[0], at[1], zc];
  for (let i = 0; i < sides; i++) {
    out.tri(c, rim[i], rim[(i + 1) % sides], color);
    out.tri(c, rim[(i + 1) % sides], rim[i], color);
  }
}

export function stopSign(out: MeshOut, s: SignIn): void {
  const z0 = s.dz;
  post(out, s.at, z0, z0 + 2.2, 0.08, POST);
  if (s.kind === 'traffic_signals') {
    post(out, s.at, z0 + 2.2, z0 + 4.6, 0.12, POST);
    plate(out, s.at, z0 + 4.2, 0.42, s.along, 4, SIGNAL);
    return;
  }
  plate(out, s.at, z0 + 2.2, s.kind === 'stop' ? 0.38 : 0.34, s.along, s.kind === 'stop' ? 8 : 3, s.kind === 'stop' ? STOP_RED : WHITE);
}

export function crosswalk(out: MeshOut, c: CrossingIn): void {
  // Bars 0.5 m wide every 1 m, across the road, in the road's own direction.
  const along: XY = [Math.cos(c.along), Math.sin(c.along)];
  const across: XY = [-along[1], along[0]];
  const n = Math.max(2, Math.floor(c.width / 1));
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * 1;
    const mid: XY = [c.at[0] + across[0] * t, c.at[1] + across[1] * t];
    const p = (u: number, v: number): [number, number, number] => [mid[0] + along[0] * u + across[0] * v, mid[1] + along[1] * u + across[1] * v, c.dz + 0.03];
    out.quad(p(-1.4, -0.25), p(1.4, -0.25), p(1.4, 0.25), p(-1.4, 0.25), WHITE);
  }
}

/** Markings and curbs for one road. */
export function road(out: MeshOut, r: RoadIn): void {
  if (r.coords.length < 2) return;
  const w = roadWidth(r.highway, r.lanes);
  const big = /^(primary|secondary|trunk|motorway)/.test(r.highway);
  const lane = 0.12;
  if (!r.oneway && r.highway !== 'service' && r.highway !== 'living_street') {
    if (big) {
      strip(out, r.coords, r.dz, 0.15, lane, 0.03, YELLOW);
      strip(out, r.coords, r.dz, -0.15, lane, 0.03, YELLOW);
    } else dashes(out, r.coords, r.dz, 0, lane, 3, 9, 0.03, YELLOW);
  }
  if (big || r.highway === 'tertiary') {
    strip(out, r.coords, r.dz, w / 2 - 0.3, lane, 0.03, WHITE);
    strip(out, r.coords, r.dz, -(w / 2 - 0.3), lane, 0.03, WHITE);
  }
  // Lane lines between lanes going the same way.
  const lanes = r.lanes ?? 0;
  if (lanes >= 2) {
    const per = r.oneway ? lanes : lanes / 2;
    const laneW = w / lanes;
    for (let k = 1; k < per; k++) {
      const o = r.oneway ? w / 2 - k * laneW : k * laneW;
      dashes(out, r.coords, r.dz, o, lane, 3, 9, 0.03, WHITE);
      if (!r.oneway) dashes(out, r.coords, r.dz, -o, lane, 3, 9, 0.03, WHITE);
    }
  }
  if (r.highway !== 'service' && r.highway !== 'motorway' && r.highway !== 'trunk') {
    strip(out, r.coords, r.dz, w / 2 + 0.1, 0.2, 0, CURB, 0.14);
    strip(out, r.coords, r.dz, -(w / 2 + 0.1), 0.2, 0, CURB, 0.14);
  }
}

export function sidewalk(out: MeshOut, p: PathIn): void {
  strip(out, p.coords, p.dz, 0, p.sidewalk ? 1.6 : 1.2, 0, WALK, p.sidewalk ? 0.12 : 0.04);
}

export function roadsMesh(roads: RoadIn[], paths: PathIn[], signs: SignIn[], crossings: CrossingIn[]): Float32Array {
  const out = new MeshOut();
  for (const r of roads) road(out, r);
  for (const p of paths) sidewalk(out, p);
  for (const c of crossings) crosswalk(out, c);
  for (const s of signs) stopSign(out, s);
  return new Float32Array(out.data);
}
