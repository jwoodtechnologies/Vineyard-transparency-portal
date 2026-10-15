#!/usr/bin/env node
/**
 * The satellite map with the service worker, on the live site (desktop 1270x580 and phone 390): a fresh
 * profile, and a profile that first had the old worker (vtp-tiles-v3, served here from sw-old-v3.js, the
 * version that answered aerial photos itself) and then reloads onto the current one. For each: whether the
 * county aerial requests reach the network (not answered by the worker) and succeed, how dark the map is,
 * which caches exist, and which worker is in charge. Also the street view config and the Tools menu items.
 *
 *   node scripts/shots/sw-check.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(args.pw ?? 'playwright');
const OLD = readFileSync(new URL('./sw-old-v3.js', import.meta.url), 'utf8');
const log = { config: await (await fetch(`${BASE}/api/streetview/config`)).json().then((c) => ({ google: c.google, token: Boolean(c.token) })).catch((e) => String(e)), runs: [] };
const browser = await chromium.launch();

/** Share of near black pixels over the map. */
const dark = (page, png) =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 60) n++;
    return Math.round((n / (d.length / 16)) * 100) / 100;
  }, png.toString('base64'));

async function visit(ctx, tag) {
  const page = await ctx.newPage();
  const run = { tag, county: { ok: 0, bad: 0, fromSw: 0, statuses: {} } };
  page.on('response', (r) => {
    if (!/gisaerials\.utahcounty\.gov/.test(r.url())) return;
    const s = r.status();
    run.county.statuses[s] = (run.county.statuses[s] ?? 0) + 1;
    if (r.fromServiceWorker()) run.county.fromSw++;
    if (s === 200) run.county.ok++;
    else run.county.bad++;
  });
  page.on('requestfailed', (r) => /gisaerials/.test(r.url()) && (run.county.failed = (run.county.failed ?? 0) + 1));
  const t0 = Date.now();
  await page.goto(`${BASE}/map?lat=40.3035&lng=-111.7455&z=16`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.vc-map canvas') && !document.querySelector('.vc-map-loading'), null, { timeout: 40000 }).catch(() => undefined);
  run.paintedMs = Date.now() - t0;
  await page.waitForTimeout(6000);
  const box = await page.locator('.vc-map').boundingBox();
  const shot = await page.screenshot({ clip: box });
  run.darkShare = await dark(page, shot);
  await page.screenshot({ path: `${OUT}/${tag}.png` });
  run.worker = await page.evaluate(async () => {
    const r = await navigator.serviceWorker?.getRegistration();
    const url = r?.active?.scriptURL ?? null;
    const body = url ? await (await fetch(url, { cache: 'no-store' })).text() : '';
    return { controlled: Boolean(navigator.serviceWorker?.controller), cacheName: (body.match(/const CACHE = '([^']+)'/) ?? [])[1] ?? null, caches: await caches.keys() };
  });
  await page.click('.vc-map-tools > button').catch(() => undefined);
  await page.waitForTimeout(500);
  run.tools = await page.locator('.vc-map-tools-menu [role^="menuitem"]').allTextContents().catch(() => []);
  await page.close();
  return run;
}

for (const prof of [
  { name: 'desktop', ctx: { viewport: { width: 1270, height: 580 } } },
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
]) {
  const init = () => {
    try {
      localStorage.setItem('vtp:mapbase', 'satellite');
    } catch {}
  };
  // Fresh profile: twice (the second load is controlled by the worker).
  {
    const ctx = await browser.newContext({ ...prof.ctx, serviceWorkers: 'allow' });
    await ctx.addInitScript(init);
    log.runs.push(await visit(ctx, `${prof.name}-fresh-1`));
    log.runs.push(await visit(ctx, `${prof.name}-fresh-2`));
    await ctx.close();
  }
  // An existing visitor with the old worker, then the current one.
  {
    const ctx = await browser.newContext({ ...prof.ctx, serviceWorkers: 'allow' });
    await ctx.addInitScript(init);
    await ctx.route(/\/sw\.js$/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'cache-control': 'no-cache' }, body: OLD }));
    log.runs.push(await visit(ctx, `${prof.name}-old-1`));
    log.runs.push(await visit(ctx, `${prof.name}-old-2`));
    await ctx.unroute(/\/sw\.js$/);
    log.runs.push(await visit(ctx, `${prof.name}-updated-1`));
    log.runs.push(await visit(ctx, `${prof.name}-updated-2`));
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/sw-check.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
