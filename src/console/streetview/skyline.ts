/**
 * The skyline behind the 3D street view: panoramas of the mountains around Vineyard with their snow, painted
 * from a few viewpoints over the city by scripts/data/skyline.mjs (the map's own terrain stops a few
 * kilometers from an eye level camera). Pure maths for which panorama to show and where each strip of it
 * lands on the screen; Sky.tsx draws it on a canvas behind the map's canvas.
 */
import meta from './skyline/skyline.json';

export interface SkylineMeta {
  cols: number;
  rows: number;
  degMin: number;
  degMax: number;
  pxPerDeg: number;
  views: Array<{ lng: number; lat: number; file: string }>;
}
export const SKYLINE: SkylineMeta = meta as SkylineMeta;

/** The viewpoint nearest a place (index into SKYLINE.views). */
export function nearestView(lng: number, lat: number, views: SkylineMeta['views'] = SKYLINE.views): number {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = 0,
    bestD = Infinity;
  views.forEach((v, i) => {
    const d = Math.hypot((v.lng - lng) * kx, v.lat - lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export interface Strip {
  /** Source columns in the panorama. */
  sx: number;
  sw: number;
  /** Screen x and width. */
  dx: number;
  dw: number;
}

/**
 * How the panorama maps onto a view `width` wide and `height` tall at `bearing` and `pitch` (degrees) with a
 * vertical field of view `fov`: the strips to draw (the view cut into `slices`), and the top and height of
 * the panorama on screen (its degMax at the top, degMin at the bottom, 0 at the horizon line).
 */
export function skylineLayout(width: number, height: number, bearing: number, pitch: number, fov: number, m: SkylineMeta = SKYLINE, slices = 48): { strips: Strip[]; top: number; height: number } {
  const camPx = (0.5 * height) / Math.tan(((fov / 2) * Math.PI) / 180);
  const up = ((90 - Math.min(pitch, 89.9)) * Math.PI) / 180;
  const horizon = height / 2 - camPx * Math.tan(up);
  // Pixels an elevation degree takes on screen near the horizon.
  const pxDeg = (camPx * (Math.PI / 180)) / (Math.cos(up) * Math.cos(up));
  const colsDeg = m.cols / 360;
  const strips: Strip[] = [];
  const xAt = (i: number) => (i / slices) * width;
  const bearingAt = (x: number) => bearing + (Math.atan((x - width / 2) / camPx) * 180) / Math.PI;
  for (let i = 0; i < slices; i++) {
    const x0 = xAt(i),
      x1 = xAt(i + 1);
    const b0 = bearingAt(x0),
      b1 = bearingAt(x1);
    const c0 = (((b0 * colsDeg) % m.cols) + m.cols) % m.cols;
    const sw = (b1 - b0) * colsDeg;
    if (c0 + sw <= m.cols) strips.push({ sx: c0, sw, dx: x0, dw: x1 - x0 });
    else {
      // The strip wraps past the panorama's east edge: two pieces.
      const first = m.cols - c0;
      const k = first / sw;
      strips.push({ sx: c0, sw: first, dx: x0, dw: (x1 - x0) * k });
      strips.push({ sx: 0, sw: sw - first, dx: x0 + (x1 - x0) * k, dw: (x1 - x0) * (1 - k) });
    }
  }
  return { strips, top: horizon - m.degMax * pxDeg, height: (m.degMax - m.degMin) * pxDeg };
}
