#!/usr/bin/env node
/**
 * How fast the live map feels, phone (390 px, CPU slowed 4x) and desktop, on the satellite map and in the
 * street level 3D view: time to the first painted map, time until the map is settled (no tile requests for
 * 800 ms) after a pan of about 2 km and back, and how many tiles are fetched over the network on the way back
 * (the target is none: tiles seen in the last few minutes should come from memory or the browser's cache).
 * Runs each case twice in one browser profile, so the second visit shows what the service worker cache gives.
 *
 *   node scripts/perf/map-speed.mjs --base https://vineyardportal.org --out speed.json --pw <playwright index.mjs>
 */
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const { chromium } = await import(args.pw ?? 'playwright');
const TILE = /tiles\.openfreemap\.org|elevation-tiles-prod|gisaerials\.utahcounty\.gov|basemap\.nationalmap\.gov|\/api\/map\/(parcels|stories)\//;
const SPOT = [-111.7455, 40.3035];
const log = { base: BASE, at: new Date().toISOString(), runs: [] };

const browser = await chromium.launch();
for (const prof of [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, cpu: 4 },
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } }, cpu: 1 },
]) {
  // One profile per device: the second visit finds what the first left in the caches.
  const ctx = await browser.newContext({ ...prof.ctx, serviceWorkers: 'allow' });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
    } catch {}
  });
  for (const visit of [1, 2])
    for (const mode of ['2d', '3d']) {
      const run = { tag: `${prof.name}-${mode}-visit${visit}` };
      log.runs.push(run);
      const page = await ctx.newPage();
      if (prof.cpu > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
      const reqs = [];
      let last = Date.now();
      page.on('requestfinished', async (r) => {
        if (!TILE.test(r.url())) return;
        last = Date.now();
        const resp = await r.response().catch(() => null);
        reqs.push({ t: Date.now(), sw: Boolean(resp?.fromServiceWorker()), url: r.url().split('?')[0].slice(-60) });
      });
      const settled = async (maxMs = 45000) => {
        const t0 = Date.now();
        await page.waitForTimeout(300);
        while (Date.now() - last < 800 && Date.now() - t0 < maxMs) await page.waitForTimeout(100);
        return Date.now() - t0;
      };
      try {
        const t0 = Date.now();
        await page.goto(`${BASE}/map?lat=${SPOT[1]}&lng=${SPOT[0]}&z=15`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.vc-map canvas') && !document.querySelector('.vc-map-loading'), null, { timeout: 60000 });
        run.firstPaintMs = Date.now() - t0;
        run.settleOpenMs = await settled();
        const box = await page.locator('.vc-map').boundingBox();
        const cx = box.x + box.width / 2,
          cy = box.y + box.height / 2;
        if (mode === '3d') {
          await page.mouse.click(cx, cy, { button: 'right' }).catch(() => undefined);
          if (prof.ctx.hasTouch) {
            const cdp = await ctx.newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
            await page.waitForTimeout(800);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          }
          const t1 = Date.now();
          await page.waitForSelector('.vc-sv-compass', { timeout: 30000 });
          run.threeDOpenMs = Date.now() - t1;
          run.threeDSettleMs = await settled();
          // Turn all the way around and back (in 3D, panning is turning and stepping).
          const before = reqs.length;
          for (let i = 0; i < 6; i++) await page.click('button[aria-label="Turn right"]', { force: true }).then(() => page.waitForTimeout(400));
          run.turnSettleMs = await settled();
          const mid = reqs.length;
          for (let i = 0; i < 6; i++) await page.click('button[aria-label="Turn left"]', { force: true }).then(() => page.waitForTimeout(400));
          run.turnBackSettleMs = await settled();
          run.tilesOnTurnOut = mid - before;
          run.tilesOnTurnBack = reqs.slice(mid).filter((r) => !r.sw).length;
          run.tilesOnTurnBackFromSw = reqs.slice(mid).filter((r) => r.sw).length;
        } else {
          // About 2 km east at zoom 15 (about 3.6 m a pixel here), in steps, then back.
          const drag = async (dx) => {
            for (let k = 0; k < 3; k++) {
              await page.mouse.move(cx, cy);
              await page.mouse.down();
              await page.mouse.move(cx + dx / 3, cy, { steps: 8 });
              await page.mouse.up();
              await page.waitForTimeout(150);
            }
          };
          const before = reqs.length;
          const p0 = Date.now();
          await drag(-550);
          run.panSettleMs = (await settled()) + (Date.now() - p0 - 0);
          const mid = reqs.length;
          const p1 = Date.now();
          await drag(550);
          await settled();
          run.panBackSettleMs = Date.now() - p1;
          run.tilesOnPanOut = mid - before;
          run.tilesOnPanBack = reqs.slice(mid).filter((r) => !r.sw).length;
          run.tilesOnPanBackFromSw = reqs.slice(mid).filter((r) => r.sw).length;
        }
        run.swControlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
        run.tileRequests = reqs.length;
        run.fromSw = reqs.filter((r) => r.sw).length;
      } catch (e) {
        run.error = String(e).slice(0, 400);
      }
      await page.close();
    }
  await ctx.close();
}
await browser.close();
writeFileSync(args.out ?? 'map-speed.json', JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
