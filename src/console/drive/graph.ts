/**
 * Drive mode's road network: OpenFreeMap's road lines (OpenMapTiles "transportation" layer) for Vineyard and a
 * little around it, joined into a graph of intersections and the roads between them. Built in a worker
 * (graph.worker.ts); this module is plain functions so it can be tested.
 *
 * - Lines are cut exactly at tile edges (tiles carry a margin that overlaps the next tile), so the pieces of
 *   a road from two tiles meet end to end and join.
 * - A point shared by two roads, or where a road ends, is a node. Roads run between nodes.
 * - Cars keep right: on a two way road the lane is half a lane to the right of the center line; a one way
 *   road (oneway 1, or -1 for against the line's direction) is driven only its way, in the middle.
 */
import { bearing, destination, distance, nearestOnSegment, type Pos } from '../measure/geo';

export type { Pos };

/** Road classes that cars use, and their speed in miles an hour (25 to 35 in town). */
export const CLASS_MPH: Record<string, number> = {
  motorway: 35,
  trunk: 35,
  primary: 35,
  secondary: 35,
  tertiary: 30,
  minor: 25,
  service: 25,
};

export const MPH = 0.44704;
export type SpeedMode = 'slow' | 'normal' | 'fast';
const SPEED_SCALE: Record<SpeedMode, number> = { slow: 0.65, normal: 1, fast: 1.35 };

/** Steady speed on a road class, in meters a second. */
export const cruiseSpeed = (cls: string, mode: SpeedMode = 'normal') => (CLASS_MPH[cls] ?? 25) * MPH * SPEED_SCALE[mode];

export interface Seg {
  coords: Pos[];
  cls: string;
  /** 1: only along the line's direction; -1: only against it; 0: both ways. */
  oneway: 0 | 1 | -1;
  name?: string;
  /** 'bridge' or 'tunnel': crosses other roads without meeting them. */
  brunnel?: string;
}

export interface Edge extends Seg {
  id: number;
  a: number;
  b: number;
  len: number;
}

export interface Graph {
  nodes: Pos[];
  edges: Edge[];
  /** For each node, the edges that touch it. */
  at: number[][];
}

/**
 * Cuts a line in tile coordinates to the tile's own square (0 to extent), splitting it where it leaves and
 * comes back. Liang and Barsky's clipping, one segment at a time.
 */
