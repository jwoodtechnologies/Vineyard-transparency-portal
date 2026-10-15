#!/usr/bin/env node
/**
 * The 3D street view at eye level on the live site, at three spots (the road east of Waters Edge, Center
 * Street at Main Street, and Geneva Road), the way a reviewer opens it: /map at zoom 17, Tools, Street view,
 * a click in the middle of the map. A screenshot facing the start direction and after turning right twice,
 * the camera's zoom and pitch, and how much of the view is a flat grey (the camera inside a wall or under the
 * ground shows as one flat colour).
 *
 *   node scripts/shots/eye-check.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const SPOTS = [
  { name: 'waters-edge-road', at: [-111.7451, 40.3036] },
  { name: 'center-main', at: [-111.7357, 40.2976] },
  { name: 'geneva-road', at: [-111.7452, 40.3155] },
];
const { chromium } = await import(args.pw ?? 'playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const log = { runs: [] };
/** The share of the map area whose pixels are all within a few levels of one grey (a wall or the underside of the ground). */
const flatShare = (page, png) =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    // The lower half of the view, under the bars.
    const d = g.getImageData(0, Math.floor(img.height * 0.55), img.width, Math.floor(img.height * 0.4)).data;
    const counts = new Map();
    for (let i = 0; i < d.length; i += 16) {
      const k = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const top = Math.max(...counts.values());
    return Math.round((top / (d.length / 16)) * 100) / 100;
  }, png.toString('base64'));
for (const spot of SPOTS) {
  const run = { name: spot.name, at: spot.at };
  log.runs.push(run);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
      localStorage.setItem('vtp:debug', '1');
    } catch {}
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE}/map?z=17&lat=${spot.at[1]}&lng=${spot.at[0]}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.vc-map canvas', { timeout: 40000 });
    await page.waitForTimeout(3000);
    await page.click('.vc-map-tools > button');
    await page.waitForSelector('.vc-pegman:not([disabled])', { timeout: 40000 });
    await page.click('.vc-pegman');
    await page.waitForTimeout(2500);
    const m = await page.locator('.vc-map').boundingBox();
    await page.mouse.click(m.x + m.width / 2, m.y + m.height / 2);
    run.mode = await Promise.race([
      page.waitForSelector('.vc-sv-compass', { timeout: 60000 }).then(() => '3d'),
      page.waitForSelector('.vc-svp', { timeout: 60000 }).then(() => 'photo'),
    ]).catch(() => 'none');
    await page.waitForTimeout(30000);
    run.camera = await page.evaluate(() => {
      const map = window.__vtpMap;
      return map ? { zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()) } : null;
    });
    run.pin = await page.locator('.vc-sv-pin').first().getAttribute('data-at').catch(() => null);
    const a = await page.screenshot({ path: `${OUT}/${spot.name}-1.png`, timeout: 120000 });
    run.flat1 = await flatShare(page, a);
    for (let i = 0; i < 2; i++) {
      await page.click('button[aria-label="Turn right"]').catch(() => undefined);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(20000);
    const b = await page.screenshot({ path: `${OUT}/${spot.name}-2-turned.png`, timeout: 120000 });
    run.flat2 = await flatShare(page, b);
  } catch (e) {
    run.error = String(e).slice(0, 300);
    await page.screenshot({ path: `${OUT}/${spot.name}-failed.png` }).catch(() => undefined);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/eye-check.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
