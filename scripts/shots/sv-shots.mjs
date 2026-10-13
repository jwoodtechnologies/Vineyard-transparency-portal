#!/usr/bin/env node
/**
 * Screenshots of the live map's street view for review, at phone width (390 px) and on a desktop window.
 * Finds a spot with Mapillary coverage in Vineyard (through the portal's own token route), drops the pin
 * with a long press (phone) or right click (desktop), and saves the photo view, the photo view with zoning
 * off, and the 3D view where no photo exists. Logs any Content Security Policy refusals.
 *
 *   node scripts/shots/sv-shots.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(args.pw ?? 'playwright');
const log = { spots: {}, runs: [] };
/** Never write the token anywhere: it is the site's, and this log is saved to the repository's diagnostics branch. */
const redact = (t) => String(t).replace(/MLY(\||%7C)[^&\s"'<>]+/gi, '[token]').replace(/access_token=[^&\s"'<>]+/g, 'access_token=[token]');

const token = (await (await fetch(`${BASE}/api/streetview/config`)).json()).token;
log.tokenSet = Boolean(token);
let photoSpot = null;
if (token) {
  // Geneva Road and the north side of Vineyard, where the reviewer saw coverage.
  for (const bbox of ['-111.7420,40.2950,-111.7330,40.3150', '-111.7600,40.3150,-111.7300,40.3300', '-111.7700,40.2800,-111.7000,40.3300']) {
    const r = await fetch(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,computed_geometry,geometry,computed_compass_angle,is_pano&bbox=${bbox}&limit=50`);
    const list = (await r.json()).data ?? [];
    // A photo whose camera GPS and Mapillary's corrected position agree: it is on its blue line, and the
    // page's area search (by GPS) finds it.
    const agree = list.filter((x) => x.geometry && x.computed_geometry && Math.hypot((x.geometry.coordinates[0] - x.computed_geometry.coordinates[0]) * 85000, (x.geometry.coordinates[1] - x.computed_geometry.coordinates[1]) * 111000) < 4);
    const pick = agree.find((x) => x.is_pano) ?? agree[0];
    if (pick) {
      const [lng, lat] = pick.computed_geometry.coordinates;
      // About 30 m ahead of the camera and a little toward the city (west), so the pin is in the photo.
      const b = (((pick.computed_compass_angle ?? 0) + 360) % 360) * (Math.PI / 180);
      const turn = Math.sin(b) > 0 ? -0.4 : 0.4; // facing east of north: turn left (west); else right
      const bb = b + (Math.cos(b) >= 0 ? turn : -turn);
      photoSpot = [lng + (30 * Math.sin(bb)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (30 * Math.cos(bb)) / 111320];
      log.spots.photo = { bbox, image: pick.id, pano: pick.is_pano, pin: photoSpot, at: [lng, lat], found: list.length };
      // The same search the page makes around the pin (about 60 m each way), to explain a 3D fallback.
      const dy = 60 / 111320, dx = dy / Math.cos((photoSpot[1] * Math.PI) / 180);
      const near = await fetch(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,computed_geometry,geometry&bbox=${[photoSpot[0] - dx, photoSpot[1] - dy, photoSpot[0] + dx, photoSpot[1] + dy].map((v) => v.toFixed(6)).join(',')}&limit=200`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
      log.spots.photo.pageSearch = near.data ? { count: near.data.length, withComputed: near.data.filter((x) => x.computed_geometry).length, pickInIt: near.data.some((x) => x.id === pick.id) } : { error: redact(JSON.stringify(near)).slice(0, 300) };
      break;
    }
  }
}
const noPhotoSpot = [-111.7455, 40.3035]; // a residential block with no street photos (the reviewer's 3D check)
log.spots.none = noPhotoSpot;

const browser = await chromium.launch();
const PROFILES = [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } } },
];
const lineSpot = log.spots.photo ? [log.spots.photo.at[0], log.spots.photo.at[1]] : null;

