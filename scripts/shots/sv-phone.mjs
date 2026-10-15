#!/usr/bin/env node
/**
 * Street view on a phone (390 x 844, touch) on the live site, the way a reviewer uses it: open street view
 * at a capital project, open Tools (screenshot and overlap check in that state), turn layers on from Tools and
 * from the bar's Layers button, then tap a project and a zone with a finger and check that each opens its
 * card without moving the pin or turning the view. Also lists what sits along the right edge near Tools, and
 * the bar's button labels.
 *
 *   node scripts/shots/sv-phone.mjs --base https://vineyardportal.org --out shots --pw <playwright index.mjs>
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
const redact = (t) => String(t).replace(/MLY(\||%7C)[^&\s"'<>]+/gi, '[token]').replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]');
const log = { steps: [] };
const step = (name, data = {}) => log.steps.push({ name, ...data });

// A capital project to stand in: the largest one, at a point inside its outline.
const inRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
let project = null;
try {
  const fc = await (await fetch(`${BASE}/api/map/layers/projects?page=0`)).json();
  const rings = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) rings.push({ ring: poly[0], name: f.properties?.Project_Name ?? '' });
  }
  const area = (r) => Math.abs(r.reduce((a, [x, y], i) => a + x * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * y, 0));
  rings.sort((a, b) => area(b.ring) - area(a.ring));
  for (const { ring, name } of rings) {
    const c = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
    const pt = inRing(c, ring) ? c : ring.map((v, i) => [(v[0] + ring[(i + 2) % ring.length][0]) / 2, (v[1] + ring[(i + 2) % ring.length][1]) / 2]).find((m) => inRing(m, ring));
    if (pt) {
      project = { name, at: pt, ring };
      break;
    }
  }
  log.project = project ? { name: project.name, at: project.at.map((v) => +v.toFixed(6)) } : { none: fc.features?.length ?? 0 };
} catch (e) {
  log.project = { error: redact(e).slice(0, 200) };
}

// SwiftShader through ANGLE's GL backend: the runner's default Vulkan backend left the 3D view blank.
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('vtp:mapbase', 'satellite');
    localStorage.setItem('vtp:debug', '1');
  } catch {}
});
const page = await ctx.newPage();
const notes = [];
page.on('console', (m) => /Content Security Policy|Refused to|Error/.test(m.text()) && !/cloudflareinsights/.test(m.text()) && notes.push(redact(m.text()).slice(0, 240)));
page.on('pageerror', (e) => notes.push(redact('pageerror: ' + e.message).slice(0, 240)));
log.notes = notes;
const cdp = await ctx.newCDPSession(page);
/** A real finger tap (touch events, as on an iPhone). */
const tap = async (x, y) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const tapEl = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`not shown: ${sel}`);
  await tap(b.x + b.width / 2, b.y + b.height / 2);
};
const shot = (n) => page.screenshot({ path: `${OUT}/phone-${n}.png`, timeout: 120000 }).catch((e) => step(`shot ${n} slow`, { e: String(e).slice(0, 80) }));
const pinAt = () => page.locator('.vc-sv-pin, .vc-svp').first().getAttribute('data-at').catch(() => null);
const facing = async () => Number(((await page.getAttribute('.vc-sv-compass', 'aria-label').catch(() => '')) ?? '').match(/facing (-?\d+)/)?.[1] ?? NaN);
/** What the topmost element is at the middle of `sel`: is it really tappable there? */
const onTop = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top && (el === top || el.contains(top)) ? 'yes' : `covered by ${top?.className || top?.tagName}`;
  }, sel);
