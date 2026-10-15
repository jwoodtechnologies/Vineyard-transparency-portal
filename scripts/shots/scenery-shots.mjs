#!/usr/bin/env node
/**
 * The street level 3D view's scenery on the live site, phone (390 px, CPU slowed 4x) and desktop: drops the
 * person by Utah Lake where no street photo is near, then saves the view facing west (the lake and the Lake
 * Mountains), south (West Mountain and Nebo), east (Timpanogos and the high Wasatch) and toward the sun.
 * Logs the farthest elevation tile the view loaded, and frames per second while turning, with the scenery
 * on and off (localStorage vtp:scenery). The sun is placed for a set time (vtp:sun-at), early evening in Vineyard.
 *
 *   node scripts/shots/scenery-shots.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { sunPosition } from '../../src/console/streetview/sun.ts';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(args.pw ?? 'playwright');
const log = { runs: [] };
const redact = (t) => String(t).replace(/MLY(\||%7C)[^&\s"'<>]+/gi, '[token]').replace(/access_token=[^&\s"'<>]+/g, 'access_token=[token]');

// Shore spots, west of Vineyard and at Lindon Boat Harbor; the first with no street photo within 60 m.
const CANDIDATES = [
  [-111.7695, 40.3045],
  [-111.7672, 40.2985],
  [-111.7605, 40.3398],
  [-111.7740, 40.3120],
];
const token = (await (await fetch(`${BASE}/api/streetview/config`)).json().catch(() => ({}))).token;
let spot = CANDIDATES[0];
if (token)
  for (const c of CANDIDATES) {
    const dy = 60 / 111320, dx = dy / Math.cos((c[1] * Math.PI) / 180);
    const r = await fetch(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id&bbox=${[c[0] - dx, c[1] - dy, c[0] + dx, c[1] + dy].map((v) => v.toFixed(6)).join(',')}&limit=5`).then((x) => x.json()).catch(() => ({}));
    if (!(r.data ?? []).length) {
      spot = c;
      break;
    }
  }
log.spot = spot;
// 18:00 in Vineyard (midnight UTC) this evening: the sun is low in the west south west, over the lake.
const sunAt = `${new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`;
log.sunAt = sunAt;
log.sun = sunPosition(Date.parse(sunAt), spot[1], spot[0]);

/** Distance in km from the spot to the center of tile z/x/y. */
const tileKm = (z, x, y) => {
  const n = 2 ** z;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return Math.hypot((lng - spot[0]) * 85.0, (lat - spot[1]) * 111.3);
};
/** Does tile z/x/y cover this point? */
const covers = (z, x, y, [lng, lat]) => {
  const n = 2 ** z;
  const tx = Math.floor(((lng + 180) / 360) * n);
  const ty = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return tx === x && ty === y;
};
const PEAKS = { lakeMountains: [-111.935, 40.235], westMountain: [-111.80, 40.09], nebo: [-111.76, 39.82], timpanogos: [-111.6457, 40.3908] };

// SwiftShader through ANGLE's GL backend: the runner's default Vulkan backend left the 3D view blank.
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const PROFILES = [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }, cpu: 4 },
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } }, cpu: 1 },
];