export function clipToTile(line: Array<[number, number]>, extent: number): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  const push = (p: [number, number]) => {
    const last = cur[cur.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) cur.push(p);
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const dx = x1 - x0,
      dy = y1 - y0;
    let t0 = 0,
      t1 = 1;
    let ok = true;
    for (const [p, q] of [
      [-dx, x0],
      [dx, extent - x0],
      [-dy, y0],
      [dy, extent - y0],
    ] as Array<[number, number]>) {
      if (p === 0) {
        if (q < 0) ok = false;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) {
      if (cur.length > 1) out.push(cur);
      cur = [];
      continue;
    }
    const a: [number, number] = [x0 + t0 * dx, y0 + t0 * dy];
    const b: [number, number] = [x0 + t1 * dx, y0 + t1 * dy];
    if (t0 > 0 && cur.length) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    push(a);
    push(b);
    if (t1 < 1) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Points within about half a meter are one point. */
const key = ([x, y]: Pos) => `${Math.round(x * 2e5)},${Math.round(y * 2e5)}`;

/**
 * Puts a shared point wherever two roads meet without one: where they cross (the tiles' simplification can
 * drop the crossing point on a straight road), and where one ends on another (a T junction). Bridges and
 * tunnels cross without meeting.
 */
export function addJunctions(segs: Seg[]): Seg[] {
  const CELL = 0.0006; // about 50 to 65 m
  const kx = 111320 * Math.cos((40.3 * Math.PI) / 180),
    ky = 110540;
  type Piece = { s: number; i: number };
  const grid = new Map<string, Piece[]>();
  const cells = (a: Pos, b: Pos) => {
    const out: string[] = [];
    for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) out.push(`${x},${y}`);
    return out;
  };
  segs.forEach((s, si) =>
    s.coords.forEach((p, i) => {
      if (i + 1 >= s.coords.length) return;
      for (const c of cells(p, s.coords[i + 1])) {
        let list = grid.get(c);
        if (!list) grid.set(c, (list = []));
        list.push({ s: si, i });
      }
    }),
  );
  // Points to add inside segments (by line and segment, how far along, 0 to 1), and line ends to move.
  const inner = new Map<string, Array<{ t: number; p: Pos }>>();
  const snaps = new Map<string, Pos>();
  const addInner = (si: number, i: number, t: number, p: Pos) => {
    const k = `${si}:${i}`;
    let l = inner.get(k);
    if (!l) inner.set(k, (l = []));
    if (!l.some((x) => Math.abs(x.t - t) < 1e-6)) l.push({ t, p });
  };
  const flat = (p: Pos): [number, number] => [p[0] * kx, p[1] * ky];
  const done = new Set<string>();
  for (const list of grid.values())
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const A = list[x],
          B = list[y];
        if (A.s === B.s) continue;
        const pair = A.s < B.s ? `${A.s}:${A.i}|${B.s}:${B.i}` : `${B.s}:${B.i}|${A.s}:${A.i}`;
        if (done.has(pair)) continue;
        done.add(pair);
        const sa = segs[A.s],
          sb = segs[B.s];
        if (sa.brunnel || sb.brunnel) continue;
        const [p1, p2] = [flat(sa.coords[A.i]), flat(sa.coords[A.i + 1])];
        const [q1, q2] = [flat(sb.coords[B.i]), flat(sb.coords[B.i + 1])];
        const r = [p2[0] - p1[0], p2[1] - p1[1]],
          q = [q2[0] - q1[0], q2[1] - q1[1]];
        const den = r[0] * q[1] - r[1] * q[0];
        if (Math.abs(den) < 1e-9) continue;
        const t = ((q1[0] - p1[0]) * q[1] - (q1[1] - p1[1]) * q[0]) / den;
        const u = ((q1[0] - p1[0]) * r[1] - (q1[1] - p1[1]) * r[0]) / den;
        // A line may stop up to 1.5 m short of the road it meets, but only at its own open end.
        const slackA = 1.5 / Math.max(1e-6, Math.hypot(r[0], r[1])),
          slackB = 1.5 / Math.max(1e-6, Math.hypot(q[0], q[1]));
        const lastA = sa.coords.length - 2,
          lastB = sb.coords.length - 2;
        const okA = (t >= 0 && t <= 1) || (t < 0 && t >= -slackA && A.i === 0) || (t > 1 && t <= 1 + slackA && A.i === lastA);
        const okB = (u >= 0 && u <= 1) || (u < 0 && u >= -slackB && B.i === 0) || (u > 1 && u <= 1 + slackB && B.i === lastB);
        if (!okA || !okB) continue;
        const tc = Math.max(0, Math.min(1, t)),
          uc = Math.max(0, Math.min(1, u));
        const innerA = tc > 0 && tc < 1,
          innerB = uc > 0 && uc < 1;
        // The meeting point: on A's line (A's own point when the crossing is at one of A's points).
        const at: Pos = [sa.coords[A.i][0] + (sa.coords[A.i + 1][0] - sa.coords[A.i][0]) * tc, sa.coords[A.i][1] + (sa.coords[A.i + 1][1] - sa.coords[A.i][1]) * tc];
        if (innerA) addInner(A.s, A.i, tc, at);
        if (innerB) addInner(B.s, B.i, uc, at);
        else {
          // B meets A at one of B's own points: move it onto A only if it is one of B's ends.
          const vi = B.i + uc;
          if (vi === 0 || vi === sb.coords.length - 1) snaps.set(`${B.s}:${vi}`, at);
        }
      }
  if (!inner.size && !snaps.size) return segs;
  return segs.map((s, si) => {
    const coords: Pos[] = [];
    s.coords.forEach((p, i) => {
      coords.push(snaps.get(`${si}:${i}`) ?? p);
      for (const e of (inner.get(`${si}:${i}`) ?? []).sort((a, b) => a.t - b.t)) coords.push(e.p);
    });
    return { ...s, coords };
  });
}

