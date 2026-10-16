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
  const speed = async () => Number(((await page.textContent('.vc-drive-speed').catch(() => '')) ?? '').match(/\d+/)?.[0] ?? NaN);
  const camera = () => page.evaluate(() => {
    const m = window.__vtpMap;
    return m ? { bearing: Math.round(m.getBearing()), pitch: Math.round(m.getPitch()), zoom: Math.round(m.getZoom() * 10) / 10 } : null;
  });
  const shot = (n) => page.screenshot({ path: `${OUT}/${prof.name}-${n}.png`, timeout: 120000 }).catch(() => run.notes.push(`shot ${n} slow`));
  try {
    await page.goto(`${BASE}/map?lat=${SPOT[1]}&lng=${SPOT[0]}&z=17`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.vc-map canvas') && !document.querySelector('.vc-map-loading'), null, { timeout: 40000 });
    await page.waitForTimeout(2500);
    const m = await page.locator('.vc-map').boundingBox();
    // Street view first, with Zoning and Capital projects turned on from its Layers button (Drive once failed
    // to start after this), then Tools, Drive.
    try {
    await tapEl('.vc-map-tools > button');
    await page.waitForSelector('.vc-pegman:not([disabled])', { timeout: 40000 });
    await tapEl('.vc-pegman');
    await page.waitForTimeout(2500);
    await tap(m.x + m.width / 2, m.y + m.height / 2);
    await page.waitForSelector('.vc-sv-compass, .vc-svp', { timeout: 60000 }).catch(() => run.notes.push('street view slow'));
    await page.waitForTimeout(4000);
    for (const label of ['Zoning', 'Capital projects']) {
      await tapEl('.vc-sv-bar-btn[aria-pressed]');
      await page.waitForSelector('.vc-map-panel .vc-map-layer', { timeout: 30000 });
      const row = page.locator('.vc-map-panel .vc-map-layer', { hasText: label }).first();
      await row.scrollIntoViewIfNeeded().catch(() => undefined);
      const rb = await row.boundingBox();
      if (!(await row.locator('input').isChecked())) await tap(rb.x + rb.width - 30, rb.y + rb.height / 2);
      await page.waitForTimeout(600);
      await tapEl('.vc-map-panel button[aria-label="Close layers"]');
      await page.waitForTimeout(800);
    }
    } catch (e) {
      // The street view part is a lead in; Drive is what is checked here.
      run.svPrelude = String(e).slice(0, 200);
      await shot('0-sv-prelude');
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    await page.waitForTimeout(800);
    await tapEl('.vc-map-tools > button');
    await page.waitForSelector('.vc-drive-item:not([disabled])', { timeout: 30000 });
    await tapEl('.vc-drive-item');
    run.noPicker = (await page.locator('.vc-drive-pick').count()) === 0;
    run.roads = await page.waitForFunction(() => /road to start/.test(document.querySelector('.vc-drive-note')?.textContent ?? ''), null, { timeout: 40000 }).then(() => true, () => false);
    await shot('1-road');
    await tap(m.x + m.width / 2, m.y + m.height / 2);
    run.startedAfterStreetViewLayers = await page.waitForSelector('.vc-drive-hud', { timeout: 20000 }).then(() => true, () => false);
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(2000);
      run.speeds.push(await speed());
    }
    run.toolsHidden = !(await page.locator('.vc-map-tools > button').isVisible().catch(() => false));
    run.barLabels = (await page.locator('.vc-drive-bar button').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    run.barBox = await page.locator('.vc-drive-bar').boundingBox().catch(() => null);
    await shot('2-driving');
    run.overlapsDriving = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    // Frame times while driving in the chase view.
    await page.evaluate(() => window.__vtpDrive && ((window.__vtpDrive.frames.length = 0), (window.__vtpDrive.work.length = 0)));
    await page.waitForTimeout(6000);
    const st = await page.evaluate(() => window.__vtpDrive && { frames: [...window.__vtpDrive.frames], work: [...window.__vtpDrive.work] });
    run.frameMs = st ? { frames: st.frames.length, p50: pct(st.frames, 50), p95: pct(st.frames, 95), fps: st.frames.length ? Math.round((1000 / pct(st.frames, 50)) * 10) / 10 : null } : null;
    run.driveCodeMs = st ? { p50: pct(st.work, 50), p95: pct(st.work, 95), max: pct(st.work, 100) } : null;

    // A tap on the car itself gets in it: the view from the driver's seat, the dashboard along the bottom.
    // The car moves between frames (a second or more each on this runner), so the tap is made in the page
    // itself, at where the car is at that moment, as pointer events on the map.
    const carTap = await page.evaluate((touch) => {
      const d = window.__vtpDrive, m = window.__vtpMap;
      if (!d || !d.at || !m) return null;
      const p = m.project({ lng: d.at[0], lat: d.at[1] });
      const el = m.getCanvasContainer();
      const r = el.getBoundingClientRect();
      const x = r.left + p.x, y = r.top + p.y - 10;
      const ev = (type) => new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: touch ? 'touch' : 'mouse', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
      el.dispatchEvent(ev('pointerdown'));
      el.dispatchEvent(ev('pointerup'));
      return { x, y };
    }, touch);
    if (carTap) {
      await page.waitForTimeout(3000);
      run.cabin = { tapped: carTap, inCar: await page.evaluate(() => Boolean(window.__vtpDrive?.cabin)), lastTap: await page.evaluate(() => window.__vtpDrive?.lastTap ?? null), dash: await page.locator('.vc-drive-dash').count(), camera: await camera(), getOut: (await page.locator('.vc-drive-reset').textContent().catch(() => '')).trim() };
      await shot('2b-cabin');
      if (run.cabin.inCar) {
        await tapEl('.vc-drive-reset');
        await page.waitForTimeout(2500);
        run.cabin.outAgain = !(await page.evaluate(() => Boolean(window.__vtpDrive?.cabin)));
      } else {
        // The tap fell through to the map (a card may have opened): close it so the rest of the check runs as before.
        await page.locator('.vc-map-card button[aria-label="Close details"]').first().click({ timeout: 2000 }).catch(() => undefined);
        await page.locator('.vc-drive-bar button', { hasText: 'Continue' }).first().click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(1500);
      }
    } else run.cabin = { tapped: null };

    // One finger (or the mouse) dragged 300 px sideways: the camera swings around the car.
    const c0 = await camera();
    const x0 = m.x + m.width * 0.2, y0 = m.y + m.height * 0.55;
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
    run.orbit = { before: c0, after: await camera() };
    await shot('3-orbit');
    // Pinches in (or the wheel) all the way out: the whole city from high above, the car a marker.
    const cx = m.x + m.width / 2, cy = m.y + m.height * 0.5;
    for (let k = 0; k < 4; k++) {
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 150, y: cy, id: 1 }, { x: cx + 150, y: cy, id: 2 }] });
        for (let i = 1; i <= 12; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 150 + i * 11, y: cy, id: 1 }, { x: cx + 150 - i * 11, y: cy, id: 2 }] });
          await page.waitForTimeout(30);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(cx, cy);
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, 400);
          await page.waitForTimeout(40);
        }
      }
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(4000);
    run.zoomOut = { after: await camera(), marker: await page.locator('.vc-drive-marker:not([hidden])').count(), markerBox: await page.locator('.vc-drive-marker:not([hidden])').boundingBox().catch(() => null) };
    await shot('4-city');

    // Layers from the Drive bar: a sheet over the bar; nothing overlaps.
    await tapEl('.vc-drive-bar button[aria-pressed]');
    await page.waitForSelector('.vc-map-panel .vc-map-layer', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    run.layersOpen = { panel: await page.locator('.vc-map-panel').isVisible().catch(() => false), barHidden: !(await page.locator('.vc-drive-bar').isVisible()), overlaps: (await overlaps(page)).map((o) => `${o.a} x ${o.b}`) };
    await shot('5-layers');
    await tapEl('.vc-map-panel button[aria-label="Close layers"]');
    await page.waitForTimeout(1500);
    run.barBack = await page.locator('.vc-drive-bar').isVisible();

    // A tap on a zone (Zoning is on): the car stops, the zone's card opens with Continue. The tap lands on a
    // known spot in the RMU zone by Center Street and Main Street, wherever the car has got to.
    const zc = page.locator('.vc-map-card');
    const zonePx = await page.evaluate(() => {
      const mp = window.__vtpMap;
      if (!mp) return null;
      const p = mp.project({ lng: -111.7357, lat: 40.2976 });
      const r = mp.getContainer().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y, w: r.width, h: r.height };
    });
    const onScreen = zonePx && zonePx.x > 20 && zonePx.x < zonePx.w - 20 && zonePx.y > 160 && zonePx.y < zonePx.h - 120;
    const mk = await page.locator('.vc-drive-marker:not([hidden])').boundingBox().catch(() => null);
    const tx = onScreen ? zonePx.x : mk ? mk.x + mk.width / 2 + 30 : m.x + m.width / 2,
      ty = onScreen ? zonePx.y : mk ? mk.y + mk.height / 2 + 30 : m.y + m.height * 0.6;
    for (let i = 0; i < 3 && !(await zc.count()); i++) {
      await tap(tx, ty);
      await page.waitForTimeout(3000);
    }
    const v0 = await speed();
    await page.waitForTimeout(5000);
    run.featureTap = {
      card: await zc.count(),
      kind: (await zc.locator('.vc-map-kind').textContent().catch(() => null))?.trim() ?? null,
      title: (await zc.locator('.vc-map-card-title').textContent().catch(() => null))?.trim() ?? null,
      continueShown: await zc.locator('button', { hasText: 'Continue' }).count(),
      speedAtCard: v0,
      speedAfter5s: await speed(),
      zoneSpotOnScreen: Boolean(onScreen),
      url: page.url(),
      barHidden: !(await page.locator('.vc-drive-bar').isVisible()),
      overlaps: (await overlaps(page)).map((o) => `${o.a} x ${o.b}`),
    };
    await shot('6-card');
    if (run.featureTap.continueShown) {
      const b = await zc.locator('button', { hasText: 'Continue' }).boundingBox();
      await tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(6000);
      run.afterContinue = { card: await zc.count(), speed: await speed(), bar: await page.locator('.vc-drive-bar').isVisible() };
    }
    // Reset view: back behind the car.
    await tapEl('.vc-drive-reset');
    await page.waitForTimeout(4000);
    run.reset = { after: await camera(), resetDisabled: (await page.locator('.vc-drive-reset[disabled]').count()) === 1, marker: await page.locator('.vc-drive-marker:not([hidden])').count() };
    await shot('7-reset');
    run.arrows = await page.waitForSelector('.vc-drive-turns', { timeout: 60000 }).then(() => true, () => false);
    await shot('8-arrows');
    run.overlapsArrows = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    const ab = await page.locator('.vc-drive-turns').boundingBox().catch(() => null);
    run.arrowsAboveCar = ab ? ab.y + ab.height < m.y + m.height * 0.5 : null;
    await tapEl('.vc-drive-bar button[aria-label="Stop"]');
    await page.waitForTimeout(500);
    run.labelAfterStop = (await page.locator('.vc-drive-bar button').nth(1).textContent().catch(() => null))?.trim() ?? null;
    await page.waitForTimeout(7500);
    run.afterStop = await speed();
    await tapEl('.vc-drive-bar button[aria-label="Go"]');
    await page.waitForTimeout(4000);
    run.afterGo = await speed();
    await tapEl('button[aria-label="Exit drive mode"]');
    await page.waitForTimeout(2500);
    run.exited = (await page.locator('.vc-drive-hud').count()) === 0;
    await shot('9-exit');
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
