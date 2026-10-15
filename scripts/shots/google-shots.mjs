#!/usr/bin/env node
/**
 * The map's Google Street View mode on the live site, phone (390 px) and desktop: opens it from the Tools
 * menu on Geneva Road, waits for Google's panorama, logs any Content Security Policy refusals (with the
 * blocked host), clicks the Google map a little up the road and checks the panorama moved, then closes and
 * checks our map is back. Each run uses two of the day's Google opens. The key is never logged.
 *
 *   node scripts/shots/google-shots.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(args.pw ?? 'playwright');
const redact = (t) => String(t).replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').replace(/([?&]key=)[^&\s"']+/g, '$1[key]');
const log = { config: await (await fetch(`${BASE}/api/streetview/config`)).json().then((c) => ({ google: c.google, token: Boolean(c.token) })).catch((e) => ({ error: String(e) })), runs: [] };
const GENEVA = [-111.7339, 40.2985];

const browser = await chromium.launch();
for (const prof of [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } } },
]) {
  const run = { tag: prof.name, csp: [], notes: [] };
  log.runs.push(run);
  const ctx = await browser.newContext(prof.ctx);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
    } catch {}
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const page = await ctx.newPage();
  let scriptBeforeOpen = 0;
  let opened = false;
  page.on('request', (r) => /maps\.googleapis\.com\/maps\/api\/js/.test(r.url()) && !opened && scriptBeforeOpen++);
  page.on('console', (m) => /Google|Maps|refused|Refused|error/i.test(m.text()) && run.notes.push(redact(m.text()).slice(0, 300)));
  page.on('pageerror', (e) => run.notes.push(redact('pageerror: ' + e.message)));
  try {
    await page.goto(`${BASE}/map?lat=${GENEVA[1]}&lng=${GENEVA[0]}&z=18`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.vc-map canvas', { timeout: 40000 });
    await page.waitForTimeout(3000);
    await page.click('.vc-map-tools > button');
    run.toolItem = await page.locator('.vc-google-sv').count();
    await page.screenshot({ path: `${OUT}/${prof.name}-1-tools.png` });
    if (!run.toolItem) throw new Error('No Google Street View item in Tools');
    run.scriptBeforeOpen = scriptBeforeOpen;
    opened = true;
    await page.click('.vc-google-sv');
    await page.waitForSelector('.vc-gsv', { timeout: 15000 });
    const t0 = Date.now();
    run.panoShown = await page.waitForSelector('.vc-gsv-pano canvas, .vc-gsv-pano .widget-scene', { timeout: 30000 }).then(() => Date.now() - t0, () => null);
    await page.waitForTimeout(6000);
    run.note = (await page.textContent('.vc-gsv-note').catch(() => null)) ?? null;
    run.googleLogo = await page.locator('.vc-gsv a[href*="maps.google.com"], .vc-gsv img[alt="Google"]').count();
    await page.screenshot({ path: `${OUT}/${prof.name}-2-open.png` });
    // A click on the Google map a little north along the road: the panorama there.
    const m = await page.locator('.vc-gsv-map').boundingBox();
    const addr = async () => (await page.textContent('.vc-gsv-pano .gm-iv-address, .vc-gsv-pano [class*="address"]').catch(() => '')) ?? '';
    const before = await addr();
    await page.mouse.click(m.x + m.width / 2, m.y + m.height * 0.3);
    await page.waitForTimeout(6000);
    run.mapClick = { before: before.trim().slice(0, 80), after: (await addr()).trim().slice(0, 80) };
    await page.screenshot({ path: `${OUT}/${prof.name}-3-moved.png` });
    await page.click('button[aria-label="Close Google Street View"]');
    await page.waitForTimeout(1500);
    run.closed = (await page.locator('.vc-gsv').count()) === 0 && (await page.locator('.vc-map canvas').count()) > 0;
    await page.screenshot({ path: `${OUT}/${prof.name}-4-closed.png` });
  } catch (e) {
    run.error = redact(e).slice(0, 500);
    await page.screenshot({ path: `${OUT}/${prof.name}-failed.png` }).catch(() => undefined);
  }
  run.csp = (await page.evaluate(() => window.__csp).catch(() => [])).map(redact);
  await ctx.close();
}
await browser.close();
const text = redact(JSON.stringify(log, null, 2));
writeFileSync(`${OUT}/google-shots.json`, text);
console.log(text);
