/**
 * Building meshes for the 3D street scene: walls up to the eaves and a roof shaped from the footprint (a
 * gable along a home's long side, a hip on an L or U shaped home, flat on anything large or oddly shaped),
 * with eaves that overhang the walls. Colours are baked per vertex with simple sunlight, so the layer only
 * draws triangles. Pure; built in a worker (scene.worker.ts). Positions are local meters (x east, y north,
 * z up from the building's ground).
 */
import earcut from 'earcut';
import { boxCorners, cleanRing, orientedBox, rectangularity, shrink, signedArea, type XY } from './footprint';

export type RGB = [number, number, number];

export interface BuildingIn {
  /** Outer ring in local meters. */
  ring: XY[];
  /** Eave height above the ground, and where the walls start (0 unless the part stands on another). */
  height: number;
  base: number;
  wall: RGB;
  roof: RGB;
  /** True when OpenStreetMap recorded the height: drawn as a plain block (the height already includes the roof). */
  recorded?: boolean;
}

export type RoofKind = 'gable' | 'hip' | 'flat';

/** A home fills at least this much of its rectangle to get a gable. */
export const GABLE_FILL = 0.82;
/** Homes wider than this across (meters) get a flat roof; so do footprints over FLAT_M2. */
export const GABLE_MAX_SHORT = 26;
export const FLAT_M2 = 700;
export const EAVE_M = 0.45;
/** Roof rise: this share of the short side (about a 5 in 12 pitch), at most ROOF_RISE_MAX. */
export const ROOF_PITCH = 0.42;
export const ROOF_RISE_MAX = 3.2;

/** Sunlight from the south west, a little above the horizon, for the baked shading. */
const LIGHT = norm3([-0.45, -0.55, 0.7]);
const AMBIENT = 0.74;

function norm3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Which roof a footprint gets. */
export function roofKind(ring: XY[], m2: number, recorded: boolean | undefined): RoofKind {
  if (recorded || m2 > FLAT_M2) return 'flat';
  const box = orientedBox(ring);
  if (box.short > GABLE_MAX_SHORT) return 'flat';
  const fill = rectangularity(ring, box);
  if (fill >= GABLE_FILL) return 'gable';
  if (fill >= 0.5) return 'hip';
  return 'flat';
}

/** Appends triangles with baked colours (shared with roadMesh.ts). */
export class MeshOut {
  data: number[] = [];
  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number], color: RGB): void {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const n = norm3([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
    const shade = AMBIENT + (1 - AMBIENT) * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    for (const p of [a, b, c]) this.data.push(p[0], p[1], p[2], color[0] * shade, color[1] * shade, color[2] * shade);
  }
  /** A quad a, b, c, d (counterclockwise seen from outside). */
  quad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], color: RGB): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }
}

/** Window glass, door and trim colours. */
const GLASS: RGB = [0.3, 0.36, 0.44];
const DOOR: RGB = [0.35, 0.25, 0.2];
const GARAGE: RGB = [0.88, 0.86, 0.82];
export const STOREY_M = 3.1;

/**
 * Vertical walls along a ring (counterclockwise), facing outward, with windows on each storey of every wall
 * long enough, a front door on the longest wall and a garage door on the second longest (homes only:
 * `openings` false on big or recorded buildings).
 */
