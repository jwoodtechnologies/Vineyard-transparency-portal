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
  // The largest project that is a place, not a city wide shape (under about 0.5 square km).
  const KM2 = 1 / (111.32 * 85.1);
  const local = rings.filter((r) => area(r.ring) / 2 < 0.5 * KM2);
  rings.length = 0;
  rings.push(...local.sort((a, b) => area(b.ring) - area(a.ring)));
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
/** The median time between frames over one second, in ms. */
const frameMs = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        const t = [];
        let last = performance.now();
        const step = (now) => {
          t.push(now - last);
          last = now;
          if (t.reduce((a, b) => a + b, 0) < 1000) requestAnimationFrame(step);
          else done(Math.round(t.sort((a, b) => a - b)[Math.floor(t.length / 2)]));
        };
        requestAnimationFrame(step);
      }),
  );
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
  // The pin stands inside the project near its south edge (a park or field is open ground, so no house in
  // front hides it), and the view starts facing north, across the project.
  const south = project ? Math.min(...project.ring.map((v) => v[1])) : 0;
  const inside = project ? [project.at[0], south + 15 / 111320] : null;
  const at = project ? (inRing(inside, project.ring) ? inside : project.at) : [-111.7455, 40.3035];
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

  // Layers from the Tools menu: the panel opens as a sheet; Capital projects and Zoning on.
  await tapEl('.vc-map-tools-menu [role^="menuitem"]');
  await page.waitForTimeout(1500);
  await shot('3-layers-sheet');
  const projectsOn = await layer('Capital projects', true);
  await tapEl('.vc-sv-bar-btn[aria-pressed]');
  await page.waitForTimeout(800);
  step('layers', { panel: true, projectsOn, zoningOn: await layer('Zoning', true) });
  await page.waitForTimeout(5000);
  // The zone under the pin, in a chip by the bar; nothing overlaps with it shown.
  const chipText = (await page.locator('.vc-sv-zone').first().textContent().catch(() => null))?.trim() ?? null;
  const ovChip = (await overlaps(page)).map((o) => `${o.a} x ${o.b}`);
  log.zoneChip = { text: chipText, overlaps: ovChip, hint: (await page.locator('.vc-sv-hint').first().textContent().catch(() => null))?.trim() ?? null };
  await shot('3b-zone-chip');

  // A finger tap on the project: its card, the pin and view unchanged.
  const tapProject = async (tag) => {
    const before = { pin: await pinAt(), facing: await facing() };
    let point = null;
    // Points inside the project (its middle, then midpoints across it), on screen and clear of the pin by 60 px
    // (the pin would take the tap).
    const pin = await page.locator('.vc-sv-pin').boundingBox().catch(() => null);
    const clear = (p) => !pin || Math.hypot(p.x - (pin.x + pin.width / 2), p.y - (pin.y + pin.height / 2)) > 60;
    if (project) {
      const r = project.ring;
      const cands = [project.at, ...r.flatMap((v, i) => [3, 7, 11].map((k) => [(v[0] + r[(i + k) % r.length][0]) / 2, (v[1] + r[(i + k) % r.length][1]) / 2]))].filter((q) => inRing(q, r));
      // Deepest inside first: farthest from the outline's corners (an edge tap could read as outside).
      const depth = (q) => Math.min(...r.map((v) => Math.hypot((v[0] - q[0]) * 85000, (v[1] - q[1]) * 111000)));
      cands.sort((a, b) => depth(b) - depth(a));
      const pts = await page.evaluate((list) => {
        const m = window.__vtpMap;
        if (!m) return [];
        const c = m.getContainer().getBoundingClientRect();
        return list.map(([lng, lat]) => {
          const p = m.project({ lng, lat });
          return { x: c.left + p.x, y: c.top + p.y, inView: p.x > 20 && p.y > 230 && p.x < c.width - 80 && p.y < c.height - 80 };
        });
      }, cands.slice(0, 400));
      point = pts.find((p) => p.inView && clear(p)) ?? null;
    }
    const mb = await page.locator('.vc-map').boundingBox();
    const tp = point ?? { x: mb.x + mb.width * 0.3, y: mb.y + mb.height * 0.7 };
    // Where that tap lands on the ground, and whether it is inside the project's outline.
    const ground = await page.evaluate(([x, y]) => {
      const m = window.__vtpMap;
      if (!m) return null;
      const c = m.getContainer().getBoundingClientRect();
      const ll = m.unproject([x - c.left, y - c.top]);
      return [ll.lng, ll.lat];
    }, [tp.x, tp.y]);
    const xs = project?.ring.map((p) => p[0]) ?? [0],
      ys = project?.ring.map((p) => p[1]) ?? [0];
    const where = { ground: ground?.map((v) => +v.toFixed(6)), inside: ground && project ? inRing(ground, project.ring) : null, ringPoints: project?.ring.length, ringBox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(5)) };
    // The runner draws without a GPU, often slower than a frame a second, and a busy page can see a 70 ms
    // tap last past the 350 ms limit: the frame interval is logged, and the tap tried up to three times.
    // What street view holds and what this point resolves to (debug hook).
    where.page = await page.evaluate(([x, y]) => {
      const sv = window.__vtpSv;
      if (!sv) return null;
      const c = document.querySelector('.vc-map')?.getBoundingClientRect();
      const g = sv.ground();
      return { projects: g.filter((f) => f.layer === 'projects').map((f) => f.name).slice(0, 12), zones: g.filter((f) => f.layer !== 'projects').length, at: sv.at(x - (c?.left ?? 0), y - (c?.top ?? 0)) };
    }, [tp.x, tp.y]);
    const card = page.locator('.vc-map-card[data-over-sv]');
    const tries = [];
    for (let i = 0; i < 3 && !(await card.count()); i++) {
      tries.push(await frameMs());
      await tap(tp.x, tp.y);
      await page.waitForTimeout(3000);
    }
    const r = {
      tappedAt: [Math.round(tp.x), Math.round(tp.y)],
      where,
      tries: tries.length,
      frameMsBeforeTries: tries,
      projected: Boolean(point),
      card: await card.count(),
      title: (await card.locator('.vc-map-card-title').textContent().catch(() => null))?.trim() ?? null,
      kind: (await card.locator('.vc-map-kind').textContent().catch(() => null))?.trim() ?? null,
      cardBox: await card.boundingBox().catch(() => null),
      pinSame: before.pin === (await pinAt()),
      facingSame: Number.isNaN(before.facing) || before.facing === (await facing()),
    };
    await shot(tag);
    // Go here on the card: the card closes and the pin moves to the project.
    r.goHere = await card.locator('button', { hasText: 'Go here' }).count();
    if (r.goHere) {
      const b = await card.locator('button', { hasText: 'Go here' }).boundingBox();
      await tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(6000);
      r.afterGoHere = { card: await card.count(), pinMoved: before.pin !== (await pinAt()) };
      await shot(`${tag}-go-here`);
    } else if (r.card) await tapEl('button[aria-label="Close details"]').catch(() => undefined);
    await page.waitForTimeout(1000);
    return r;
  };
  log.projectTap = await tapProject('4-project-card');
  step('project tap', log.projectTap);

  // With Zoning and Projects on, a tap on the ground away from any project moves (no card).
  const mb = await page.locator('.vc-map').boundingBox();
  const zc = page.locator('.vc-map-card[data-over-sv]');
  const before = await pinAt();
  const mtries = [];
  for (let i = 0; i < 3 && before === (await pinAt()); i++) {
    mtries.push(await frameMs());
    await tap(mb.x + mb.width * 0.3, mb.y + mb.height * 0.82);
    await page.waitForTimeout(6000);
    if (await zc.count()) break;
  }
  log.groundTap = { tries: mtries.length, frameMsBeforeTries: mtries, moved: before !== (await pinAt()), card: await zc.count() };
  await shot('5-moved');
  if (log.groundTap.card) await tapEl('button[aria-label="Close details"]').catch(() => undefined);
  // The zone chip opens the zone's card, and the pin stays.
  const pinBefore = await pinAt();
  await tapEl('.vc-sv-zone').catch(() => undefined);
  await page.waitForTimeout(2500);
  log.zoneTap = {
    card: await zc.count(),
    kind: (await zc.locator('.vc-map-kind').textContent().catch(() => null))?.trim() ?? null,
    title: (await zc.locator('.vc-map-card-title').textContent().catch(() => null))?.trim() ?? null,
    pinSame: pinBefore === (await pinAt()),
    overlaps: (await overlaps(page)).map((o) => `${o.a} x ${o.b}`),
  };
  await shot('6-zone-card');
  step('zone chip tap', log.zoneTap);
  log.ok = {
    layersTappable: log.steps.find((s) => s.name === 'tools open')?.layersOnTop === 'yes',
    hintHiddenWithMenu: log.steps.find((s) => s.name === 'tools open')?.hintShown === false,
    noOverlap: (log.steps.find((s) => s.name === 'tools open')?.problems ?? ['?']).length === 0,
    projectCard: log.projectTap.card === 1 && log.projectTap.pinSame && log.projectTap.facingSame,
    goHere: Boolean(log.projectTap.afterGoHere?.pinMoved && log.projectTap.afterGoHere.card === 0),
    groundTapMoves: log.groundTap.moved && !log.groundTap.card,
    zoneChip: Boolean(log.zoneChip.text?.startsWith('Zone:')) && log.zoneChip.overlaps.length === 0,
    zoneCard: log.zoneTap.card === 1 && log.zoneTap.pinSame,
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
