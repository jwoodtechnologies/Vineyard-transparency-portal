#!/usr/bin/env node
/**
 * The live site's app files: a request for an /assets/ file that does not exist must be a 404 (text/plain,
 * no-store), never the app's HTML; every file the current page names must load as itself with the year-long
 * header; /map must open in a fresh browser, and in one whose copy of the map's code is bad (answered with
 * the app's HTML, as a browser that loaded mid-deploy kept it), which must recover by reloading once.
 *
 *   node scripts/shots/asset-check.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const log = {};

// 1) A missing file under /assets/.
const probe = await fetch(`${BASE}/assets/missing-${Date.now().toString(36)}.js`, { cache: 'no-store' });
log.missing = { status: probe.status, type: probe.headers.get('content-type'), cacheControl: probe.headers.get('cache-control'), html: /<html/i.test(await probe.text()) };
log.missing.ok = probe.status === 404 && /^text\/plain/.test(log.missing.type ?? '') && log.missing.cacheControl === 'no-store' && !log.missing.html;

// 2) Every file the current /map page names.
const html = await (await fetch(`${BASE}/map`, { cache: 'no-store' })).text();
const names = [...new Set([...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g)].map((m) => m[0]))];
log.files = [];
for (const n of names) {
  const r = await fetch(`${BASE}${n}`, { cache: 'no-store' });
  log.files.push({ n, status: r.status, type: r.headers.get('content-type'), cc: r.headers.get('cache-control') });
  await r.arrayBuffer();
}
log.filesOk = log.files.length > 0 && log.files.every((f) => f.status === 200 && !/text\/html/.test(f.type ?? '') && /immutable/.test(f.cc ?? ''));
log.marked = log.files.every((f) => /-c2-/.test(f.n));

// 3) /map in a fresh browser, and in one whose map code comes back as the app's HTML once.
const { chromium } = await import(args.pw ?? 'playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const bad of [false, true]) {
  const tag = bad ? 'bad-copy' : 'fresh';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: bad ? 'block' : 'allow' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => m.type() === 'error' && !/cloudflareinsights/.test(m.text()) && errors.push(m.text().slice(0, 200)));
  let poisoned = 0;
  if (bad)
    await page.route(/\/assets\/MapPage-[^/]+\.js$/, async (route) => {
      if (poisoned++ === 0) return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, body: html });
      return route.continue();
    });
  const loads = [];
  page.on('load', () => loads.push(page.url()));
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  const map = await page.waitForSelector('.vc-map canvas', { timeout: 60000 }).then(() => true, () => false);
  await page.waitForTimeout(2000);
  log[tag] = { map, errorPage: await page.locator('text=Something went wrong on this page').count(), poisonedAnswers: poisoned, loads: loads.length, url: page.url(), errors: errors.slice(0, 5) };
  await page.screenshot({ path: `${OUT}/${tag}.png` });
  await ctx.close();
}
await browser.close();
log.ok = log.missing.ok && log.filesOk && log.fresh.map && log['bad-copy'].map && !log['bad-copy'].errorPage;
writeFileSync(`${OUT}/asset-check.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
