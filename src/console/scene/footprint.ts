/**
 * Footprint geometry for the 3D street scene, in local meters (x east, y north). Pure.
 *
 * - The smallest rectangle around an outline (one side along an outline edge), and how much of that
 *   rectangle the outline fills: a home that fills most of its rectangle gets a gabled roof along the long
 *   side; an L or U shaped one a hipped roof; the rest a flat roof.
 * - An outline shrunk toward its middle, for the top of a hipped roof.
 */
export type XY = [number, number];

/** Local meters from a longitude and latitude, around an origin. */
export function toLocal(origin: [number, number]): (p: [number, number]) => XY {
  const kx = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  return (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * 110540];
}

/** Signed area (positive counterclockwise). */
export function signedArea(r: XY[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return -a / 2;
}

/** The ring without a repeated last point, counterclockwise. */
export function cleanRing(r: XY[]): XY[] {
  let out = r.slice();
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out = out.slice(0, -1);
  // Drop points that repeat their neighbor.
  out = out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 0.05);
  if (signedArea(out) < 0) out.reverse();
  return out;
}

export interface Box {
  /** Middle of the rectangle. */
  center: XY;
  /** Direction of the long side, radians from east. */
  angle: number;
  /** Long and short sides, meters. */
  long: number;
  short: number;
}

/** The smallest rectangle around the ring with a side along one of its edges. */
export function orientedBox(ring: XY[]): Box {
  let best: Box | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang),
      s = Math.sin(ang);
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const [x, y] of ring) {
      const u = x * c + y * s,
        v = -x * s + y * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea) {
      bestArea = area;
      const um = (u0 + u1) / 2,
        vm = (v0 + v1) / 2;
      const center: XY = [um * c - vm * s, um * s + vm * c];
      const w = u1 - u0,
        h = v1 - v0;
      best = w >= h ? { center, angle: ang, long: w, short: h } : { center, angle: ang + Math.PI / 2, long: h, short: w };
    }
  }
  return best ?? { center: [0, 0], angle: 0, long: 0, short: 0 };
}

/** How much of its smallest rectangle the ring fills, 0 to 1. */
export function rectangularity(ring: XY[], box = orientedBox(ring)): number {
  const a = box.long * box.short;
  return a > 0 ? Math.min(1, Math.abs(signedArea(ring)) / a) : 0;
}

/** The ring scaled toward its middle by `k`. */
export function shrink(ring: XY[], k: number): XY[] {
  let cx = 0,
    cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  return ring.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/** The four corners of a box, counterclockwise, grown by `grow` meters on each side. */
export function boxCorners(b: Box, grow = 0): XY[] {
  const c = Math.cos(b.angle),
    s = Math.sin(b.angle);
  const hl = b.long / 2 + grow,
    hs = b.short / 2 + grow;
  const at = (u: number, v: number): XY => [b.center[0] + u * c - v * s, b.center[1] + u * s + v * c];
  return [at(-hl, -hs), at(hl, -hs), at(hl, hs), at(-hl, hs)];
}

/**
 * A point inside a ring moved just outside it: to the nearest point on the outline, then `clear` farther
 * out. A point already outside comes back as it is.
 */
export function pushOut(ring: XY[], p: XY, clear: number): XY {
  if (!inside(ring, p)) return p;
  let best: { q: XY; d: number; n: XY } | null = null;
  const ccw = signedArea(ring) > 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const q: XY = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!best || d < best.d) {
      const l = Math.hypot(dx, dy) || 1;
      // Outward normal of a counterclockwise ring's edge is to its right.
      const n: XY = ccw ? [dy / l, -dx / l] : [-dy / l, dx / l];
      best = { q, d, n };
    }
  }
  if (!best) return p;
  return [best.q[0] + best.n[0] * clear, best.q[1] + best.n[1] * clear];
}

export function inside(ring: XY[], p: XY): boolean {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    if (ring[i][1] > p[1] !== ring[j][1] > p[1] && p[0] < ((ring[j][0] - ring[i][0]) * (p[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) yes = !yes;
  return yes;
}
