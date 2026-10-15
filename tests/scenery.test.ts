import { describe, expect, it } from 'vitest';
import { snowColor, SNOW_FULL, SNOW_START, WATER_FILTER } from '../src/console/streetview/scenery';

describe('3D scenery', () => {
  it('starts the snow clear just under 2,900 m and is never solid white', () => {
    const stops = snowColor().slice(3) as Array<number | string>;
    const pairs = [];
    for (let i = 0; i < stops.length; i += 2) pairs.push([stops[i] as number, Number(String(stops[i + 1]).match(/([\d.]+)\)$/)![1])]);
    expect(SNOW_START).toBeLessThan(2900);
    expect(pairs[0]).toEqual([SNOW_START, 0]);
    expect(pairs.find(([m]) => m === 2900)![1]).toBeGreaterThan(0);
    expect(pairs.at(-1)![0]).toBe(SNOW_FULL);
    expect(Math.max(...pairs.map(([, a]) => a))).toBeLessThan(0.85);
    // Rising with height.
    for (let i = 1; i < pairs.length; i++) expect(pairs[i][1]).toBeGreaterThan(pairs[i - 1][1]);
  });

  it('tints lakes and harbors, not swimming pools', () => {
    expect(WATER_FILTER).toEqual(['!=', ['get', 'class'], 'swimming_pool']);
  });
});