async function open(prof, spot, z, dark, extra = {}) {
  const ctx = await browser.newContext({ ...prof.ctx, colorScheme: dark ? 'dark' : 'light' });
  await ctx.addInitScript((x) => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
      for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v);
    } catch {}
  }, extra);
  const page = await ctx.newPage();
  const notes = [];
  page.on('console', (m) => /Content Security Policy|Refused to|Street photo|thumbnail/.test(m.text()) && !/cloudflareinsights/.test(m.text()) && notes.push(redact(m.text()).slice(0, 300)));
  page.on('pageerror', (e) => notes.push(redact('pageerror: ' + e.message)));
  await page.goto(`${BASE}/map?lat=${spot[1]}&lng=${spot[0]}&z=${z}`, { waitUntil: 'domcontentloaded' });
  // A slow load is noted, not fatal: the block's own steps say what did not work.
  await page.waitForSelector('.vc-map canvas', { timeout: 30000 }).catch(() => notes.push('map canvas slow'));
  // Street view is in the Tools menu: wait until it can be picked, then close the menu.
  await page.waitForSelector('.vc-map-tools > button', { timeout: 30000 }).catch(() => notes.push('tools button slow'));
  await page.waitForFunction(() => !document.querySelector('.vc-map-loading'), null, { timeout: 30000 }).catch(() => notes.push('map loading slow'));
  await page.waitForTimeout(3500);
  const box = (await page.locator('.vc-map').boundingBox().catch(() => null)) ?? { x: 0, y: 0, ...prof.ctx.viewport };
  return { ctx, page, notes, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

const touchTap = async (ctx, page, x, y, hold = 60) => {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
/** The share of near black pixels in the outer tenth of the view on each side, read from a screenshot. */
const blackEdge = (page, png) =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const side = (x0, x1) => {
      const d = g.getImageData(x0, 0, x1 - x0, img.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 24) dark++;
      return Math.round((dark / (d.length / 4)) * 100) / 100;
    };
    const w = Math.max(1, Math.floor(img.width / 10));
    return { left: side(0, w), right: side(img.width - w, img.width) };
  }, png.toString('base64'));
/** Street view from the Tools menu (waiting for it to be ready). */
const streetViewOn = async (page) => {
  await page.click('.vc-map-tools > button');
  await page.waitForSelector('.vc-map-tools-item.vc-pegman:not([disabled])', { timeout: 30000 });
  await page.click('.vc-map-tools-item.vc-pegman');
};
const attribution = (page) => page.getAttribute('.vc-svp-view', 'data-image').catch(() => '');