async function open(prof, scenery) {
  const ctx = await browser.newContext(prof.ctx);
  await ctx.addInitScript(([sc, at]) => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
      localStorage.setItem('vtp:scenery', sc ? 'on' : 'off');
      localStorage.setItem('vtp:sun-at', at);
    } catch {}
  }, [scenery, sunAt]);
  const page = await ctx.newPage();
  const notes = [];
  const dem = [];
  page.on('request', (r) => {
    const m = r.url().match(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/);
    if (m) dem.push(m.slice(1).map(Number));
  });
  page.on('console', (m) => (m.type() === 'error' || /Content Security Policy|Refused to|Error/.test(m.text())) && notes.push(redact(m.text()).slice(0, 300)));
  page.on('pageerror', (e) => notes.push(redact('pageerror: ' + e.message)));
  if (prof.cpu > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
  // A lost drawing context (the runner draws without a GPU) is noted, since it leaves the map blank.
  await page.addInitScript(() => {
    document.addEventListener('webglcontextlost', () => console.error('WebGL context lost'), true);
  });
  await page.goto(`${BASE}/map?lat=${spot[1]}&lng=${spot[0]}&z=17`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vc-map canvas', { timeout: 40000 }).catch(() => notes.push('map canvas slow'));
  await page.waitForFunction(() => !document.querySelector('.vc-map-loading'), null, { timeout: 40000 }).catch(() => notes.push('map loading slow'));
  await page.waitForTimeout(3000);
  const box = (await page.locator('.vc-map').boundingBox().catch(() => null)) ?? { x: 0, y: 0, ...prof.ctx.viewport };
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (prof.ctx.hasTouch) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
    await page.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await page.mouse.click(cx, cy, { button: 'right' });
  await page.waitForSelector('.vc-sv-compass', { timeout: 30000 });
  await page.waitForTimeout(8000);
  return { ctx, page, notes, dem };
}

const facing = async (page) => Number(((await page.getAttribute('.vc-sv-compass', 'aria-label')) ?? '').match(/facing (-?\d+)/)?.[1] ?? NaN);
/** Turns to the nearest 30 degrees of `deg`: north with the compass, then right in 30 degree steps. */
async function face(page, deg) {
  await page.click('.vc-sv-compass', { force: true });
  await page.waitForTimeout(1200);
  const steps = Math.round((((deg % 360) + 360) % 360) / 30) % 12;
  const n = steps > 6 ? steps - 12 : steps;
  for (let i = 0; i < Math.abs(n); i++) {
    await page.click(`button[aria-label="Turn ${n > 0 ? 'right' : 'left'}"]`, { force: true });
    await page.waitForTimeout(700);
  }
}
/** Frames drawn per second over `ms` while turning right every 300 ms. */
async function fps(page, ms) {
  const counting = page.evaluate((ms) => new Promise((done) => {
    let n = 0;
    const times = [];
    let last = performance.now();
    const t0 = last;
    const step = (t) => {
      n++;
      times.push(t - last);
      last = t;
      if (t - t0 < ms) requestAnimationFrame(step);
      else {
        times.sort((a, b) => a - b);
        done({ fps: Math.round((n / ((t - t0) / 1000)) * 10) / 10, p95FrameMs: Math.round(times[Math.floor(times.length * 0.95)] ?? 0) });
      }
    };
    requestAnimationFrame(step);
  }), ms);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.keyboard.press('d');
    await page.waitForTimeout(300);
  }
  return counting;
}

for (const prof of PROFILES) {
  for (const scenery of [true, false]) {
    const run = { tag: `${prof.name}-${scenery ? 'scenery' : 'plain'}`, cpuSlowdown: prof.cpu };
    log.runs.push(run);
    const { ctx, page, notes, dem } = await open(prof, scenery);
    run.notes = notes;
    try {
      run.startFacing = await facing(page);
      // Which build is live: the scripts the page loaded, searched for the scenery and Google code.
      if (!log.bundle)
        log.bundle = await page.evaluate(async () => {
          const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /\/assets\/.*\.js$/.test(u));
          const has = { snow: false, sun: false, google: false, scripts: urls.length };
          for (const u of urls) {
            const t = await (await fetch(u)).text();
            has.snow ||= t.includes('vtp-sv-snow');
            has.sun ||= t.includes('vc-sv-sun');
            has.google ||= t.includes('vc-google-sv');
          }
          return has;
        });
      run.layers = await page.evaluate(() => [...document.querySelectorAll('.vc-sv-sun')].length);
      if (scenery) {
        for (const [name, deg] of [['west', 270], ['south', 180], ['east', 90], ['sun', log.sun.azimuth]]) {
          await face(page, deg);
          await page.waitForTimeout(20000);
          await page.screenshot({ path: `${OUT}/${prof.name}-${name}.png` });
          run[`facing_${name}`] = await facing(page);
        }
        run.sunShown = await page.locator('.vc-sv-sun:not([hidden])').count();
      }
      await face(page, 270);
      await page.waitForTimeout(3000);
      run.turning = await fps(page, 6000);
      await page.waitForTimeout(500);
      run.idle = await page.evaluate(() => new Promise((done) => {
        let n = 0;
        const t0 = performance.now();
        const step = (t) => (++n, t - t0 < 3000 ? requestAnimationFrame(step) : done(Math.round((n / ((t - t0) / 1000)) * 10) / 10));
        requestAnimationFrame(step);
      }));
      const far = dem.map(([z, x, y]) => ({ z, km: tileKm(z, x, y), x, y }));
      run.demTiles = dem.length;
      run.farthestDemKm = Math.round(Math.max(0, ...far.map((t) => t.km)));
      run.peaksLoaded = Object.fromEntries(Object.entries(PEAKS).map(([k, p]) => [k, dem.some(([z, x, y]) => covers(z, x, y, p))]));
    } catch (e) {
      await page.screenshot({ path: `${OUT}/${run.tag}-failed.png` }).catch(() => undefined);
      run.error = redact(e).slice(0, 500);
    }
    await ctx.close();
  }
}
await browser.close();
const text = redact(JSON.stringify(log, null, 2));
writeFileSync(`${OUT}/scenery-shots.json`, text);
console.log(text);
