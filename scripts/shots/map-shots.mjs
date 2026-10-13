#!/usr/bin/env node
/**
 * Screenshots of the live map's tools for review, at phone width (390 px) and on a desktop window, with
 * the satellite base map. Each case opens a ?m= link (the Measure tool reopens the shape exactly), waits
 * for the imagery, opens the details and saves a PNG. Then the layout check (layout.mjs): every state of
 * the map at 390x844, 660x572 and 1440x900, light and dark, saved as layout-*.png, with overlaps.json
 * listing any two controls that overlap (the workflow fails the run when it is not empty).
 *
 *   node scripts/shots/map-shots.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
 *
 * Needs Node 24 (it reads the link encoder from src/console/measure/shape.ts as is).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeShape } from '../../src/console/measure/shape.ts';
import { runLayout } from './layout.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const OUT = args.out ?? 'shots';
mkdirSync(OUT, { recursive: true });
const { chromium } = await import(args.pw ?? 'playwright');

const CASES = [
  { name: 'distance', shape: { mode: 'distance', closed: false, pts: [[-111.74752, 40.30442], [-111.74530, 40.30433], [-111.74447, 40.30496], [-111.74553, 40.30636]] }, profile: true },
  { name: 'area', shape: { mode: 'area', closed: false, pts: [[-111.74034, 40.30031], [-111.73840, 40.29775], [-111.73704, 40.29822], [-111.73737, 40.30034]] } },
  { name: 'circle', shape: { mode: 'circle', closed: false, pts: [[-111.7445, 40.3050], [-111.7435, 40.3055]] } },
  { name: 'parcel', shape: { mode: 'parcel', closed: false, pts: [[-111.7387, 40.2989]] } },
];
const PROFILES = [
  { name: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } } },
];

const log = [];
const browser = await chromium.launch();
for (const prof of PROFILES) {
  for (const dark of [false, true]) {
    const ctx = await browser.newContext({ ...prof.ctx, colorScheme: dark ? 'dark' : 'light' });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('vtp:mapbase', 'satellite');
      } catch {}
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const c of dark ? CASES.slice(0, 1) : CASES) {
      const url = `${BASE}/map?m=${encodeURIComponent(encodeShape(c.shape))}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.vc-measure', { timeout: 20000 });
        await page.waitForTimeout(5000);
        await page.click('.vc-measure-more, .vc-measure-grip');
        if (c.profile) {
          await page.click('.vc-measure-pill');
          await page.waitForSelector('.vc-measure-chart', { timeout: 45000 }).catch(() => errors.push('no elevation chart'));
        }
        await page.waitForTimeout(1500);
        const file = `${prof.name}-${c.name}${dark ? '-dark' : ''}.png`;
        await page.screenshot({ path: `${OUT}/${file}` });
        const text = (await page.textContent('.vc-measure'))?.replace(/\s+/g, ' ').trim();
        log.push({ file, url, text, errors: [...errors] });
      } catch (e) {
        log.push({ case: c.name, profile: prof.name, dark, url, error: String(e) });
      }
      errors.length = 0;
    }
    await ctx.close();
  }
}
// The layout check: every state of /map at three sizes, light and dark, with no two controls overlapping.
const layout = await runLayout({ browser, base: BASE, out: OUT });
await browser.close();
writeFileSync(`${OUT}/shots.json`, JSON.stringify(log, null, 2));
writeFileSync(`${OUT}/layout.json`, JSON.stringify(layout.results, null, 2));
// The workflow fails the run when this list is not empty (any overlap, or a state that could not be reached).
writeFileSync(`${OUT}/overlaps.json`, JSON.stringify(layout.failures, null, 2));
console.log(JSON.stringify(log, null, 2));
console.log(`layout: ${layout.results.length} checked, ${layout.failures.length} with overlaps or errors`);
for (const f of layout.failures) console.log(f.file, f.error ?? '', JSON.stringify((f.overlaps ?? []).map((o) => `${o.a} x ${o.b}`)));
