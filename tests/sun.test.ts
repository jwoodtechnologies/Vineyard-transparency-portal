import { describe, expect, it } from 'vitest';
import { horizonY } from '../src/console/streetview/geo';
import { screenPoint, sunPosition } from '../src/console/streetview/sun';

const LAT = 40.3;
const LNG = -111.75;

/** The highest the sun gets on a UTC day, and its azimuth then, sampled each minute. */
function noon(day: string) {
  let best = { altitude: -90, azimuth: 0, at: 0 };
  const start = Date.parse(`${day}T00:00:00Z`);
  for (let m = 0; m < 1440; m++) {
    const s = sunPosition(start + m * 60_000, LAT, LNG);
    if (s.altitude > best.altitude) best = { ...s, at: m };
  }
  return best;
}

describe('sun position for Vineyard', () => {
  it('is due south at noon on the equinox, 90 minus the latitude up', () => {
    const n = noon('2026-03-20');
    expect(n.altitude).toBeGreaterThan(49);
    expect(n.altitude).toBeLessThan(50.5);
    expect(Math.abs(n.azimuth - 180)).toBeLessThan(2);
    // Local solar noon is about 7 h 27 min after noon UTC at 111.75 degrees west.
    expect(Math.abs(n.at - (19 * 60 + 34))).toBeLessThan(12);
  });

  it('is 23.4 degrees higher at the June solstice and lower in December', () => {
    expect(noon('2026-06-21').altitude).toBeCloseTo(73.1, 0);
    expect(noon('2026-12-21').altitude).toBeCloseTo(26.3, 0);
  });

  it('rises in the east and sets in the west on the equinox, and is below the horizon at midnight', () => {
    // 07:30 MDT (13:30 UTC) and 19:30 MDT (01:30 UTC next day): near the horizon.
    const am = sunPosition(Date.parse('2026-03-20T13:40:00Z'), LAT, LNG);
    const pm = sunPosition(Date.parse('2026-03-21T01:30:00Z'), LAT, LNG);
    expect(Math.abs(am.azimuth - 90)).toBeLessThan(12);
    expect(Math.abs(pm.azimuth - 270)).toBeLessThan(12);
    expect(Math.abs(am.altitude)).toBeLessThan(6);
    expect(sunPosition(Date.parse('2026-03-21T07:30:00Z'), LAT, LNG).altitude).toBeLessThan(-40);
  });
});

describe('sun on screen', () => {
  const view = { width: 400, height: 800, bearing: 0, pitch: 80, fov: 36.87 };

  it('puts a point on the horizon straight ahead where horizonY does', () => {
    const p = screenPoint(0, 0, view)!;
    expect(p.x).toBeCloseTo(200, 5);
    expect(p.y).toBeCloseTo(horizonY(800, 80, 36.87), 5);
  });

  it('moves right as the azimuth moves clockwise of the bearing, up as the altitude rises', () => {
    const a = screenPoint(10, 5, view)!;
    const b = screenPoint(20, 10, view)!;
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeLessThan(a.y);
    expect(screenPoint(350, 5, { ...view, bearing: 0 })!.x).toBeLessThan(200);
  });

  it('has nothing for a direction behind the camera', () => {
    expect(screenPoint(180, 10, view)).toBeNull();
    expect(screenPoint(200, 10, { ...view, bearing: 190 })).not.toBeNull();
  });
});
