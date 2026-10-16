/**
 * Reading roof colours off the county aerial photo. The photo comes as the same map tiles the satellite base
 * draws (mapBase.ts), asked for by web mercator tile; the county's service allows the site to read the
 * pixels. Each building's roof colour is the average of the photo inside its outline. Pure except for
 * `tileUrl`, which only builds an address; the fetching is in scene.worker.ts.
 */
export type RGB = [number, number, number];

const R = 20037508.342789244;

/** The web mercator meters of a longitude and latitude. */
export function mercator(lng: number, lat: number): [number, number] {
  return [(lng / 180) * R, (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / Math.PI) * R];
}

/** The tile at zoom z holding a point. */
export function tileAt(lng: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return [x, y];
}

/** A tile's bounds in web mercator meters: west, south, east, north. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * R) / 2 ** z;
  return [-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size];
}

/** The county aerial's address for a tile, `px` pixels square (the same form the satellite base uses). */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  const b = tileBounds(z, x, y);
  return template.replace('{bbox-epsg-3857}', b.map((v) => String(v)).join(','));
}

/** Whether a point is inside a ring. */
function inRing(p: [number, number], r: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  return inside;
}

/**
 * The average colour of the pixels inside a ring (longitude and latitude), read from a tile image's pixels
 * (`rgba`, `px` wide and tall, covering `bounds` in mercator meters). Null when too little of the ring is on
 * the tile. The result is lifted a little, since the photo is taken in sunlight with shadows.
 */
export function roofColor(ring: Array<[number, number]>, rgba: Uint8ClampedArray, px: number, bounds: [number, number, number, number]): RGB | null {
  const m = ring.map(([lng, lat]) => mercator(lng, lat));
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const [x, y] of m) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  const scale = px / (bounds[2] - bounds[0]);
  const step = Math.max(1, Math.round(0.8 * scale));
  let r = 0,
    g = 0,
    b = 0,
    count = 0;
  const x0 = Math.max(0, Math.floor((w - bounds[0]) * scale)),
    x1 = Math.min(px - 1, Math.ceil((e - bounds[0]) * scale));
  const y0 = Math.max(0, Math.floor((bounds[3] - n) * scale)),
    y1 = Math.min(px - 1, Math.ceil((bounds[3] - s) * scale));
  for (let py = y0; py <= y1; py += step)
    for (let pxl = x0; pxl <= x1; pxl += step) {
      const mx = bounds[0] + (pxl + 0.5) / scale,
        my = bounds[3] - (py + 0.5) / scale;
      if (!inRing([mx, my], m)) continue;
      const i = (py * px + pxl) * 4;
      if (rgba[i + 3] < 200) continue;
      r += rgba[i];
      g += rgba[i + 1];
      b += rgba[i + 2];
      count++;
    }
  if (count < 4) return null;
  const lift = (v: number) => Math.min(1, (v / count / 255) * 1.12 + 0.03);
  return [lift(r), lift(g), lift(b)];
}
