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
import { overlaps } from './overlap.mjs';

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
const blackEdge = (page, png, whole = false) =>
  page.evaluate(async ([b64, whole]) => {
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
    if (whole) return side(0, img.width);
    const w = Math.max(1, Math.floor(img.width / 10));
    return { left: side(0, w), right: side(img.width - w, img.width) };
  }, [png.toString('base64'), whole]);
/** Street view from the Tools menu (waiting for it to be ready). */
const streetViewOn = async (page) => {
  await page.click('.vc-map-tools > button');
  await page.waitForSelector('.vc-map-tools-item.vc-pegman:not([disabled])', { timeout: 30000 });
  await page.click('.vc-map-tools-item.vc-pegman');
};
/** A 200 px sideways drag (mouse or one finger) starting at the middle of `box`. */
async function drag200(ctx, page, box, touch) {
  const x = box.x + box.width / 2 - 100, y = box.y + box.height * 0.6;
  if (touch) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let i = 1; i <= 20; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 10, y, id: 1 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y, { steps: 20 });
    await page.mouse.up();
  }
}
/** Counts parcel lookups, which the page makes each time the pin moves. */
const pinMoves = (page) => {
  const c = { n: 0 };
  page.on('request', (r) => /\/api\/map\/parcel\?/.test(r.url()) && c.n++);
  return c;
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
        {
          // A 200 px drag only looks around: the same photo, no pin move.
          const moves = pinMoves(page);
          const before = await attribution(page);
          const v = await page.locator('.vc-svp-canvas').boundingBox();
          await drag200(ctx, page, v, prof.ctx.hasTouch);
          await page.waitForTimeout(3000);
          run.drag200 = { samePhoto: before === (await attribution(page)), pinMoves: moves.n };
          run.drag200.ok = run.drag200.samePhoto && moves.n === 0;
        }
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
    // At pixel density 1: the runner draws 3D without a GPU, and at 3x a frame takes seconds, which makes a
    // quick tap arrive as a long press.
    const { ctx, page, notes, cx, cy } = await open({ ...prof, ctx: { ...prof.ctx, deviceScaleFactor: 1 } }, noPhotoSpot, 18, false);
    run.notes = notes;
    try {
      if (prof.ctx.hasTouch) await touchTap(ctx, page, cx, cy, 800);
      else await page.mouse.click(cx, cy, { button: 'right' });
      await page.waitForSelector('.vc-sv-note', { timeout: 20000 });
      await page.waitForTimeout(6000);
      await page.screenshot({ path: `${OUT}/${prof.name}-6-3d.png` });
      run.note = (await page.textContent('.vc-sv-note'))?.trim();
      {
        // A 200 px drag turns the view and never moves the pin; a still tap on the ground does.
        const pinAt = () => page.getAttribute('.vc-sv-pin', 'data-at').catch(() => null);
        const facing = async () => Number(((await page.getAttribute('.vc-sv-compass', 'aria-label').catch(() => '')) ?? '').match(/facing (-?\d+)/)?.[1] ?? NaN);
        await page.waitForTimeout(3000);
        const moves = pinMoves(page);
        const at0 = await pinAt();
        const m = await page.locator('.vc-map').boundingBox();
        if (!prof.ctx.hasTouch) {
          await page.mouse.move(m.x + m.width / 2, m.y + m.height * 0.75);
          await page.waitForTimeout(500);
          run.ringOnHover = await page.locator('.vc-sv-ring').count();
        }
        await drag200(ctx, page, m, prof.ctx.hasTouch);
        await page.waitForTimeout(2500);
        // A finger held still before it drags (phone), or a right button drag (desktop): still only looking.
        if (prof.ctx.hasTouch) {
          const cdp = await ctx.newCDPSession(page);
          const x = m.x + m.width / 2 - 100, y = m.y + m.height * 0.6;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
          await page.waitForTimeout(900);
          for (let i = 1; i <= 20; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 10, y, id: 1 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await page.mouse.move(m.x + m.width / 2 - 100, m.y + m.height * 0.6);
          await page.mouse.down({ button: 'right' });
          await page.mouse.move(m.x + m.width / 2 + 100, m.y + m.height * 0.6, { steps: 20 });
          await page.mouse.up({ button: 'right' });
        }
        await page.waitForTimeout(2500);
        const at1 = await pinAt();
        run.drag200 = { pinBefore: at0, pinAfterDrag: at1, pinSame: at0 != null && at0 === at1, pinMoves: moves.n, ringAfterDrag: await page.locator('.vc-sv-ring:not(.is-tap)').count() };
        if (prof.ctx.hasTouch) await touchTap(ctx, page, m.x + m.width / 2, m.y + m.height * 0.62);
        else await page.mouse.click(m.x + m.width / 2, m.y + m.height * 0.8);
        await page.waitForTimeout(2500);
        run.drag200.tapMoves = moves.n;
        run.drag200.pinAfterTap = await pinAt();
        run.drag200.ok = run.drag200.pinSame && run.drag200.pinAfterTap !== at1;
        // Zoning on: a click (on the ground, or on a building) opens the zone's card and never moves the pin
        // or turns the view; closing the card leaves the view; a double click moves.
        await page.click('.vc-sv-bar-btn[aria-pressed]', { force: true });
        await page.waitForTimeout(4000);
        const z = { hint: (await page.textContent('.vc-sv-hint').catch(() => ''))?.trim(), clicks: [] };
        for (const fy of [0.62, 0.78]) {
          const before = { pin: await pinAt(), facing: await facing() };
          const x = m.x + m.width / 2, y = m.y + m.height * fy;
          if (prof.ctx.hasTouch) await page.touchscreen.tap(x, y);
          else await page.mouse.click(x, y);
          await page.waitForTimeout(2500);
          const card = await page.locator('.vc-map-card[data-over-sv]').count();
          const title = card ? ((await page.textContent('.vc-map-card').catch(() => '')) ?? '').trim().slice(0, 80) : null;
          if (fy === 0.62) await page.screenshot({ path: `${OUT}/${prof.name}-9-zone-card.png` });
          const after = { pin: await pinAt(), facing: await facing() };
          z.clicks.push({ at: fy, card, title, pinSame: before.pin === after.pin, facingSame: before.facing === after.facing });
          if (card) await page.click('button[aria-label="Close details"]', { force: true });
          await page.waitForTimeout(800);
          z.clicks.at(-1).afterClose = { card: await page.locator('.vc-map-card').count(), pinSame: before.pin === (await pinAt()) };
        }
        const before = await pinAt();
        const x = m.x + m.width / 2, y = m.y + m.height * 0.62;
        if (prof.ctx.hasTouch) {
          await page.touchscreen.tap(x, y);
          await page.touchscreen.tap(x, y);
        } else await page.mouse.dblclick(x, y);
        await page.waitForTimeout(4000);
        z.doubleMoves = before !== (await pinAt());
        z.ok = z.clicks.every((c) => c.card === 1 && c.pinSame && c.facingSame && c.afterClose.card === 0 && c.afterClose.pinSame) && z.doubleMoves;
        run.zoning = z;
        await page.screenshot({ path: `${OUT}/${prof.name}-9b-zone-moved.png` });
        // Back off for the steps below.
        await page.click('.vc-sv-bar-btn[aria-pressed]', { force: true });
        await page.waitForTimeout(1000);
      }
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
      await page.click('button[aria-label="Turn right"]', { force: true });
      await page.waitForTimeout(400);
      run.look.afterTurnRight = await settled();
      if (!prof.ctx.hasTouch) {
        await page.keyboard.press('a');
        await page.waitForTimeout(400);
        run.look.afterKeyA = await settled();
      }
      const note0 = await page.textContent('.vc-sv-note');
      await page.click('button[aria-label="Forward"]', { force: true });
      await page.waitForTimeout(1500);
      run.look.forwardKeeps3d = (await page.locator('.vc-sv-compass').count()) === 1;
      run.look.pinY = await pinY();
      await page.screenshot({ path: `${OUT}/${prof.name}-7-3d-turned.png` });
      await page.click('.vc-sv-compass', { force: true });
      await page.waitForTimeout(400);
      run.look.afterCompassTap = await settled();
      // Face east toward the Wasatch and look up near eye level: terrain, sky and clouds.
      for (let i = 0; i < 3; i++) {
        await page.click('button[aria-label="Turn right"]', { force: true });
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
// The split view at a laptop size and the full screen photo on a phone, on Geneva Road: no two controls
// overlap, no small map beside the map (the map shows the person and cone), and on the phone the small map
// shows imagery, not an empty dark box.
const GENEVA = [-111.7339, 40.2985];
for (const prof of [
  { name: 'split-1270x580', ctx: { viewport: { width: 1270, height: 580 } } },
  { name: 'phone-390x844', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
]) {
  const run = { tag: `geneva-${prof.name}`, notes: [] };
  log.runs.push(run);
  const { ctx, page, notes, cx, cy } = await open(prof, GENEVA, 18, false);
  run.notes = notes;
  try {
    if (prof.ctx.hasTouch) await touchTap(ctx, page, cx, cy, 800);
    else await page.mouse.click(cx, cy, { button: 'right' });
    await page.waitForSelector('.vc-svp', { timeout: 25000 });
    await page.waitForSelector('.vc-svp .mapillary-attribution-container', { timeout: 25000 }).catch(() => notes.push('photo slow'));
    await page.waitForTimeout(6000);
    run.overlaps = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
    run.miniMaps = await page.locator('.vc-svp-mini').count();
    const mini = await page.locator('.vc-svp-mini').boundingBox().catch(() => null);
    if (mini) {
      run.miniBox = { w: Math.round(mini.width), h: Math.round(mini.height) };
      // Share of near black pixels over the whole small map: an empty box reads close to 1.
      const shot = await page.screenshot({ clip: mini });
      const dark = await blackEdge(page, shot, true);
      run.miniDark = dark;
    }
    run.ok = !run.overlaps.length && (prof.ctx.hasTouch ? run.miniMaps === 1 && run.miniDark < 0.5 && run.miniBox.w <= 140 : run.miniMaps === 0);
    await page.screenshot({ path: `${OUT}/geneva-${prof.name}.png` });
  } catch (e) {
    run.error = redact(e).slice(0, 500);
  }
  await ctx.close();
}
await browser.close();
const text = redact(JSON.stringify(log, null, 2));
writeFileSync(`${OUT}/sv-shots.json`, text);
console.log(text);
