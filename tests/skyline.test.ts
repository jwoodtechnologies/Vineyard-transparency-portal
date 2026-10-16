import { describe, expect, it } from 'vitest';
import { nearestView, SKYLINE, skylineLayout } from '../src/console/streetview/skyline';

describe('skyline panorama', () => {
  it('ships nine viewpoints over Vineyard with the angle range', () => {
    expect(SKYLINE.views.length).toBe(9);
    expect(SKYLINE.degMax).toBeGreaterThan(SKYLINE.degMin);
    expect(SKYLINE.rows).toBe((SKYLINE.degMax - SKYLINE.degMin) * SKYLINE.pxPerDeg);
  });

  it('picks the nearest viewpoint', () => {
    expect(nearestView(-111.74, 40.303)).toBe(4);
    expect(nearestView(-111.78, 40.27)).toBe(0);
    expect(nearestView(-111.70, 40.34)).toBe(8);
  });

  it('lays the panorama out: the horizon at angle 0, facing north shows the columns around 0, east around a quarter', () => {
    const north = skylineLayout(1000, 800, 0, 83, 36.87);
    // The horizon line of an 83 degree pitch is 400 - camPx * tan(7 degrees) from the top.
    const camPx = 400 / Math.tan((36.87 / 2) * (Math.PI / 180));
    const horizon = 400 - camPx * Math.tan((7 * Math.PI) / 180);
    const pxDeg = north.height / (SKYLINE.degMax - SKYLINE.degMin);
    expect(north.top + SKYLINE.degMax * pxDeg).toBeCloseTo(horizon, 3);
    expect(north.strips.length).toBeGreaterThanOrEqual(48);
    const mid = north.strips.find((s) => s.dx <= 500 && s.dx + s.dw > 500)!;
    expect(Math.min(mid.sx, SKYLINE.cols - mid.sx)).toBeLessThan(SKYLINE.cols / 48);
    const east = skylineLayout(1000, 800, 90, 83, 36.87);
    const midE = east.strips.find((s) => s.dx <= 500 && s.dx + s.dw > 500)!;
    expect(Math.abs(midE.sx - SKYLINE.cols / 4)).toBeLessThan(SKYLINE.cols / 48);
    // Every screen pixel is covered once.
    const total = east.strips.reduce((a, s) => a + s.dw, 0);
    expect(total).toBeCloseTo(1000, 6);
  });
});
