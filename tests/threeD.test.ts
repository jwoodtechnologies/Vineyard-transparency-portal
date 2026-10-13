import { describe, expect, it } from 'vitest';
import { horizonY } from '../src/console/streetview/geo';
import { buildingHeight, OMT_UNKNOWN_M, UNKNOWN_M } from '../src/console/streetview/heights';

describe('3D view', () => {
  it('puts the horizon at the middle when looking level and above the view when looking down', () => {
    expect(horizonY(800, 90, 36.87)).toBe(400);
    expect(horizonY(800, 30, 36.87)).toBeLessThan(0);
    const y = horizonY(800, 75, 36.87);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(400);
  });

  it('raises a building to its recorded height, and one with none to a two story default', () => {
    const e = JSON.stringify(buildingHeight());
    expect(e).toContain(String(OMT_UNKNOWN_M));
    expect(e).toContain(String(UNKNOWN_M));
  });
});
