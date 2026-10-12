#!/usr/bin/env node
/**
 * Page load timings for the portal's main pages, cold (empty cache, empty storage) and on a repeat visit,
 * on a throttled phone-like connection (default: 9 Mbps down, 170 ms round trip, CPU slowed 4x).
 *
 *   node scripts/perf/perf.mjs --base https://vineyardportal.org --out perf.json [--runs 3]
 *        [--pages /,/votes] [--net fast4g|none] [--cpu 4] [--desktop] [--chromium /path/to/chrome]
 *
 * For each page: time to header paint (FCP and the wordmark), to the page title, to content (a selector
 * for the page's data, and LCP), the number of /api/ requests, and the bytes of JavaScript transferred.
 * Medians over the runs. Third-party hosts (map tiles) are blocked so runs compare like with like.
 * Needs playwright or playwright-core (npm i --no-save playwright-core; npx playwright install chromium), or
 * --pw <path to playwright's index.mjs>.
 *
 * --map (map-perf): parcel lines on /map instead. For each zoom (--zooms 12,13,14,15), the map opens on
 * Vineyard at that zoom, Parcels is switched on, and the time until the line layer has drawn (the page's
 * "vtp-parcel-lines-<level>" mark, set on the map's next idle) is taken, with the bytes of the line set
 * over the wire and any zoom 16 tile requests (there should be none). Also "load": the same zoom opened
 * with Parcels already on (?layers=parcels), timed from navigation.
 */
import { writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'http://localhost:4173').replace(/\/+$/, '');
const RUNS = Number(args.runs ?? 3);
/** --desktop: a desktop window with no network or CPU throttling (unless --net or --cpu say otherwise). */
const DESKTOP = args.desktop === 'true';
const CPU = Number(args.cpu ?? (DESKTOP ? 1 : 4));
const NET = args.net ?? (DESKTOP ? 'none' : 'fast4g');
const OUT = args.out ?? 'perf.json';
const TIMEOUT = Number(args.timeout ?? 45000);

/** What counts as the title and as content on each page. */
const PAGES = {
  '/': { title: '.vc-hero-title, #vtp-shell .s-hero', content: '.vc-composer textarea, .vc-input' },
  '/add': { title: 'main h1, #vtp-shell .s-title', content: '.vc-add-kinds, .vc-add-form' },
  '/votes': { title: 'main h1, #vtp-shell .s-title', content: '.vc-sh-table tbody tr' },
  '/map': { title: '.vc-map-top, .vc-map-search', content: '.maplibregl-canvas' },
  '/budget': { title: 'main h1, #vtp-shell .s-title', content: '.vc-bud-hero' },
};
const THIRD_PARTY = ['*tiles.openfreemap.org*', '*s3.amazonaws.com*', '*basemap.nationalmap.gov*', '*gisaerials.utahcounty.gov*', '*facebook.com*', '*facebook.net*', '*fbcdn.net*', '*youtube.com*', '*arcgis.com*'];
const pages = (args.pages ? args.pages.split(',') : Object.keys(PAGES)).filter((p) => PAGES[p]);
const MAP = args.map === 'true';
const ZOOMS = (args.zooms ?? '12,13,14,15').split(',').map(Number);
/** The middle of Vineyard. */
const CENTER = { lat: 40.3065, lng: -111.7525 };

let chromium;
if (args.pw) ({ chromium } = await import(args.pw));
else try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('playwright-core'));
}

