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
    const r = await fetch(`https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,computed_geometry,is_pano&bbox=${bbox}&limit=50`);
    const list = (await r.json()).data ?? [];
    const pick = list.find((x) => x.is_pano) ?? list[0];
    if (pick) {
      const [lng, lat] = pick.computed_geometry.coordinates;
      photoSpot = [lng, lat + 0.00012]; // about 13 m north of the photo
      log.spots.photo = { bbox, image: pick.id, pano: pick.is_pano, pin: photoSpot, found: list.length };
      break;
    }
  }
}
const noPhotoSpot = [-111.7652, 40.2905]; // the lake shore west of the homes
log.spots.none = noPhotoSpot;

const browser = await chromium.launch();
const PROFILES = [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } } },
];
for (const prof of PROFILES) {
  for (const [kind, spot] of [['photo', photoSpot], ['3d', noPhotoSpot]]) {
    if (!spot) continue;
    for (const dark of kind === 'photo' ? [false, true] : [false]) {
      const ctx = await browser.newContext({ ...prof.ctx, colorScheme: dark ? 'dark' : 'light' });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('vtp:mapbase', 'satellite');
        } catch {}
      });
      const page = await ctx.newPage();
      const notes = [];
      page.on('console', (m) => /Content Security Policy|Refused to/.test(m.text()) && notes.push(redact(m.text()).slice(0, 300)));
      page.on('pageerror', (e) => notes.push(redact('pageerror: ' + e.message)));
      const tag = `${prof.name}-${kind}${dark ? '-dark' : ''}`;
      try {
        await page.goto(`${BASE}/map?lat=${spot[1]}&lng=${spot[0]}&z=18`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.vc-map canvas', { timeout: 20000 });
        await page.waitForTimeout(3000);
        const box = await page.locator('.vc-map').boundingBox();
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        if (prof.ctx.hasTouch) {
          const cdp = await ctx.newCDPSession(page);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
          await page.waitForTimeout(800);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await page.mouse.click(cx, cy, { button: 'right' });
        if (kind === 'photo') {
          await page.waitForSelector('.vc-svp', { timeout: 20000 });
          await page.waitForTimeout(9000);
          await page.screenshot({ path: `${OUT}/${tag}.png` });
          if (!dark) {
            await page.click('.vc-svp button[aria-pressed]');
            await page.waitForTimeout(1500);
            await page.screenshot({ path: `${OUT}/${tag}-nozoning.png` });
            await page.click('.vc-svp button[aria-pressed]');
          }
          log.runs.push({ tag, chips: await page.locator('.vc-svp-chip').allTextContents(), bar: redact((await page.textContent('.vc-svp'))?.replace(/\s+/g, ' ') ?? '').slice(0, 300), notes });
        } else {
          await page.waitForSelector('.vc-sv-note', { timeout: 20000 });
          await page.waitForTimeout(6000);
          await page.screenshot({ path: `${OUT}/${tag}.png` });
          log.runs.push({ tag, note: (await page.textContent('.vc-sv-note'))?.trim(), notes });
        }
      } catch (e) {
        await page.screenshot({ path: `${OUT}/${tag}-failed.png` }).catch(() => undefined);
        log.runs.push({ tag, error: redact(e).slice(0, 500), notes });
      }
      await ctx.close();
    }
  }
}
await browser.close();
const text = redact(JSON.stringify(log, null, 2));
writeFileSync(`${OUT}/sv-shots.json`, text);
console.log(text);