function walls(out: MeshOut, ring: XY[], z0: number, z1: number, color: RGB, openings = false): void {
  const lens = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const order = lens.map((l, i) => [l, i] as const).sort((p, q) => q[0] - p[0]);
  const doorWall = openings ? order[0]?.[1] : -1;
  const garageWall = openings && order[1] && order[1][0] >= 7 ? order[1][1] : -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    out.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], color);
    if (!openings) continue;
    const len = lens[i];
    if (len < 3.5) continue;
    // Along the wall (unit) and out of it (the ring is counterclockwise, so outward is to the right).
    const ux = (b[0] - a[0]) / len,
      uy = (b[1] - a[1]) / len;
    const nx = uy * 0.06,
      ny = -ux * 0.06;
    const plate = (s0: number, s1: number, h0: number, h1: number, c: RGB) => {
      const p = (s: number, h: number): [number, number, number] => [a[0] + ux * s + nx, a[1] + uy * s + ny, h];
      out.quad(p(s0, h0), p(s1, h0), p(s1, h1), p(s0, h1), c);
    };
    const storeys = Math.max(1, Math.floor((z1 - z0) / STOREY_M + 0.3));
    for (let k = 0; k < storeys; k++) {
      const sill = z0 + k * STOREY_M + 1.0;
      const top = Math.min(z1 - 0.3, sill + 1.3);
      if (top - sill < 0.6) continue;
      // Windows 1.2 m wide every 2.6 m, centred on the wall.
      const n = Math.floor((len - 1.4) / 2.6);
      const start = (len - (n - 1) * 2.6) / 2;
      for (let w = 0; w < n; w++) {
        const s = start + w * 2.6;
        // Leave room for the door and the garage door on the ground floor.
        if (k === 0 && i === doorWall && Math.abs(s - len / 2) < 1.6) continue;
        if (k === 0 && i === garageWall && Math.abs(s - len / 2) < 3.2) continue;
        plate(s - 0.6, s + 0.6, sill, top, GLASS);
      }
    }
    if (i === doorWall) plate(len / 2 - 0.5, len / 2 + 0.5, z0, z0 + 2.1, DOOR);
    if (i === garageWall) plate(len / 2 - 2.4, len / 2 + 2.4, z0, z0 + 2.2, GARAGE);
  }
}

/** A flat cap over a ring at height z, facing up. */
function cap(out: MeshOut, ring: XY[], z: number, color: RGB): void {
  const flat: number[] = [];
  for (const [x, y] of ring) flat.push(x, y);
  const idx = earcut(flat);
  for (let i = 0; i < idx.length; i += 3) {
    const a = ring[idx[i]],
      b = ring[idx[i + 1]],
      c = ring[idx[i + 2]];
    // earcut gives clockwise triangles for a counterclockwise ring in y up coordinates; flip to face up.
    out.tri([a[0], a[1], z], [c[0], c[1], z], [b[0], b[1], z], color);
  }
}

/** The height of a building's top (ridge or roof), for hit testing. */
export function topOf(b: BuildingIn): number {
  const ring = cleanRing(b.ring);
  const m2 = Math.abs(signedArea(ring));
  const kind = roofKind(ring, m2, b.recorded);
  if (kind === 'flat') return b.height;
  const box = orientedBox(ring);
  return b.height + Math.min(ROOF_RISE_MAX, (kind === 'gable' ? box.short : Math.sqrt(m2)) * ROOF_PITCH * 0.5);
}