const probe = (sel) => `(() => {
  const marks = {};
  const want = ${JSON.stringify(sel)};
  window.__perf = { marks, fcp: null, lcp: null };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { const all = l.getEntries(); if (all.length) window.__perf.lcp = all[all.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  const seen = (s) => {
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (/^(CANVAS|TEXTAREA|INPUT|BUTTON)$/.test(el.tagName) || el.querySelector('svg') || (el.textContent || '').trim() || !/^(none|normal)$/.test(getComputedStyle(el, '::after').content))) return true;
    }
    return false;
  };
  const tick = () => {
    for (const [k, s] of Object.entries(want)) if (marks[k] == null && document.documentElement && seen(s)) marks[k] = performance.now();
    if (Object.keys(marks).length < Object.keys(want).length) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.floor((v.length - 1) / 2)]) : null;
};

async function measure(browser, path, repeat) {
  const cfg = PAGES[path];
  const ctx = await browser.newContext(DESKTOP ? { viewport: { width: 1366, height: 900 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 VineyardPerf/1.0' } : { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 VineyardPerf/1.0' });
  const origin = new URL(BASE).origin;
  await ctx.addInitScript(probe({ header: '.vc-wordmark, .vc-corners .vc-ghost, #vtp-shell .s-name, #vtp-shell .s-btn', title: cfg.title, content: cfg.content }));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  // Map tiles and other hosts are blocked (a request interceptor would turn the browser cache off, so CDP blocks them).
  await cdp.send('Network.setBlockedURLs', { urls: THIRD_PARTY });
  if (NET === 'fast4g') await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const run = async (cold) => {
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: cold });
    const types = new Map();
    const stats = { api: 0, apiUrls: [], js: 0, total: 0 };
    // Served from the browser's own cache: nothing transferred.
    const onResp = (e) => types.set(e.requestId, e.response.fromDiskCache || e.response.fromMemoryCache || e.response.fromPrefetchCache ? 'cached' : e.type);
    const onReq = (e) => {
      const u = new URL(e.request.url);
      if (u.origin === origin && u.pathname.startsWith('/api/') && e.request.method === 'GET') {
        stats.api++;
        stats.apiUrls.push(`${u.pathname}${u.search}`.replace(/[?&]_=\d+/, ''));
      }
    };
    const onDone = (e) => {
      if (types.get(e.requestId) === 'cached') return;
      stats.total += e.encodedDataLength;
      if (types.get(e.requestId) === 'Script') stats.js += e.encodedDataLength;
    };
    cdp.on('Network.responseReceived', onResp);
    cdp.on('Network.requestWillBeSent', onReq);
    cdp.on('Network.loadingFinished', onDone);
    await page.goto(`${BASE}${path}`, { waitUntil: 'commit', timeout: TIMEOUT });
    await page.waitForFunction(() => window.__perf && window.__perf.marks.content != null, null, { timeout: TIMEOUT, polling: 100 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    const p = await page.evaluate(() => window.__perf);
    cdp.off('Network.responseReceived', onResp);
    cdp.off('Network.requestWillBeSent', onReq);
    cdp.off('Network.loadingFinished', onDone);
    // Nothing is on screen before the first paint: a mark seen in the DOM earlier counts from the first paint.
    const painted = (t) => (t == null ? null : Math.round(Math.max(t, p.fcp ?? 0)));
    return { fcp: p.fcp == null ? null : Math.round(p.fcp), header: painted(p.marks.header), title: painted(p.marks.title), content: painted(p.marks.content), lcp: p.lcp == null ? null : Math.round(p.lcp), api: stats.api, apiUrls: stats.apiUrls, jsKB: Math.round(stats.js / 1024), totalKB: Math.round(stats.total / 1024) };
  };
  // Repeat: a first visit with the cache on (what a returning reader has), then the measured visit.
  let out = await run(!repeat);
  if (repeat) out = await run(false);
  await ctx.close();
  return out;
}

/** One map-perf run at a zoom: toggle (switch Parcels on after the map is up) or load (on from the start). */
async function measureMap(browser, zoom, mode) {
  const ctx = await browser.newContext(DESKTOP ? { viewport: { width: 1366, height: 900 } } : { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 VineyardPerf/1.0' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: THIRD_PARTY });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (NET === 'fast4g') await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const urls = new Map();
  const net = { linesBytes: 0, linesUrls: [], tiles16: 0 };
  cdp.on('Network.requestWillBeSent', (e) => {
    const u = new URL(e.request.url);
    if (u.pathname === '/api/map/parcel-lines') urls.set(e.requestId, `${u.pathname}${u.search}`);
    if (u.pathname.startsWith('/api/map/parcels/16/')) net.tiles16++;
  });
  cdp.on('Network.loadingFinished', (e) => {
    if (!urls.has(e.requestId)) return;
    net.linesBytes += e.encodedDataLength;
    net.linesUrls.push(urls.get(e.requestId));
  });
  const level = zoom >= 14 ? 'mid' : 'low';
  const q = `lat=${CENTER.lat}&lng=${CENTER.lng}&z=${zoom}`;
  await page.goto(`${BASE}/map?${q}${mode === 'load' ? '&layers=parcels' : ''}`, { waitUntil: 'commit', timeout: TIMEOUT });
  let start = 0;
  if (mode === 'toggle') {
    await page.waitForSelector('.maplibregl-canvas', { timeout: TIMEOUT });
    await page.waitForTimeout(2500); // the map and the layer list settle first
    if (!(await page.locator('.vc-map-panel').count())) await page.click('.vc-map-fab');
    const box = page.locator('label.vc-map-layer', { hasText: 'Parcels' }).locator('input');
    await box.waitFor({ timeout: TIMEOUT });
    start = await box.evaluate((el) => {
      const t = performance.now();
      el.click();
      return t;
    });
  }
  const mark = `vtp-parcel-lines-${level}`;
  await page.waitForFunction((m) => performance.getEntriesByName(m).length > 0, mark, { timeout: TIMEOUT, polling: 50 });
  const drawn = await page.evaluate((m) => performance.getEntriesByName(m)[0].startTime, mark);
  await page.waitForTimeout(500);
  await ctx.close();
  return { zoom, mode, level, ms: Math.round(drawn - start), linesKB: Math.round(net.linesBytes / 102.4) / 10, linesUrls: net.linesUrls, tiles16: net.tiles16 };
}

const browser = await chromium.launch({ executablePath: args.chromium || undefined, args: ['--no-sandbox'] });
const results = {};
if (MAP) {
  for (const zoom of ZOOMS) {
    for (const mode of ['toggle', 'load']) {
      const runs = [];
      for (let i = 0; i < RUNS; i++) runs.push(await measureMap(browser, zoom, mode).catch((e) => ({ error: String(e).slice(0, 200) })));
      const ok = runs.filter((r) => !r.error);
      const r = { ms: median(ok.map((x) => x.ms)), linesKB: ok[0]?.linesKB ?? null, linesUrls: ok[0]?.linesUrls ?? [], tiles16: ok[0]?.tiles16 ?? null, runs: ok.map((x) => x.ms), errors: runs.filter((x) => x.error).map((x) => x.error) };
      results[`z${zoom}-${mode}`] = r;
      console.log(`map z${zoom} ${mode.padEnd(6)} lines drawn ${r.ms} ms (runs ${r.runs.join(', ')})  set ${r.linesKB} KB over the wire  ${r.linesUrls.join(' ')}  z16 tiles ${r.tiles16}${r.errors.length ? `  errors ${r.errors.join(' | ')}` : ''}`);
    }
  }
}
for (const path of MAP ? [] : pages) {
  results[path] = {};
  for (const kind of ['cold', 'repeat']) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, path, kind === 'repeat').catch((e) => ({ error: String(e).slice(0, 200) })));
    const ok = runs.filter((r) => !r.error);
    const pick = (k) => median(ok.map((r) => (r[k] == null ? null : Math.round(r[k]))));
    results[path][kind] = { fcp: pick('fcp'), header: pick('header'), title: pick('title'), content: pick('content'), lcp: pick('lcp'), api: pick('api'), jsKB: pick('jsKB'), totalKB: pick('totalKB'), apiUrls: ok[0]?.apiUrls ?? [], errors: runs.filter((r) => r.error).map((r) => r.error) };
    const r = results[path][kind];
    console.log(`${path.padEnd(14)} ${kind.padEnd(6)} fcp ${r.fcp}  header ${r.header}  title ${r.title}  content ${r.content}  lcp ${r.lcp}  api ${r.api}  js ${r.jsKB} KB`);
  }
}
await browser.close();
writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), mode: MAP ? 'map-perf' : 'pages', desktop: DESKTOP, net: NET, cpu: CPU, runs: RUNS, results }, null, 2));
console.log(`wrote ${OUT}`);
