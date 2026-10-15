#!/usr/bin/env node
/**
 * The 3D view's houses on the live site, at street view near 40.3035,-111.7455 (a phone, 390 x 844): the
 * buildings OpenFreeMap's tiles hold there (footprint area and the zoom of the tile each came from), the ones
 * the raised layer draws with recorded heights, and screenshots with only the map's own buildings and only
 * the raised layer, so a house drawn as a slab can be traced to where its shape came from.
 *
 *   node scripts/shots/bld-check.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
// On the road just east of Waters Edge (the reviewer's view): the map is opened here and the pin dropped at its middle.
const AT = [-111.7451, 40.3036];
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(args.pw ?? 'playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('vtp:mapbase', 'satellite');
    localStorage.setItem('vtp:debug', '1');
  } catch {}
});
const page = await ctx.newPage();
const log = { at: AT, notes: [] };
page.on('pageerror', (e) => log.notes.push(e.message.slice(0, 200)));
try {
  await page.goto(`${BASE}/map?lat=${AT[1]}&lng=${AT[0]}&z=17`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vc-map canvas', { timeout: 40000 });
  await page.waitForTimeout(3000);
  await page.tap('.vc-map-tools > button');
  await page.waitForSelector('.vc-pegman:not([disabled])', { timeout: 40000 });
  await page.tap('.vc-pegman');
  await page.waitForTimeout(2500);
  const m = await page.locator('.vc-map').boundingBox();
  await page.touchscreen.tap(m.x + m.width / 2, m.y + m.height / 2);
  log.mode = await Promise.race([
    page.waitForSelector('.vc-sv-compass', { timeout: 60000 }).then(() => '3d'),
    page.waitForSelector('.vc-svp', { timeout: 60000 }).then(() => 'photo'),
  ]).catch(() => 'none');
  if (log.mode === 'photo') {
    // A photo opened: close it and drop the pin on the map again is not possible on a phone; note it.
    log.notes.push('a street photo opened; the 3D view needs a spot without photos');
  }
  await page.waitForTimeout(20000);
  await page.screenshot({ path: `${OUT}/bld-1-as-shown.png`, timeout: 120000 }).catch(() => undefined);
  // Turned toward the houses (west), at eye level, with time for them to draw.
  for (let i = 0; i < 3; i++) {
    await page.tap('button[aria-label="Turn left"]').catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(30000);
  log.facingWest = await page.getAttribute('.vc-sv-compass', 'aria-label').catch(() => null);
  await page.screenshot({ path: `${OUT}/bld-1b-toward-houses.png`, timeout: 120000 }).catch(() => undefined);
  log.data = await page.evaluate(() => {
    const m = window.__vtpMap;
    if (!m) return null;
    // Around the street view pin (the camera stands there; the map's center is far ahead at this tilt).
    const at = (document.querySelector('.vc-sv-pin')?.getAttribute('data-at') ?? '').split(',').map(Number);
    const c = at.length === 2 && at.every(Number.isFinite) ? { lng: at[0], lat: at[1] } : m.getCenter();
    const kx = 111320 * Math.cos((c.lat * Math.PI) / 180);
    const area = (ring) => {
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * kx + ring[i][0] * kx) * (ring[j][1] * 110540 - ring[i][1] * 110540);
      return Math.abs(a / 2);
    };
    const near = (ring) => ring.some(([x, y]) => Math.abs(x - c.lng) * kx < 80 && Math.abs(y - c.lat) * 110540 < 80);
    const out = { zoom: m.getZoom(), pin: [c.lng, c.lat], layers: {}, overPin: [] };
    // Every building shape that covers the pin itself (the camera stands there).
    const inRing = (p, r) => {
      let ins = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins;
      return ins;
    };
    for (const id of ['vtp-sv-buildings', 'vtp-sv-buildings-h']) {
      const l = m.getLayer(id);
      if (!l) continue;
      for (const f of m.querySourceFeatures(l.source, l.sourceLayer ? { sourceLayer: l.sourceLayer } : undefined)) {
        const g = f.geometry;
        const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
        for (const r of rings)
          if (inRing([c.lng, c.lat], r)) {
            const xs = r.map((p) => p[0] * kx), ys = r.map((p) => p[1] * 110540);
            out.overPin.push({ id, z: f._z ?? null, m2: Math.round(area(r)), w: Math.round(Math.max(...xs) - Math.min(...xs)), l: Math.round(Math.max(...ys) - Math.min(...ys)), pts: r.length, props: JSON.stringify(f.properties).slice(0, 160), ring: r.slice(0, 12).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]) });
          }
      }
    }
    for (const id of ['vtp-sv-buildings', 'vtp-sv-buildings-h']) {
      const l = m.getLayer(id);
      if (!l) continue;
      const feats = m.querySourceFeatures(l.source, l.sourceLayer ? { sourceLayer: l.sourceLayer } : undefined);
      const rows = [];
      for (const f of feats) {
        const g = f.geometry;
        const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
        for (const r of rings)
          if (near(r)) {
            const xs = r.map((p) => p[0] * kx), ys = r.map((p) => p[1] * 110540);
            rows.push({ z: f._z ?? null, m2: Math.round(area(r)), w: Math.round(Math.max(...xs) - Math.min(...xs)), l: Math.round(Math.max(...ys) - Math.min(...ys)), pts: r.length, h: f.properties?.h ?? f.properties?.render_height ?? null, id: f.id ?? null });
          }
      }
      rows.sort((a, b) => b.m2 - a.m2);
      const zs = {};
      for (const r of rows) zs[r.z] = (zs[r.z] ?? 0) + 1;
      out.layers[id] = { source: l.source, opacity: m.getPaintProperty(id, 'fill-extrusion-opacity'), visibility: m.getLayoutProperty(id, 'visibility') ?? 'visible', near: rows.length, byTileZoom: zs, largest: rows.slice(0, 12), median: rows.length ? rows[Math.floor(rows.length / 2)].m2 : null };
    }
    return out;
  });
  // Straight down over the pin: the footprints against the roofs in the aerial photo.
  await page.evaluate(() => {
    const m = window.__vtpMap;
    const at = (document.querySelector('.vc-sv-pin')?.getAttribute('data-at') ?? '').split(',').map(Number);
    if (at.length === 2) m.jumpTo({ center: at, zoom: 18.6, pitch: 0, bearing: 0 });
    if (m.getLayer('vtp-sv-buildings-h')) m.setPaintProperty('vtp-sv-buildings-h', 'fill-extrusion-opacity', 0.45);
  });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: `${OUT}/bld-0-top-down.png`, timeout: 120000 }).catch(() => undefined);
  await page.evaluate(() => window.__vtpMap.setPaintProperty('vtp-sv-buildings-h', 'fill-extrusion-opacity', 0.92));
  // Only the map's own buildings (OpenFreeMap's shapes, plain heights), then only the raised layer.
  await page.evaluate(() => {
    const m = window.__vtpMap;
    if (m.getLayer('vtp-sv-buildings-h')) m.setLayoutProperty('vtp-sv-buildings-h', 'visibility', 'none');
    if (m.getLayer('vtp-sv-buildings')) m.setPaintProperty('vtp-sv-buildings', 'fill-extrusion-opacity', 0.92);
  });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${OUT}/bld-2-map-own.png`, timeout: 120000 }).catch(() => undefined);
  await page.evaluate(() => {
    const m = window.__vtpMap;
    if (m.getLayer('vtp-sv-buildings-h')) m.setLayoutProperty('vtp-sv-buildings-h', 'visibility', 'visible');
    if (m.getLayer('vtp-sv-buildings')) m.setPaintProperty('vtp-sv-buildings', 'fill-extrusion-opacity', 0);
  });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${OUT}/bld-3-raised.png`, timeout: 120000 }).catch(() => undefined);
} catch (e) {
  log.error = String(e).slice(0, 300);
  await page.screenshot({ path: `${OUT}/bld-failed.png` }).catch(() => undefined);
}
await browser.close();
writeFileSync(`${OUT}/bld-check.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
