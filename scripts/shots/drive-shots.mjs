#!/usr/bin/env node
/**
 * Drive mode on the live site, phone first (390 x 844, real touch events) and desktop: Tools, Drive, tap the
 * road at the middle of the map, drive; one finger dragged turns the camera around the car, a pinch takes it
 * out to a high view, Reset view brings it back; Tools, Layers, Zoning on, then a tap on the ground opens the
 * zone's card while the car keeps driving; the turn arrows; Stop, Go, Exit. Saves screenshots of each step,
 * a screen recording of each run (.webm), the speeds read off the screen, the camera before and after each
 * gesture, frame times (time between frames and the time Drive's own frame code takes) and the overlap check.
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
const log = { runs: [], note: 'The runner draws WebGL in software (SwiftShader, no GPU), so its frame rate is far below a phone; the frame code time is the part this page controls.' };
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const pct = (list, p) => {
  if (!list?.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};

for (const prof of [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, recordVideo: { dir: `${OUT}/video-phone`, size: { width: 390, height: 844 } } } },
  { name: 'desktop', ctx: { viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${OUT}/video`, size: { width: 1280, height: 800 } } } },
]) {
  const touch = Boolean(prof.ctx.hasTouch);
  const run = { tag: prof.name, speeds: [], notes: [] };
  log.runs.push(run);
  const ctx = await browser.newContext(prof.ctx);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
      localStorage.setItem('vtp:debug', '1');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => run.notes.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && !/cloudflareinsights|Failed to load/.test(m.text()) && run.notes.push(m.text().slice(0, 200)));
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  const tap = async (x, y) => {
    if (!touch) return page.mouse.click(x, y);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await page.waitForTimeout(70);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const tapEl = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`not shown: ${sel}`);
    await tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  const speed = async () => Number((await page.textContent('.vc-drive-speed').catch(() => '')).match(/\d+/)?.[0] ?? NaN);
  const camera = () => page.evaluate(() => {
    const m = window.__vtpMap;
    return m ? { bearing: Math.round(m.getBearing()), pitch: Math.round(m.getPitch()), zoom: Math.round(m.getZoom() * 10) / 10 } : null;
  });
  const shot = (n) => page.screenshot({ path: `${OUT}/${prof.name}-${n}.png`, timeout: 120000 }).catch(() => run.notes.push(`shot ${n} slow`));
  try {
    await page.goto(`${BASE}/map?lat=${SPOT[1]}&lng=${SPOT[0]}&z=17`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.vc-map canvas') && !document.querySelector('.vc-map-loading'), null, { timeout: 40000 });
    await page.waitForTimeout(2500);
    // Tools, Drive: straight to "tap a road" (no car picker).
    await tapEl('.vc-map-tools > button');
    await page.waitForSelector('.vc-drive-item:not([disabled])', { timeout: 30000 });
    await tapEl('.vc-drive-item');
    run.noPicker = (await page.locator('.vc-drive-pick').count()) === 0;
    run.roads = await page.waitForFunction(() => /road to start/.test(document.querySelector('.vc-drive-note')?.textContent ?? ''), null, { timeout: 40000 }).then(() => true, () => false);
    await shot('1-road');
    const m = await page.locator('.vc-map').boundingBox();
    await tap(m.x + m.width / 2, m.y + m.height / 2);
    await page.waitForSelector('.vc-drive-hud', { timeout: 20000 });
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(2000);
      run.speeds.push(await speed());
    }
    await shot('2-driving');
    run.overlapsDriving = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    // Frame times while driving in the chase view.
    await page.evaluate(() => window.__vtpDrive && ((window.__vtpDrive.frames.length = 0), (window.__vtpDrive.work.length = 0)));
    await page.waitForTimeout(6000);
    const st = await page.evaluate(() => window.__vtpDrive && { frames: [...window.__vtpDrive.frames], work: [...window.__vtpDrive.work] });
    run.frameMs = st ? { frames: st.frames.length, p50: pct(st.frames, 50), p95: pct(st.frames, 95), fps: st.frames.length ? Math.round((1000 / pct(st.frames, 50)) * 10) / 10 : null } : null;
    run.driveCodeMs = st ? { p50: pct(st.work, 50), p95: pct(st.work, 95), max: pct(st.work, 100) } : null;

    // One finger (or the mouse) dragged 300 px sideways: the camera swings around the car.
    const c0 = await camera();
    const x0 = m.x + m.width * 0.2, y0 = m.y + m.height * 0.65;
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
      for (let i = 1; i <= 20; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 15, y: y0, id: 1 }] });
        await page.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + 300, y0, { steps: 20 });
      await page.mouse.up();
    }
    await page.waitForTimeout(2500);
    const c1 = await camera();
    await shot('3-orbit');
    run.orbit = { before: c0, after: c1, resetShown: await page.locator('.vc-drive-reset:not([disabled])').count() };
    // A pinch in (fingers together) or the wheel: out to a high view.
    const cx = m.x + m.width / 2, cy = m.y + m.height * 0.6;
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 120, y: cy, id: 1 }, { x: cx + 120, y: cy, id: 2 }] });
      for (let i = 1; i <= 12; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 120 + i * 9, y: cy, id: 1 }, { x: cx + 120 - i * 9, y: cy, id: 2 }] });
        await page.waitForTimeout(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 8; i++) {
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(40);
      }
    }
    await page.waitForTimeout(3000);
    const c2 = await camera();
    await shot('4-overview');
    run.zoomOut = { after: c2, speed: await speed() };
    // Layers while driving, from the high view (zoned ground all around, not just the road, which has no
    // zone): Tools, Layers, Zoning on, Done; then a tap on the ground opens the zone's card, the car keeps
    // driving and the camera stays where it was.
    await tapEl('.vc-map-tools > button');
    await page.waitForTimeout(800);
    await shot('6-tools-open');
    // The menu opens over the Drive bar on purpose (it is on top); anything else is a problem.
    const ov = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    run.toolsOpen = { overlaps: ov, problems: ov.filter((o) => !/\.vc-map-tools-menu x \.vc-drive-bar|\.vc-drive-bar x \.vc-map-tools-menu/.test(o)), menuOnTop: await page.evaluate(() => {
      const el = document.querySelector('.vc-map-tools-menu [role^="menuitem"]');
      const r = el?.getBoundingClientRect();
      const top = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(top && el.contains(top));
    }) };
    await tapEl('.vc-map-tools-menu [role^="menuitem"]');
    await page.waitForSelector('.vc-map-panel .vc-map-layer', { timeout: 30000 });
    const row = page.locator('.vc-map-panel .vc-map-layer', { hasText: 'Zoning' }).first();
    await row.scrollIntoViewIfNeeded().catch(() => undefined);
    const rb = await row.boundingBox();
    if (!(await row.locator('input').isChecked())) await tap(rb.x + rb.width - 30, rb.y + rb.height / 2);
    await page.waitForTimeout(600);
    run.zoningOn = await row.locator('input').isChecked();
    await shot('7-layers');
    await tapEl('.vc-map-panel button[aria-label="Close layers"]');
    await page.waitForTimeout(4000);
    const cBefore = await camera();
    const vBefore = await speed();
    await tap(m.x + m.width * 0.3, m.y + m.height * 0.72);
    await page.waitForTimeout(2500);
    const card = page.locator('.vc-map-card[data-over-sv]');
    await page.waitForTimeout(2000);
    const cAfter = await camera();
    run.zoneTap = {
      card: await card.count(),
      kind: (await card.locator('.vc-map-kind').textContent().catch(() => null))?.trim() ?? null,
      title: (await card.locator('.vc-map-card-title').textContent().catch(() => null))?.trim() ?? null,
      speedBefore: vBefore,
      speedAfter: await speed(),
      zoomSame: cBefore?.zoom === cAfter?.zoom,
      pitchSame: cBefore?.pitch === cAfter?.pitch,
      overlaps: (await overlaps(page)).map((o) => `${o.a} x ${o.b}`),
    };
    await shot('8-zone-card');
    if (run.zoneTap.card) await tapEl('button[aria-label="Close details"]').catch(() => undefined);

    // Reset view: back behind the car.
    await tapEl('.vc-drive-reset');
    await page.waitForTimeout(3000);
    run.reset = { after: await camera(), resetDisabled: (await page.locator('.vc-drive-reset[disabled]').count()) === 1 };
    await shot('5-reset');

    run.arrows = await page.waitForSelector('.vc-drive-turns', { timeout: 60000 }).then(() => true, () => false);
    run.turnOptions = await page.locator('.vc-drive-turn').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    await shot('9-arrows');
    run.overlapsArrows = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    // The car is drawn a little below the middle of the map; the arrows must sit above it.
    const ab = await page.locator('.vc-drive-turns').boundingBox().catch(() => null);
    run.arrowsAboveCar = ab ? ab.y + ab.height < m.y + m.height * 0.5 : null;
    await tapEl('.vc-drive-bar button[aria-label="Stop"]');
    await page.waitForTimeout(8000);
    run.afterStop = await speed();
    await tapEl('.vc-drive-bar button[aria-label="Go"]');
    await page.waitForTimeout(4000);
    run.afterGo = await speed();
    await tapEl('button[aria-label="Exit drive mode"]');
    await page.waitForTimeout(2500);
    run.exited = (await page.locator('.vc-drive-hud').count()) === 0;
    await shot('10-exit');
  } catch (e) {
    run.error = String(e).slice(0, 400);
    await shot('failed');
  }
  const video = page.video();
  await ctx.close();
  if (video) renameSync(await video.path(), `${OUT}/drive-${prof.name}.webm`);
}
await browser.close();
writeFileSync(`${OUT}/drive-shots.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