/** Triangles for one building: interleaved x, y, z, r, g, b (six numbers a vertex). */
export function buildingMesh(b: BuildingIn, out = new MeshOut()): number[] {
  const ring = cleanRing(b.ring);
  if (ring.length < 3) return out.data;
  const m2 = Math.abs(signedArea(ring));
  const kind = roofKind(ring, m2, b.recorded);
  const darkRoof: RGB = [b.roof[0] * 0.9, b.roof[1] * 0.9, b.roof[2] * 0.9];
  if (kind === 'flat') {
    walls(out, ring, b.base, b.height, b.wall, !b.recorded && m2 <= FLAT_M2);
    cap(out, ring, b.height, b.recorded ? b.roof : darkRoof);
    return out.data;
  }
  const box = orientedBox(ring);
  if (kind === 'gable') {
    const rise = Math.min(ROOF_RISE_MAX, box.short * ROOF_PITCH * 0.5);
    walls(out, ring, b.base, b.height, b.wall, true);
    // The roof sits on the rectangle with eaves out past it; the gable ends close the rectangle's short sides.
    const [p0, p1, p2, p3] = boxCorners(box, EAVE_M);
    const c = Math.cos(box.angle),
      s = Math.sin(box.angle);
    const hl = box.long / 2 + EAVE_M;
    const ridgeA: [number, number, number] = [box.center[0] - hl * c, box.center[1] - hl * s, b.height + rise];
    const ridgeB: [number, number, number] = [box.center[0] + hl * c, box.center[1] + hl * s, b.height + rise];
    const z = b.height;
    // Two roof planes (long sides p0 p1 and p2 p3), facing up and out.
    out.quad([p0[0], p0[1], z], [p1[0], p1[1], z], ridgeB, ridgeA, b.roof);
    out.quad([p2[0], p2[1], z], [p3[0], p3[1], z], ridgeA, ridgeB, b.roof);
    // Gable ends: triangles on the short sides, in the wall colour, slightly inside the eaves.
    const [q0, q1, q2, q3] = boxCorners(box, 0);
    const endA: [number, number, number] = [box.center[0] - (box.long / 2) * c, box.center[1] - (box.long / 2) * s, b.height + rise];
    const endB: [number, number, number] = [box.center[0] + (box.long / 2) * c, box.center[1] + (box.long / 2) * s, b.height + rise];
    out.tri([q3[0], q3[1], z], [q0[0], q0[1], z], endA, b.wall);
    out.tri([q1[0], q1[1], z], [q2[0], q2[1], z], endB, b.wall);
    // Eave undersides, so the overhang reads from below.
    out.quad([p1[0], p1[1], z], [p0[0], p0[1], z], [q0[0], q0[1], z], [q1[0], q1[1], z], b.wall);
    out.quad([p3[0], p3[1], z], [p2[0], p2[1], z], [q2[0], q2[1], z], [q3[0], q3[1], z], b.wall);
    return out.data;
  }
  // Hip: walls to the eaves, roof planes from an outline grown by the eave to a smaller one at the ridge.
  const rise = Math.min(ROOF_RISE_MAX, Math.sqrt(m2) * ROOF_PITCH * 0.5);
  walls(out, ring, b.base, b.height, b.wall, true);
  const outer = grow(ring, EAVE_M);
  const inner = shrink(ring, 0.42);
  for (let i = 0; i < ring.length; i++) {
    const a = outer[i],
      c2 = outer[(i + 1) % ring.length],
      d = inner[(i + 1) % ring.length],
      e = inner[i];
    out.quad([a[0], a[1], b.height], [c2[0], c2[1], b.height], [d[0], d[1], b.height + rise], [e[0], e[1], b.height + rise], b.roof);
  }
  cap(out, inner, b.height + rise, darkRoof);
  // Eave underside.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      c2 = ring[(i + 1) % ring.length],
      d = outer[(i + 1) % ring.length],
      e = outer[i];
    out.quad([c2[0], c2[1], b.height], [a[0], a[1], b.height], [e[0], e[1], b.height], [d[0], d[1], b.height], b.wall);
  }
  return out.data;
}

/** The ring pushed outward by `d` meters along each corner's bisector. */
export function grow(ring: XY[], d: number): XY[] {
  const n = ring.length;
  return ring.map((p, i) => {
    const prev = ring[(i + n - 1) % n],
      next = ring[(i + 1) % n];
    const e1 = normal2(prev, p),
      e2 = normal2(p, next);
    const bx = e1[0] + e2[0],
      by = e1[1] + e2[1];
    const bl = Math.hypot(bx, by) || 1;
    const cosHalf = Math.max(0.35, (bx / bl) * e2[0] + (by / bl) * e2[1]);
    return [p[0] + ((bx / bl) * d) / cosHalf, p[1] + ((by / bl) * d) / cosHalf];
  });
}

/** The outward unit normal of edge a to b on a counterclockwise ring. */
function normal2(a: XY, b: XY): XY {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

/** Meshes for many buildings in one array. */
export function buildingsMesh(list: BuildingIn[]): Float32Array {
  const out = new MeshOut();
  for (const b of list) buildingMesh(b, out);
  return new Float32Array(out.data);
}
