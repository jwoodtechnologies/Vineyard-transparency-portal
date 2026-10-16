import { describe, expect, it } from 'vitest';
import { pathLength, peopleMesh, spawnWalkers, stepWalkers, walkerAt, type WalkPath } from '../src/console/scene/people';

const paths: WalkPath[] = [
  { coords: [[0, 0], [100, 0]], dz: [0, 2] },
  { coords: [[0, 10], [0, 20]], dz: [0, 0] },
];

describe('pedestrians', () => {
  it('spawns more walkers on longer paths, each with a place and a look', () => {
    let k = 0;
    const rand = () => (k++ * 0.137) % 1;
    const w = spawnWalkers(paths, 20, rand);
    expect(w.length).toBe(20);
    expect(w.filter((x) => x.path === 0).length).toBeGreaterThan(w.filter((x) => x.path === 1).length);
    for (const x of w) {
      expect(x.s).toBeGreaterThanOrEqual(0);
      expect(x.s).toBeLessThanOrEqual(pathLength(paths[x.path]));
      expect(x.speed).toBeGreaterThan(1);
    }
    expect(spawnWalkers([], 5)).toEqual([]);
  });

  it('walks along the path at its speed, on the ground, and turns round at the end', () => {
    const [w] = spawnWalkers([paths[0]], 1, () => 0.5);
    w.s = 10;
    w.dir = 1;
    w.speed = 1.3;
    stepWalkers([w], paths, 1);
    expect(w.s).toBeCloseTo(11.3, 6);
    const { at, d } = walkerAt(w, paths[0]);
    expect(at[0]).toBeCloseTo(11.3, 6);
    expect(at[2]).toBeCloseTo(0.226, 3);
    expect(d).toEqual([1, 0]);
    w.s = 99.5;
    stepWalkers([w], paths, 1);
    expect(w.dir).toBe(-1);
    expect(w.s).toBe(100);
  });

  it('draws five boxes a walker, standing 1.7 m tall, only near the view', () => {
    const w = spawnWalkers([paths[0]], 2, () => 0.5);
    w[0].s = 0;
    w[1].s = 100;
    const all = peopleMesh(w, [paths[0]]);
    // Five boxes of five faces, two triangles each: 50 triangles a walker.
    expect(all.length / 18).toBe(100);
    const near = peopleMesh(w, [paths[0]], [0, 0], 50);
    expect(near.length / 18).toBe(50);
    let top = -Infinity;
    for (let i = 2; i < near.length; i += 6) top = Math.max(top, near[i]);
    expect(top).toBeCloseTo(1.72, 6);
  });
});
