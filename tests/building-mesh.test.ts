import { describe, expect, it } from 'vitest';
import { boxCorners, cleanRing, inside, orientedBox, pushOut, rectangularity, shrink, toLocal, type XY } from '../src/console/scene/footprint';
import { buildingMesh, buildingsMesh, grow, roofKind, topOf, ROOF_RISE_MAX } from '../src/console/scene/buildingMesh';

const rect = (w: number, l: number, angle = 0, cx = 0, cy = 0): XY[] => {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return ([[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]] as XY[]).map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]);
};
// An L: a 12 by 18 rectangle with a 6 by 9 corner taken out.
const ell: XY[] = [[0, 0], [18, 0], [18, 6], [9, 6], [9, 12], [0, 12]];

describe('footprint geometry', () => {
  it('finds the smallest rectangle around a turned home', () => {
    const b = orientedBox(rect(10, 16, 0.6, 5, -3));
    expect(b.long).toBeCloseTo(16, 3);
    expect(b.short).toBeCloseTo(10, 3);
    expect(b.center[0]).toBeCloseTo(5, 3);
    expect(b.center[1]).toBeCloseTo(-3, 3);
    expect(Math.abs(((b.angle - 0.6 + Math.PI) % Math.PI) - 0)).toBeLessThan(1e-6);
  });

  it('knows a rectangle from an L', () => {
    expect(rectangularity(rect(10, 16))).toBeCloseTo(1, 6);
    expect(rectangularity(ell)).toBeCloseTo((18 * 12 - 9 * 6) / (18 * 12), 6);
  });

  it('cleans a ring (closing point, direction) and shrinks toward the middle', () => {
    const closed: XY[] = [[0, 0], [0, 4], [4, 4], [4, 0], [0, 0]];
    const r = cleanRing(closed);
    expect(r).toHaveLength(4);
    // Reversed to counterclockwise.
    expect(r[0]).toEqual([4, 0]);
    expect(r[1]).toEqual([4, 4]);
    expect(shrink(r, 0.5)).toEqual([[3, 1], [3, 3], [1, 3], [1, 1]]);
    expect(boxCorners({ center: [0, 0], angle: 0, long: 4, short: 2 }, 1)).toEqual([[-3, -2], [3, -2], [3, 2], [-3, 2]]);
    const loc = toLocal([-111.75, 40.3]);
    expect(loc([-111.75, 40.301])[1]).toBeCloseTo(110.54, 1);
  });

  it('moves a point inside a building out past its nearest wall', () => {
    const sq: XY[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(inside(sq, [1, 5])).toBe(true);
    const out = pushOut(sq, [1, 5], 3);
    expect(out[0]).toBeCloseTo(-3, 6);
    expect(out[1]).toBeCloseTo(5, 6);
    expect(inside(sq, out)).toBe(false);
    expect(pushOut(sq, [20, 5], 3)).toEqual([20, 5]);
    // The same for a clockwise ring.
    expect(pushOut(sq.slice().reverse(), [5, 9], 2)[1]).toBeCloseTo(12, 6);
  });

  it('grows a square outward evenly', () => {
    const g = grow(cleanRing([[0, 0], [4, 0], [4, 4], [0, 4]]), 1);
    expect(g[0][0]).toBeCloseTo(-1, 6);
    expect(g[0][1]).toBeCloseTo(-1, 6);
    expect(g[2][0]).toBeCloseTo(5, 6);
  });
});

describe('building meshes', () => {
  const home = { ring: rect(10, 16), height: 6, base: 0, wall: [0.9, 0.85, 0.78] as [number, number, number], roof: [0.4, 0.33, 0.3] as [number, number, number] };

  it('gives a home a gable, an L a hip, a big or recorded building a flat roof', () => {
    expect(roofKind(cleanRing(rect(10, 16)), 160, false)).toBe('gable');
    expect(roofKind(cleanRing(ell), 162, false)).toBe('hip');
    expect(roofKind(cleanRing(rect(30, 40)), 1200, false)).toBe('flat');
    expect(roofKind(cleanRing(rect(10, 16)), 160, true)).toBe('flat');
  });

  it('builds a gabled home with a ridge above the eaves and no vertex below the ground', () => {
    const m = buildingMesh(home);
    expect(m.length % 18).toBe(0);
    let top = -Infinity,
      bottom = Infinity;
    for (let i = 0; i < m.length; i += 6) {
      top = Math.max(top, m[i + 2]);
      bottom = Math.min(bottom, m[i + 2]);
    }
    expect(bottom).toBe(0);
    expect(top).toBeCloseTo(6 + Math.min(ROOF_RISE_MAX, 10 * 0.42 * 0.5), 6);
    expect(topOf(home)).toBeCloseTo(top, 6);
    // Colours are shaded, never brighter than the colour given.
    for (let i = 0; i < m.length; i += 6) expect(m[i + 3]).toBeLessThanOrEqual(0.9 + 1e-9);
  });

  it('builds a hipped L and a flat block, and packs many into one array', () => {
    const l = buildingMesh({ ...home, ring: ell });
    expect(l.length).toBeGreaterThan(0);
    const flat = buildingMesh({ ...home, ring: rect(30, 40), height: 9 });
    let top = -Infinity;
    for (let i = 0; i < flat.length; i += 6) top = Math.max(top, flat[i + 2]);
    expect(top).toBe(9);
    const all = buildingsMesh([home, { ...home, ring: ell }]);
    expect(all).toBeInstanceOf(Float32Array);
    expect(all.length).toBe(buildingMesh(home).length + l.length);
  });

  it('a plain building (far from the camera) has no windows or doors', () => {
    const ring: XY[] = [[0, 0], [12, 0], [12, 8], [0, 8]];
    const near = buildingMesh({ ring, height: 6, base: 0, wall: [0.8, 0.8, 0.8], roof: [0.4, 0.4, 0.4] });
    const far = buildingMesh({ ring, height: 6, base: 0, wall: [0.8, 0.8, 0.8], roof: [0.4, 0.4, 0.4], plain: true });
    expect(far.length).toBeLessThan(near.length);
    // Walls (4 quads), two roof planes, two gable ends, two eave undersides: 8 quads and 2 triangles.
    expect(far.length / 18).toBe(18);
  });
});
