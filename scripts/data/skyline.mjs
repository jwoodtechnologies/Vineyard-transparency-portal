/**
 * Paints the skyline around Vineyard for the 3D street view: the mountains as seen from eye level, with
 * their snow, from a few viewpoints over the city (the browser shows the nearest). The map itself cannot draw
 * terrain more than a few kilometers from an eye level camera (its far plane cuts it), so the panorama sits
 * behind the map's canvas and the map's own ground, buildings and nearby slopes draw in front of it.
 *
 *   node scripts/data/skyline.mjs --out src/console/streetview/skyline [--cache <dir>]
 *
 * Elevation: AWS terrain tiles (terrarium), zoom 12 near (about 25 m a pixel) and zoom 10 far (100 m), the
 * same tiles the map's terrain uses. Each column of a panorama is one bearing; walking out along it, every
 * slope that rises above everything nearer is painted from the angle below it to its own, nearer slopes over
 * farther ones, with the sky left clear. Colour: rock and brush by height, snow above 2400 m (the map's own
 * snow ramp), lit by how the slope faces the viewer, and hazed with distance.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
const OUT = args.out ?? 'src/console/streetview/skyline';
const CACHE = args.cache ?? join(process.env.TMPDIR ?? '/tmp', 'vtp-dem');
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
/** Viewpoints: a grid over Vineyard (west to east, south to north). */
const LNG = [-111.772, -111.74, -111.708];
const LAT = [40.275, 40.303, 40.331];
const EYE_M = 3;
/** Columns around the full circle and rows over the angle range (pixels a degree). */
const COLS = 3600;
const DEG_MIN = -2;
const DEG_MAX = 14;
const PX_PER_DEG = 20;
const ROWS = (DEG_MAX - DEG_MIN) * PX_PER_DEG;
/** Earth's radius with typical refraction, for how far slopes dip below the horizon. */
const R = 7.45e6;
const FAR_M = 90000;
const NEAR_Z = 12;
const FAR_Z = 10;
const NEAR_KM = 18;

const tileCache = new Map();
function tileXY(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const la = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
  return [x, y];
}
async function tile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = (async () => {
    const file = join(CACHE, `${z}-${x}-${y}.png`);
    let buf;
    if (existsSync(file)) buf = readFileSync(file);
    else {
      const res = await fetch(TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
    }
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height, ch: info.channels };
  })();
  tileCache.set(key, p);
  return p;
}
/** Elevation in meters at a point, bilinear within the tile (no reach across tiles: a pixel at most). */
async function elevationAt(lng, lat, z) {
  const [fx, fy] = tileXY(lng, lat, z);
  const tx = Math.floor(fx),
    ty = Math.floor(fy);
  const t = await tile(z, tx, ty);
  if (!t) return null;
  const px = Math.min(t.w - 1.001, (fx - tx) * t.w),
    py = Math.min(t.h - 1.001, (fy - ty) * t.h);
  const x0 = Math.floor(px),
    y0 = Math.floor(py),
    ax = px - x0,
    ay = py - y0;
  const at = (x, y) => {
    const i = (y * t.w + x) * t.ch;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  return (at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax) * (1 - ay) + (at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax) * ay;
}

const FOG = [223, 232, 240];
const SNOW = [255, 255, 255];
/** Ground colour by height: valley floor, brush, rock. */
function groundColor(e) {
  const stops = [
    [1350, [140, 134, 112]],
    [1700, [118, 110, 90]],
    [2200, [104, 100, 92]],
    [2700, [118, 115, 112]],
    [3400, [132, 130, 128]],
  ];
  if (e <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++)
    if (e <= stops[i][0]) {
      const t = (e - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return stops[i - 1][1].map((c, k) => c + (stops[i][1][k] - c) * t);
    }
  return stops[stops.length - 1][1];
}
/** The map's snow ramp (scenery.ts): clear below 2400 m, patchy, nearly solid from 2700 m. */
function snowAlpha(e) {
  const ramp = [
    [2400, 0],
    [2460, 0.4],
    [2510, 0.25],
    [2580, 0.75],
    [2640, 0.6],
    [2700, 0.9],
    [2850, 0.92],
  ];
  if (e <= ramp[0][0]) return 0;
  for (let i = 1; i < ramp.length; i++) if (e <= ramp[i][0]) return ramp[i - 1][1] + ((ramp[i][1] - ramp[i - 1][1]) * (e - ramp[i - 1][0])) / (ramp[i][0] - ramp[i - 1][0]);
  return ramp[ramp.length - 1][1];
}

async function panorama(lng0, lat0) {
  const e0 = (await elevationAt(lng0, lat0, NEAR_Z)) + EYE_M;
  const img = Buffer.alloc(COLS * ROWS * 4, 0);
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  for (let c = 0; c < COLS; c++) {
    const b = ((c / COLS) * 360 * Math.PI) / 180;
    const dx = Math.sin(b),
      dy = Math.cos(b);
    let top = -Infinity;
    let ePrev = null;
    let dPrev = 0;
    for (let d = 120; d <= FAR_M; d += d < 3000 ? 30 : d < 12000 ? 60 : 150) {
      const lng = lng0 + (dx * d) / kx,
        lat = lat0 + (dy * d) / ky;
      const e = await elevationAt(lng, lat, d < NEAR_KM * 1000 ? NEAR_Z : FAR_Z);
      if (e == null) break;
      const a = (Math.atan2(e - e0 - (d * d) / (2 * R), d) * 180) / Math.PI;
      if (a > top) {
        // Lit by how the slope faces the viewer (rising toward us is lit), hazed with distance.
        const rise = ePrev == null ? 0 : (e - ePrev) / Math.max(1, d - dPrev);
        const shade = 0.6 + 0.4 * Math.max(0, Math.min(1, rise * 1.6 + 0.35));
        const haze = 0.88 * (1 - Math.exp(-d / 42000));
        const sa = snowAlpha(e);
        let col = groundColor(e).map((v) => v * shade);
        col = col.map((v, k) => v * (1 - sa) + SNOW[k] * sa * (0.86 + 0.14 * shade));
        col = col.map((v, k) => v * (1 - haze) + FOG[k] * haze);
        const yTop = Math.max(0, Math.round((DEG_MAX - a) * PX_PER_DEG));
        const yBot = Math.min(ROWS, Math.round((DEG_MAX - Math.max(top, DEG_MIN)) * PX_PER_DEG));
        for (let y = yTop; y < yBot; y++) {
          const i = (y * COLS + c) * 4;
          img[i] = col[0];
          img[i + 1] = col[1];
          img[i + 2] = col[2];
          img[i + 3] = 255;
        }
        top = a;
      }
      ePrev = e;
      dPrev = d;
    }
  }
  return img;
}

const views = [];
let k = 0;
for (const lat of LAT)
  for (const lng of LNG) {
    const name = `sky-${k++}.png`;
    const img = await panorama(lng, lat);
    await sharp(img, { raw: { width: COLS, height: ROWS, channels: 4 } }).png({ compressionLevel: 9, palette: true }).toFile(join(OUT, name));
    views.push({ lng, lat, file: name });
    console.log(name, lng, lat);
  }
writeFileSync(join(OUT, 'skyline.json'), JSON.stringify({ cols: COLS, rows: ROWS, degMin: DEG_MIN, degMax: DEG_MAX, pxPerDeg: PX_PER_DEG, eyeM: EYE_M, views }, null, 2));
console.log('done', views.length);