/** Turns a layer on or off in the open Layers panel by its label, with a tap, then closes the panel. */
const layer = async (label, on) => {
  await page.waitForSelector('.vc-map-panel .vc-map-layer', { timeout: 30000 });
  const row = page.locator('.vc-map-panel .vc-map-layer', { hasText: label }).first();
  await row.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = row.locator('input[type=checkbox]');
  if ((await box.isChecked()) !== on) {
    const b = await row.boundingBox();
    await tap(b.x + b.width - 30, b.y + b.height / 2);
    await page.waitForTimeout(600);
  }
  const done = await box.isChecked();
  await tapEl('.vc-map-panel button[aria-label="Close layers"]');
  await page.waitForTimeout(800);
  return done === on;
};

try {
  // The pin stands about 70 m south of the project, so the project is ahead of it (the view starts facing north).
  const at = project ? [project.at[0], project.at[1] - 70 / 111320] : [-111.7455, 40.3035];
  await page.goto(`${BASE}/map?lat=${at[1]}&lng=${at[0]}&z=18`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.vc-map canvas', { timeout: 40000 });
  await page.waitForFunction(() => !document.querySelector('.vc-map-loading'), null, { timeout: 40000 }).catch(() => step('map loading slow'));
  await page.waitForTimeout(3000);
  // Street view from Tools, then a finger tap where the project is (the middle of the map).
  await tapEl('.vc-map-tools > button');
  await page.waitForSelector('.vc-pegman:not([disabled])', { timeout: 40000 });
  await tapEl('.vc-pegman');
  await page.waitForTimeout(2500);
  const m = await page.locator('.vc-map').boundingBox();
  await tap(m.x + m.width / 2, m.y + m.height / 2);
  const mode = await Promise.race([
    page.waitForSelector('.vc-sv-compass', { timeout: 60000 }).then(() => '3d'),
    page.waitForSelector('.vc-svp', { timeout: 60000 }).then(() => 'photo'),
  ]).catch(() => 'none');
  await page.waitForTimeout(12000);
  step('street view', { mode, bar: (await page.locator('.vc-sv-bar-btn').allTextContents()).map((t) => t.trim()) });
  await shot('1-street-view');

  // Tools open over street view: the menu on top, Layers tappable, the hint hidden, nothing overlapping.
  await tapEl('.vc-map-tools > button');
  await page.waitForTimeout(1200);
  const hintShown = await page.locator('.vc-sv-hint').first().isVisible().catch(() => false);
  const ov = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
  // The menu is meant to open over the bar; anything else touching it is a problem.
  const bad = ov.filter((o) => !/^\.vc-map-tools-menu x \.vc-sv-note$|^\.vc-sv-note x \.vc-map-tools-menu$/.test(o));
  step('tools open', { layersOnTop: await onTop('.vc-map-tools-menu [role^="menuitem"]'), hintShown, overlaps: ov, problems: bad });
  await shot('2-tools-open');
  // What sits along the right edge from the top of the map to below Tools (a side tab would show here).
  log.rightEdge = await page.evaluate(() => {
    const out = [];
    for (let y = 70; y <= 420; y += 25) {
      const el = document.elementFromPoint(innerWidth - 3, y);
      out.push(`${y}: ${el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}` : '-'}`);
    }
    return out;
  });

  // Layers from the Tools menu: the panel opens as a sheet; Capital projects on.
  await tapEl('.vc-map-tools-menu [role^="menuitem"]');
  await page.waitForTimeout(1500);
  await shot('3-layers-sheet');
  step('layers from tools', { panel: await page.locator('.vc-map-panel').isVisible(), projectsOn: await layer('Capital projects', true) });
  await page.waitForTimeout(5000);

  // A finger tap on the project: its card, the pin and view unchanged.
  const tapProject = async (tag) => {
    const before = { pin: await pinAt(), facing: await facing() };
    let point = null;
    if (project)
      point = await page.evaluate(([lng, lat]) => {
        const m = window.__vtpMap;
        if (!m) return null;
        const p = m.project({ lng, lat });
        const c = m.getContainer().getBoundingClientRect();
        return { x: c.left + p.x, y: c.top + p.y, inView: p.x > 10 && p.y > 120 && p.x < c.width - 70 && p.y < c.height - 60 };
      }, project.at);
    const mb = await page.locator('.vc-map').boundingBox();
    // Never on the pin itself (it would take the tap): clear of it by 60 px.
    const pin = await page.locator('.vc-sv-pin').boundingBox().catch(() => null);
    const clear = (p) => !pin || Math.hypot(p.x - (pin.x + pin.width / 2), p.y - (pin.y + pin.height / 2)) > 60;
    const tp = point?.inView && clear(point) ? point : { x: mb.x + mb.width / 2, y: mb.y + mb.height * 0.78 };
    await tap(tp.x, tp.y);
    await page.waitForTimeout(3000);
    const card = page.locator('.vc-map-card[data-over-sv]');
    const r = {
      tappedAt: [Math.round(tp.x), Math.round(tp.y)],
      projected: Boolean(point?.inView),
      card: await card.count(),
      title: (await card.locator('.vc-map-card-title').textContent().catch(() => null))?.trim() ?? null,
      kind: (await card.locator('.vc-map-kind').textContent().catch(() => null))?.trim() ?? null,
      cardBox: await card.boundingBox().catch(() => null),
      pinSame: before.pin === (await pinAt()),
      facingSame: Number.isNaN(before.facing) || before.facing === (await facing()),
    };
    await shot(tag);
    if (r.card) await tapEl('button[aria-label="Close details"]').catch(() => undefined);
    await page.waitForTimeout(1000);
    return r;
  };
  log.projectTap = await tapProject('4-project-card');
  step('project tap', log.projectTap);

  // Layers from the bar this time: Zoning on, a tap on the ground opens the zone's card.
  await tapEl('.vc-sv-bar-btn[aria-pressed]');
  await page.waitForTimeout(1200);
  step('layers from bar', { panel: await page.locator('.vc-map-panel').isVisible(), zoningOn: await layer('Zoning', true), projectsOff: true });
  await tapEl('.vc-sv-bar-btn[aria-pressed]');
  await layer('Capital projects', false);
  await page.waitForTimeout(4000);
  const mb = await page.locator('.vc-map').boundingBox();
  const before = { pin: await pinAt(), facing: await facing() };
  await tap(mb.x + mb.width / 2, mb.y + mb.height * 0.72);
  await page.waitForTimeout(3000);
  const zc = page.locator('.vc-map-card[data-over-sv]');
  log.zoneTap = {
    card: await zc.count(),
    kind: (await zc.locator('.vc-map-kind').textContent().catch(() => null))?.trim() ?? null,
    title: (await zc.locator('.vc-map-card-title').textContent().catch(() => null))?.trim() ?? null,
    pinSame: before.pin === (await pinAt()),
    facingSame: Number.isNaN(before.facing) || before.facing === (await facing()),
  };
  await shot('5-zone-card');
  step('zone tap', log.zoneTap);
  log.ok = {
    layersTappable: log.steps.find((s) => s.name === 'tools open')?.layersOnTop === 'yes',
    hintHiddenWithMenu: log.steps.find((s) => s.name === 'tools open')?.hintShown === false,
    noOverlap: (log.steps.find((s) => s.name === 'tools open')?.problems ?? ['?']).length === 0,
    projectCard: log.projectTap.card === 1 && log.projectTap.pinSame && log.projectTap.facingSame,
    zoneCard: log.zoneTap.card === 1 && log.zoneTap.pinSame && log.zoneTap.facingSame,
    labels: ['Close', 'Layers', 'Google'].every((l) => (log.steps[0]?.bar ?? []).includes(l)),
  };
} catch (e) {
  log.error = redact(e).slice(0, 400);
  await shot('failed');
}
await browser.close();
const text = redact(JSON.stringify(log, null, 2));
writeFileSync(`${OUT}/sv-phone.json`, text);
console.log(text);