for (const prof of PROFILES) {
  // 1) Find the street: the person dropped (desktop) or the button then a tap on a blue line (phone).
  if (lineSpot)
    for (const dark of [false, true]) {
      const tag = `${prof.name}${dark ? '-dark' : ''}`;
      const run = { tag, notes: [] };
      log.runs.push(run);
      const { ctx, page, notes, cx, cy } = await open(prof, lineSpot, 18, dark);
      run.notes = notes;
      try {
        await page.click('.vc-map-tools > button');
        await page.waitForSelector('.vc-map-tools-item.vc-pegman:not([disabled])', { timeout: 30000 });
        const btn = await page.locator('.vc-map-tools-item.vc-pegman').boundingBox();
        if (prof.ctx.hasTouch) {
          await page.tap('.vc-map-tools-item.vc-pegman');
          await page.waitForTimeout(3000);
          if (!dark) await page.screenshot({ path: `${OUT}/${tag}-1-lines.png` });
          run.hint = (await page.textContent('.vc-sv-note').catch(() => ''))?.trim();
          await touchTap(ctx, page, cx, cy);
        } else {
          await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
          await page.mouse.down();
          await page.mouse.move(cx - 60, cy - 40, { steps: 12 });
          await page.waitForTimeout(2500);
          await page.mouse.move(cx, cy - 14, { steps: 6 });
          await page.waitForTimeout(800);
          if (!dark) await page.screenshot({ path: `${OUT}/${tag}-1-dragging.png` });
          run.ghostOnLine = await page.locator('.vc-pegman-ghost.on-line').count();
          await page.mouse.up();
        }
        await page.waitForSelector('.vc-svp', { timeout: 20000 });
        const t0 = Date.now();
        const shown = await page.waitForSelector('.vc-svp .mapillary-attribution-container', { timeout: 25000 }).then(() => true, () => false);
        run.photoShownMs = shown ? Date.now() - t0 : null;
        await page.waitForTimeout(3500);
        await page.screenshot({ path: `${OUT}/${tag}-2-photo.png` });
        run.date = (await page.textContent('.vc-svp-when').catch(() => ''))?.trim();
        run.dateOptions = await page.locator('.vc-svp-when option').allTextContents();
        run.chips = await page.locator('.vc-svp-chip').allTextContents();
        run.miniMap = await page.locator('.vc-svp-mini canvas').count();
        run.miniMapInfo = await page.locator('.vc-svp-mini .maplibregl-ctrl-attrib').count();
        run.zoningPressed = await page.getAttribute('.vc-svp .vc-sv-bar-btn[aria-pressed]', 'aria-pressed').catch(() => null);
        if (!dark) {
          // Look as far left as a drag allows: a flat photo must not show black past its edge.
          const v = await page.locator('.vc-svp-canvas').boundingBox();
          for (let i = 0; i < 3; i++) {
            await page.mouse.move(v.x + v.width * 0.2, v.y + v.height * 0.5);
            await page.mouse.down();
            await page.mouse.move(v.x + v.width * 0.95, v.y + v.height * 0.5, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(400);
          }
          await page.waitForTimeout(1200);
          const shot = await page.screenshot({ clip: v });
          run.edgeBlack = await blackEdge(page, shot);
          await page.screenshot({ path: `${OUT}/${tag}-2b-edge.png` });
          // Click (or tap) on the road ahead: the next photo that way.
          const c = await page.locator('.vc-svp-canvas').boundingBox();
          const before = await attribution(page);
          if (prof.ctx.hasTouch) await touchTap(ctx, page, c.x + c.width / 2, c.y + c.height * 0.72);
          else await page.mouse.click(c.x + c.width / 2, c.y + c.height * 0.72);
          await page.waitForTimeout(5000);
          run.clickToGo = { before, after: await attribution(page) };
          await page.screenshot({ path: `${OUT}/${tag}-3-moved.png` });
          if (!prof.ctx.hasTouch) {
            await page.click('.vc-svp-swap');
            await page.waitForTimeout(2500);
            await page.screenshot({ path: `${OUT}/${tag}-4-swapped.png` });
            await page.click('.vc-svp-swap');
          }
        }
      } catch (e) {
        await page.screenshot({ path: `${OUT}/${tag}-failed.png` }).catch(() => undefined);
        run.error = redact(e).slice(0, 500);
      }
      await ctx.close();
    }
  // 2) Hover a blue line with the Street photos switch on (mouse only): the thumbnail.
  if (lineSpot && !prof.ctx.hasTouch) {
    const run = { tag: `${prof.name}-hover`, notes: [] };
    log.runs.push(run);
    const { ctx, page, notes, cx, cy } = await open(prof, lineSpot, 18, false);
    run.notes = notes;
    // The blue lines show only while street view is in use.
    await streetViewOn(page);
    await page.waitForTimeout(2500);
    // Sweep across the middle of the map until the pointer rests on a line and the thumbnail shows.
    for (let dx = -160; dx <= 160; dx += 6) {
      if (await page.locator('.vc-mly-tip:not([hidden]) img').count()) break;
      await page.mouse.move(cx + dx, cy + 30);
      await page.waitForTimeout(dx % 24 === 0 ? 700 : 120);
    }
    await page.waitForTimeout(1500);
    run.thumb = await page.locator('.vc-mly-tip:not([hidden]) img').count();
    await page.screenshot({ path: `${OUT}/${prof.name}-5-hover.png` });
    await ctx.close();
  }
  // 3) No photo: the 3D street level view, from a long press or right click.
  {
    const run = { tag: `${prof.name}-3d`, notes: [] };
    log.runs.push(run);
    const { ctx, page, notes, cx, cy } = await open(prof, noPhotoSpot, 18, false);
    run.notes = notes;
    try {
      if (prof.ctx.hasTouch) await touchTap(ctx, page, cx, cy, 800);
      else await page.mouse.click(cx, cy, { button: 'right' });
      await page.waitForSelector('.vc-sv-note', { timeout: 20000 });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: `${OUT}/${prof.name}-6-3d.png` });
      run.note = (await page.textContent('.vc-sv-note'))?.trim();
      // Looking around: a drag turns the view, the buttons turn and step, the compass faces north again.
      const facing = async () => Number(((await page.getAttribute('.vc-sv-compass', 'aria-label')) ?? '').match(/facing (-?\d+)/)?.[1] ?? NaN);
      const pinY = async () => (await page.locator('.vc-sv-pin').boundingBox().catch(() => null))?.y ?? null;
      // The heading once the view stops turning (the runner draws without a GPU, so a turn can take seconds).
      const settled = async () => {
        let last = await facing();
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(400);
          const now = await facing();
          if (now === last) return now;
          last = now;
        }
        return last;
      };
      run.look = { start: await facing() };
      if (prof.ctx.hasTouch) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx + 60, y: cy, id: 1 }] });
        for (let i = 1; i <= 10; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + 60 - i * 15, y: cy - i * 3, id: 1 }] });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(cx + 60, cy);
        await page.mouse.down();
        await page.mouse.move(cx - 90, cy - 30, { steps: 10 });
        await page.mouse.up();
      }
      run.look.afterDrag = await settled();
      await page.click('button[aria-label="Turn right"]');
      await page.waitForTimeout(400);
      run.look.afterTurnRight = await settled();
      if (!prof.ctx.hasTouch) {
        await page.keyboard.press('a');
        await page.waitForTimeout(400);
        run.look.afterKeyA = await settled();
      }
      const note0 = await page.textContent('.vc-sv-note');
      await page.click('button[aria-label="Forward"]');
      await page.waitForTimeout(1500);
      run.look.forwardKeeps3d = (await page.locator('.vc-sv-compass').count()) === 1;
      run.look.pinY = await pinY();
      await page.screenshot({ path: `${OUT}/${prof.name}-7-3d-turned.png` });
      await page.click('.vc-sv-compass');
      await page.waitForTimeout(400);
      run.look.afterCompassTap = await settled();
      // Face east toward the Wasatch and look up near eye level: terrain, sky and clouds.
      for (let i = 0; i < 3; i++) {
        await page.click('button[aria-label="Turn right"]');
        await page.waitForTimeout(350);
      }
      if (prof.ctx.hasTouch) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy + 120, id: 1 }] });
        for (let i = 1; i <= 8; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + 120 - i * 5, id: 1 }] });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(cx, cy + 120);
        await page.mouse.down();
        await page.mouse.move(cx, cy + 80, { steps: 8 });
        await page.mouse.up();
      }
      await page.waitForTimeout(9000);
      run.look.east = await facing();
      run.look.sky = await page.evaluate(() => getComputedStyle(document.querySelector('.vc-sv-sky') ?? document.body).height);
      run.look.zoningPressed = await page.getAttribute('.vc-sv-bar-btn[aria-pressed]', 'aria-pressed').catch(() => null);
      run.look.title = (await page.textContent('.vc-sv-title').catch(() => ''))?.trim();
      await page.screenshot({ path: `${OUT}/${prof.name}-8-3d-east.png` });
      run.look.noteSame = note0 === (await page.textContent('.vc-sv-note'));
    } catch (e) {
      run.error = redact(e).slice(0, 500);
    }
    await ctx.close();
  }
}
await browser.close();
const text = redact(JSON.stringify(log, null, 2));
writeFileSync(`${OUT}/sv-shots.json`, text);
console.log(text);
