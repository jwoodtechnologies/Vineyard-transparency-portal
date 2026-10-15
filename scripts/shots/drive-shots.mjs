#!/usr/bin/env node
/**
 * Drive mode on the live site, phone (390 px) and desktop: Tools, Drive, pick the SUV in blue, tap the road at
 * the middle of the map in Vineyard, drive, take the right turn when the arrows show, stop, go, exit. Saves
 * screenshots of each step, a short screen recording (desktop, .webm), the speeds read off the screen and
 * frames per second while driving.
 *
 *   node scripts/shots/drive-shots.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { overlaps } from './overlap.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(args.pw ?? 'playwright');
// Center Street at Main Street in Vineyard: a road under the middle of the map.
const SPOT = [-111.7357, 40.2976];
const log = { runs: [] };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

for (const prof of [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  { name: 'desktop', ctx: { viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/video`, size: { width: 1280, height: 800 } } } },
]) {
  const run = { tag: prof.name, speeds: [], notes: [] };
  log.runs.push(run);
  const ctx = await browser.newContext(prof.ctx);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => run.notes.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && !/cloudflareinsights|Failed to load/.test(m.text()) && run.notes.push(m.text().slice(0, 200)));
  const speed = async () => Number((await page.textContent('.vc-drive-speed').catch(() => '')).match(/\d+/)?.[0] ?? NaN);
  try {
    await page.goto(`${BASE}/map?lat=${SPOT[1]}&lng=${SPOT[0]}&z=17`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.vc-map canvas') && !document.querySelector('.vc-map-loading'), null, { timeout: 40000 });
    await page.waitForTimeout(2500);
    await page.click('.vc-map-tools > button');
    await page.click('.vc-drive-item');
    await page.waitForSelector('.vc-drive-pick', { timeout: 20000 });
    await page.click('.vc-drive-car:nth-child(2)');
    await page.click('.vc-drive-color:nth-child(2)');
    await page.screenshot({ path: `${OUT}/${prof.name}-1-pick.png` });
    await page.click('.vc-drive-go');
    run.roads = await page.waitForFunction(() => /road to start/.test(document.querySelector('.vc-drive-note')?.textContent ?? ''), null, { timeout: 40000 }).then(() => true, () => false);
    await page.screenshot({ path: `${OUT}/${prof.name}-2-road.png` });
    const m = await page.locator('.vc-map').boundingBox();
    if (prof.ctx.hasTouch) await page.touchscreen.tap(m.x + m.width / 2, m.y + m.height / 2);
    else await page.mouse.click(m.x + m.width / 2, m.y + m.height / 2);
    await page.waitForSelector('.vc-drive-hud', { timeout: 20000 });
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(2000);
      run.speeds.push(await speed());
    }
    await page.screenshot({ path: `${OUT}/${prof.name}-3-driving.png` });
    run.overlapsDriving = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    run.fps = await page.evaluate(() => new Promise((done) => {
      let n = 0;
      const t0 = performance.now();
      const step = (t) => (++n, t - t0 < 4000 ? requestAnimationFrame(step) : done(Math.round((n / ((t - t0) / 1000)) * 10) / 10));
      requestAnimationFrame(step);
    }));
    run.arrows = await page.waitForSelector('.vc-drive-turns', { timeout: 60000 }).then(() => true, () => false);
    run.turnOptions = await page.locator('.vc-drive-turn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    await page.screenshot({ path: `${OUT}/${prof.name}-4-arrows.png` });
    run.overlapsArrows = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    // The car stays clear of the arrows: the canvas under the arrows' box is not where the car is drawn.
    run.arrowsBox = await page.locator('.vc-drive-turns').boundingBox().catch(() => null);
    const right = page.locator('button[aria-label="Turn right"]:not([disabled])');
    if (await right.count()) await right.click();
    await page.waitForTimeout(12000);
    await page.screenshot({ path: `${OUT}/${prof.name}-5-after-turn.png` });
    await page.click('.vc-drive-bar button[aria-label="Stop"]');
    await page.waitForTimeout(8000);
    run.afterStop = await speed();
    await page.click('.vc-drive-bar button[aria-label="Go"]');
    await page.waitForTimeout(4000);
    run.afterGo = await speed();
    await page.click('button[aria-label="Exit drive mode"]');
    await page.waitForTimeout(2500);
    run.exited = (await page.locator('.vc-drive-hud').count()) === 0;
    await page.screenshot({ path: `${OUT}/${prof.name}-6-exit.png` });
  } catch (e) {
    run.error = String(e).slice(0, 400);
    await page.screenshot({ path: `${OUT}/${prof.name}-failed.png` }).catch(() => undefined);
  }
  const video = page.video();
  await ctx.close();
  if (video) renameSync(await video.path(), `${OUT}/drive-desktop.webm`);
}
await browser.close();
writeFileSync(`${OUT}/drive-shots.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
