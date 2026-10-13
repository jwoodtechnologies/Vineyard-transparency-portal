/**
 * Measuring on the earth, no libraries: haversine distances and spherical polygon areas, on a sphere
 * fitted to the WGS84 ellipsoid where the shape is (so a city sized shape agrees with an ellipsoid
 * calculation to well under 0.1 percent). Points are [lng, lat] in degrees; lengths in meters.
 */

export type Pos = [number, number];

const A = 6378137; // WGS84 semi-major axis
const E2 = 0.00669437999014; // WGS84 first eccentricity squared
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** North-south (meridian) and east-west (prime vertical) radii of curvature at a latitude. */
function radii(lat: number): { m: number; n: number } {
  const s = Math.sin(rad(lat));
  const w = 1 - E2 * s * s;
  return { m: (A * (1 - E2)) / (w * Math.sqrt(w)), n: A / Math.sqrt(w) };
}

/**
 * Bearing from a to b, degrees clockwise from north, 0 up to 360: the direction of the segment on the
 * ellipsoid at its middle latitude (within a few hundredths of a degree for lines across the city).
 */
export function bearing(a: Pos, b: Pos): number {
  const mid = (a[1] + b[1]) / 2;
  const { m, n } = radii(mid);
  const x = rad(b[0] - a[0]) * n * Math.cos(rad(mid));
  const y = rad(b[1] - a[1]) * m;
  return (deg(Math.atan2(x, y)) + 360) % 360;
}

/**
 * Distance from a to b: the haversine angle times the earth's radius of curvature in the direction of
 * travel at the segment's middle latitude (Euler's formula), so north-south and east-west lines both match the ellipsoid.
 */
export function distance(a: Pos, b: Pos): number {
  const dp = rad(b[1] - a[1]);
  const dl = rad(b[0] - a[0]);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dl / 2) ** 2;
  const angle = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  if (!angle) return 0;
  const { m, n } = radii((a[1] + b[1]) / 2);
  const az = rad(bearing(a, b));
  const r = 1 / (Math.cos(az) ** 2 / m + Math.sin(az) ** 2 / n);
  return angle * r;
}

/** Length of a path, with the closing segment when `closed`. */
export function pathLength(pts: Pos[], closed = false): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distance(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) s += distance(pts[pts.length - 1], pts[0]);
  return s;
}

/**
 * Area of a polygon (one ring, closed or not) in square meters: the spherical excess formula
 * (sum of (lng2 - lng1)(2 + sin lat1 + sin lat2), times R squared over 2), with R the Gaussian radius
 * of curvature at the ring's middle latitude.
 */
export function polygonArea(ring: Pos[]): number {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    s += rad(p2[0] - p1[0]) * (2 + Math.sin(rad(p1[1])) + Math.sin(rad(p2[1])));
  }
  const lats = pts.map((p) => p[1]);
  const { m, n } = radii((Math.min(...lats) + Math.max(...lats)) / 2);
  return Math.abs((s * m * n) / 2);
}

/** Area of a GeoJSON Polygon or MultiPolygon, holes taken out. */
export function geometryArea(g: { type: string; coordinates: unknown } | null | undefined): number {
  if (!g) return 0;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as Pos[][][];
  let total = 0;
  for (const poly of polys) poly.forEach((ring, i) => (total += i ? -polygonArea(ring) : polygonArea(ring)));
  return Math.max(0, total);
}

/** The point `dist` meters from `from` along `bearingDeg`. */
export function destination(from: Pos, bearingDeg: number, dist: number): Pos {
  const az = rad(bearingDeg);
  const { m, n } = radii(from[1]);
  const r = 1 / (Math.cos(az) ** 2 / m + Math.sin(az) ** 2 / n);
  const d = dist / r;
  const p1 = rad(from[1]);
  const l1 = rad(from[0]);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az));
  const l2 = l1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(l2), deg(p2)];
}

/** A circle as a closed ring of `steps` points. */
export function circleRing(center: Pos, radius: number, steps = 96): Pos[] {
  const ring: Pos[] = [];
  for (let i = 0; i < steps; i++) ring.push(destination(center, (i * 360) / steps, radius));
  ring.push(ring[0]);
  return ring;
}

/** The point halfway between a and b (fine for the short segments drawn on a city map). */
export const midpoint = (a: Pos, b: Pos): Pos => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The point `t` (0 to 1) of the way along a path, by length. */
export function along(pts: Pos[], t: number): Pos {
  const total = pathLength(pts);
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[i - 1], pts[i]);
    if (left <= d || i === pts.length - 1) {
      const f = d ? Math.min(1, left / d) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    left -= d;
  }
  return pts[0];
}

/** The point on segment a to b nearest p, in a local flat frame (meters), with its distance. */
export function nearestOnSegment(p: Pos, a: Pos, b: Pos): { at: Pos; d: number } {
  const { m, n } = radii(p[1]);
  const kx = rad(1) * n * Math.cos(rad(p[1]));
  const ky = rad(1) * m;
  const ax = (a[0] - p[0]) * kx,
    ay = (a[1] - p[1]) * ky,
    bx = (b[0] - p[0]) * kx,
    by = (b[1] - p[1]) * ky;
  const dx = bx - ax,
    dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  const x = ax + dx * t,
    y = ay + dy * t;
  return { at: [p[0] + x / kx, p[1] + y / ky], d: Math.hypot(x, y) };
}