export function buildGraph(segs: Seg[]): Graph {
  const usable = addJunctions(segs.filter((s) => s.coords.length > 1 && s.cls in CLASS_MPH));
  // How many lines pass through or end at each point: two or more, or an end, makes a node.
  const uses = new Map<string, number>();
  for (const s of usable)
    s.coords.forEach((p, i) => {
      const k = key(p);
      uses.set(k, (uses.get(k) ?? 0) + (i === 0 || i === s.coords.length - 1 ? 2 : 1));
    });
  const nodes: Pos[] = [];
  const nodeOf = new Map<string, number>();
  const node = (p: Pos) => {
    const k = key(p);
    let n = nodeOf.get(k);
    if (n === undefined) {
      n = nodes.length;
      nodes.push(p);
      nodeOf.set(k, n);
    }
    return n;
  };
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const s of usable) {
    let start = 0;
    for (let i = 1; i < s.coords.length; i++) {
      const last = i === s.coords.length - 1;
      if (!last && (uses.get(key(s.coords[i])) ?? 0) < 2) continue;
      const coords = s.coords.slice(start, i + 1);
      const a = node(coords[0]),
        b = node(coords[coords.length - 1]);
      start = i;
      if (a === b && coords.length < 3) continue;
      // The same stretch from two tiles' margins: keep one.
      const sig = `${Math.min(a, b)}:${Math.max(a, b)}:${coords.length}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      let len = 0;
      for (let j = 1; j < coords.length; j++) len += distance(coords[j - 1], coords[j]);
      if (len < 0.5) continue;
      edges.push({ ...s, coords, id: edges.length, a, b, len });
    }
  }
  const at: number[][] = nodes.map(() => []);
  for (const e of edges) {
    at[e.a].push(e.id);
    if (e.b !== e.a) at[e.b].push(e.id);
  }
  return { nodes, edges, at };
}

/** A road driven one way: forward is from its node a to node b. */
export interface Leg {
  edge: number;
  forward: boolean;
}

export const canDrive = (e: Edge, forward: boolean) => e.oneway === 0 || (e.oneway === 1) === forward;

/** The road's points in the way it is driven. */
export const legCoords = (g: Graph, l: Leg) => (l.forward ? g.edges[l.edge].coords : [...g.edges[l.edge].coords].reverse());
export const legEnd = (g: Graph, l: Leg) => (l.forward ? g.edges[l.edge].b : g.edges[l.edge].a);

/** How far right of the center line the car drives, in meters: half a lane on two way roads. */
export const laneOffset = (e: Edge) => (e.oneway !== 0 ? 0 : e.cls === 'minor' || e.cls === 'service' ? 1.6 : 1.8);

/** Heading at the end of a list of points (the last few meters), and at the start. */
function endHeading(c: Pos[]): number {
  let i = c.length - 2;
  while (i > 0 && distance(c[i], c[c.length - 1]) < 4) i--;
  return bearing(c[i], c[c.length - 1]);
}
function startHeading(c: Pos[]): number {
  let i = 1;
  while (i < c.length - 1 && distance(c[0], c[i]) < 4) i++;
  return bearing(c[0], c[i]);
}

const norm180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export interface TurnOptions {
  left: Leg | null;
  straight: Leg | null;
  right: Leg | null;
  /** What happens with no choice: straight on, else the way the road goes, else back the other way (a dead end). */
  auto: Leg;
  /** True when the only way on is to turn around. */
  deadEnd: boolean;
}

/** The ways on at the end of a leg: left, straight and right (within 35 degrees of straight on), and the default. */
export function turnOptions(g: Graph, l: Leg): TurnOptions {
  const n = legEnd(g, l);
  const inHead = endHeading(legCoords(g, l));
  const ways: Array<{ leg: Leg; turn: number }> = [];
  for (const id of g.at[n]) {
    const e = g.edges[id];
    for (const forward of [true, false]) {
      if ((forward ? e.a : e.b) !== n) continue;
      if (id === l.edge && forward !== l.forward) continue; // back the way it came
      if (!canDrive(e, forward)) continue;
      const leg = { edge: id, forward };
      ways.push({ leg, turn: norm180(startHeading(legCoords(g, leg)) - inHead) });
    }
  }
  const pick = (f: (t: number) => boolean, best: (t: number) => number) => ways.filter((w) => f(w.turn)).sort((a, b) => best(a.turn) - best(b.turn))[0]?.leg ?? null;
  const straight = pick((t) => Math.abs(t) <= 35, (t) => Math.abs(t));
  const left = pick((t) => t < -35, (t) => Math.abs(t + 90));
  const right = pick((t) => t > 35, (t) => Math.abs(t - 90));
  const follow = ways.sort((a, b) => Math.abs(a.turn) - Math.abs(b.turn))[0]?.leg ?? null;
  const back: Leg = { edge: l.edge, forward: !l.forward };
  const deadEnd = !follow;
  return { left, straight, right, auto: straight ?? follow ?? back, deadEnd };
}

/** Points moved `meters` to the right of the line's direction (left for negative), corners mitered. */
export function offsetLine(c: Pos[], meters: number): Pos[] {
  if (!meters || c.length < 2) return c.slice();
  return c.map((p, i) => {
    const h0 = i > 0 ? bearing(c[i - 1], p) : bearing(p, c[i + 1]);
    const h1 = i < c.length - 1 ? bearing(p, c[i + 1]) : h0;
    const d = norm180(h1 - h0);
    const mid = h0 + d / 2;
    const scale = 1 / Math.max(0.5, Math.cos(((d / 2) * Math.PI) / 180));
    return destination(p, mid + 90, meters * scale);
  });
}

/** The road nearest a spot, the point on it, and how far, or null beyond `maxM` meters. */
export function nearestEdge(g: Graph, p: Pos, maxM = 30): { edge: Edge; at: Pos; index: number; d: number } | null {
  let best: { edge: Edge; at: Pos; index: number; d: number } | null = null;
  for (const e of g.edges)
    for (let i = 0; i + 1 < e.coords.length; i++) {
      const r = nearestOnSegment(p, e.coords[i], e.coords[i + 1]);
      if (r.d <= maxM && (!best || r.d < best.d)) best = { edge: e, at: r.at, index: i, d: r.d };
    }
  return best;
}
