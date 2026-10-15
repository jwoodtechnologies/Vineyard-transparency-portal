import { describe, expect, it } from 'vitest';
import { firstHit, middle, type Box } from '../src/console/streetview/rayPick';

// Small squares about 11 m across near Vineyard, on flat ground at 1,400 m.
const sq = (lng: number, lat: number, d = 0.0001) => [[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]] as Array<[number, number]>;
const G = 1400;

describe('which building a tap in the 3D view lands on', () => {
  const near: Box = { ring: sq(-111.7400, 40.3000), base: 0, top: 10 };
  const far: Box = { ring: sq(-111.7390, 40.3000), base: 0, top: 30 };
  const eye: [number, number, number] = [-111.7420, 40.30005, G + 3];

  it('finds the first building the line of sight passes through, not the ground behind it', () => {
    // Looking east, slightly down, toward ground past both buildings: the near one is hit first.
    const ground: [number, number, number] = [-111.7380, 40.30005, G];
    expect(firstHit(eye, ground, [far, near])).toBe(near);
  });

  it('looks over a low building to a tall one behind it', () => {
    const low: Box = { ...near, top: 2 };
    const ground: [number, number, number] = [-111.7380, 40.30005, G];
    expect(firstHit([-111.7420, 40.30005, G + 12], ground, [low, far])).toBe(far);
  });

  it('finds nothing when the line of sight meets the ground before any building', () => {
    expect(firstHit(eye, [-111.7410, 40.30005, G], [near, far])).toBeNull();
    expect(firstHit(eye, [-111.7380, 40.30005, G], [])).toBeNull();
  });

  it('stands for a building by the middle of its footprint', () => {
    const [x, y] = middle(sq(0, 0, 2).slice(0, 4));
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(1);
  });
});
