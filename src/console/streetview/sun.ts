/**
 * Where the sun is in Vineyard's sky at a given moment, and where that falls on the 3D view's screen.
 * The sun's position uses the low precision formulas of the Astronomical Almanac (about 0.01 degree of
 * error from 1950 to 2050), which is far finer than a soft glow needs.
 */
const RAD = Math.PI / 180;

export interface SunPos {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon (negative below). */
  altitude: number;
}

export function sunPosition(ms: number, lat: number, lng: number): SunPos {
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24;
  const ha = (gmst * 15 + lng) * RAD - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(ha), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(ha) * Math.sin(phi));
  return { azimuth: ((az / RAD) % 360 + 360) % 360, altitude: alt / RAD };
}

/**
 * Where a direction (azimuth and altitude in degrees) appears on a view of `width` by `height` pixels whose
 * center faces `bearing`, tilted `pitch` degrees from straight down, `fov` degrees tall. Null when it is
 * behind the camera. Matches horizonY in geo.ts for a point on the horizon straight ahead.
 */
export function screenPoint(az: number, alt: number, view: { width: number; height: number; bearing: number; pitch: number; fov: number }): { x: number; y: number } | null {
  const d = (az - view.bearing) * RAD;
  const a = alt * RAD;
  const e = (view.pitch - 90) * RAD; // the camera's own tilt above the horizon
  const v = [Math.cos(a) * Math.sin(d), Math.cos(a) * Math.cos(d), Math.sin(a)];
  const fwd = v[1] * Math.cos(e) + v[2] * Math.sin(e);
  if (fwd <= 0.01) return null;
  const up = -v[1] * Math.sin(e) + v[2] * Math.cos(e);
  const f = view.height / 2 / Math.tan((view.fov / 2) * RAD);
  return { x: view.width / 2 + (f * v[0]) / fwd, y: view.height / 2 - (f * up) / fwd };
}
