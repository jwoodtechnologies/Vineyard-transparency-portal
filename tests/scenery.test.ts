import { describe, expect, it } from 'vitest';
import { snowColor, SNOW_FULL, SNOW_MAX, SNOW_START, WATER_FILTER } from '../src/console/streetview/scenery';

describe('3D scenery', () => {
  it('is clear below about 2,550 m, patchy above, nearly solid white from about 2,850 m, never grey or blue', () => {
    const stops = snowColor().slice(3) as Array<number | string>;
    const pairs: Array<[number, number, string]> = [];
    for (let i = 0; i < stops.length; i += 2) {
      const m = String(stops[i + 1]).match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!;
      pairs.push([stops[i] as number, Number(m[4]), `${m[1]},${m[2]},${m[3]}`]);
    }
    expect(SNOW_START).toBe(2550);
    expect(SNOW_FULL).toBe(2850);
    expect(pairs[0]).toEqual([2550, 0, '255,255,255']);
    for (const [, , rgb] of pairs) expect(rgb).toBe('255,255,255');
    const at = (m: number) => pairs.find(([e]) => e === m)![1];
    expect(at(2850)).toBeGreaterThanOrEqual(0.85);
    // A little of the hillshade under the snow still shows, so the ridges read.
    expect(pairs.at(-1)![1]).toBe(SNOW_MAX);
    expect(SNOW_MAX).toBeGreaterThanOrEqual(0.9);
    expect(SNOW_MAX).toBeLessThan(1);
    // Patchy between: not one smooth rise.
    const mid = pairs.filter(([e]) => e > 2550 && e < 2850).map(([, a]) => a);
    expect(mid.some((a, i) => i > 0 && a < mid[i - 1])).toBe(true);
    expect(Math.max(...mid)).toBeLessThan(0.8);
  });

  it('tints lakes and harbors, not swimming pools', () => {
    expect(WATER_FILTER).toEqual(['!=', ['get', 'class'], 'swimming_pool']);
  });
});
