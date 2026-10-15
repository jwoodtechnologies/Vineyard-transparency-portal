import { describe, expect, it } from 'vitest';
import { EYE_M, eyeGeometry } from '../src/console/streetview/eyeMath';

describe('the 3D street view camera at eye height', () => {
  it('looks at the ground a short way ahead at about zoom 21 to 22', () => {
    const g = eyeGeometry(40.3, 83, 36.87, 710);
    expect(g.ahead).toBeCloseTo(EYE_M * Math.tan((83 * Math.PI) / 180), 6);
    expect(g.ahead).toBeGreaterThan(20);
    expect(g.ahead).toBeLessThan(30);
    expect(g.zoom).toBeGreaterThan(20.5);
    expect(g.zoom).toBeLessThan(22.5);
  });

  it('stands closer to the ground point as the view tilts down, never past straight ahead', () => {
    expect(eyeGeometry(40.3, 60, 36.87, 710).ahead).toBeLessThan(eyeGeometry(40.3, 83, 36.87, 710).ahead);
    expect(Number.isFinite(eyeGeometry(40.3, 90, 36.87, 710).ahead)).toBe(true);
  });
});
