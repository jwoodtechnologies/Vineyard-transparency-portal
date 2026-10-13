/**
 * The map's layout check, part of map-shots: every state of /map at 390x844, 660x572 and 1440x900, light
 * and dark, with a screenshot each, and the overlap check (overlap.mjs) run on each. States: the normal
 * map, the layers panel open, a details card open, the projects list, the Tools menu, Measure (sheet peek
 * and expanded, and a parcel card), Street View (a photo and the 3D view) and full screen.
 *
 * `mock` serves the API from fixtures (for a local run with no network); live runs read the real site.
 */
import { overlaps } from './overlap.mjs';

/** The sizes Jacob checks, and a wide but short laptop window. */
export const VIEWPORTS = [
  { name: '390x844', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: '660x572', ctx: { viewport: { width: 660, height: 572 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: '1270x580', ctx: { viewport: { width: 1270, height: 580 } } },
  { name: '1440x900', ctx: { viewport: { width: 1440, height: 900 } } },
];

/** A spot with no street photo close by (the 3D view) and one on a road with photos (the one sv-shots uses). */
const NO_PHOTO = [-111.7455, 40.3035];
const PHOTO = [-111.73495, 40.31381];
const AREA = 'a:kpvzkAfzactE~~CgxBk\\_tAocCrS';

const at = ([lng, lat], z = 16, extra = '') => `/map?lat=${lat}&lng=${lng}&z=${z}${extra}`;

/** Presses and holds (touch) or right clicks (mouse) the middle of the map: Street View at that spot. */
async function holdMiddle(page, ctx, touch) {
  const b = await page.locator('.vc-map').boundingBox();
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  if (!touch) return page.mouse.click(x, y, { button: 'right' });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function closePanel(page) {
  if (await page.locator('.vc-map-panel').count()) await page.click('.vc-map-panel .vc-map-close:not(.vc-map-clear)');
  return undefined;
}

async function tapMiddle(page, touch) {
  const b = await page.locator('.vc-map').boundingBox();
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

export const STATES = [
  { name: 'map', url: at(NO_PHOTO, 16, '&layers=zoning'), run: async (page) => closePanel(page) },
  {
    name: 'layers',
    url: at(NO_PHOTO, 16, '&layers=zoning'),
    run: async (page) => {
      if (!(await page.locator('.vc-map-panel').count())) {
        await page.click('.vc-map-tools > button');
        await page.click('.vc-map-tools-item:has-text("Layers")');
      }
      await page.waitForSelector('.vc-map-panel');
    },
  },
  {
    name: 'tools',
    url: at(NO_PHOTO, 16, '&layers=zoning'),
    run: async (page) => {
      await closePanel(page);
      await page.click('.vc-map-tools > button');
      await page.waitForSelector('.vc-map-tools-menu');
    },
  },
  {
    name: 'card',
    url: at(NO_PHOTO, 17, '&layers=zoning'),
    run: async (page, ctx, touch) => {
      await closePanel(page);
      await tapMiddle(page, touch);
      await page.waitForSelector('.vc-map-card', { timeout: 15000 });
    },
  },
  { name: 'projects', url: at(NO_PHOTO, 15, '&layers=projects'), run: async (page) => page.waitForSelector('.vc-mp', { timeout: 20000 }) },
  { name: 'measure', url: `/map?m=${encodeURIComponent(AREA)}`, run: async (page) => page.waitForSelector('.vc-measure') },
  {
    name: 'measure-open',
    url: `/map?m=${encodeURIComponent(AREA)}`,
    run: async (page) => {
      await page.waitForSelector('.vc-measure');
      await page.click('.vc-measure-grip, .vc-measure-more');
    },
  },
  {
    name: 'measure-parcel',
    url: at(NO_PHOTO, 17),
    run: async (page, ctx, touch) => {
      await closePanel(page);
      await page.click('.vc-map-tools > button');
      await page.click('.vc-map-tools-item:has-text("Measure")');
      await page.waitForSelector('.vc-measure');
      await page.click('.vc-measure-modes button:has-text("Parcel")');
      await tapMiddle(page, touch);
      await page.waitForSelector('.vc-pcard', { timeout: 15000 });
    },
  },
  {
    name: 'streetview-photo',
    url: at(PHOTO, 18),
    live: true,
    run: async (page, ctx, touch) => {
      await closePanel(page);
      await holdMiddle(page, ctx, touch);
      await page.waitForSelector('.vc-svp', { timeout: 25000 });
      await page.waitForSelector('.vc-svp .mapillary-attribution-container', { timeout: 25000 }).catch(() => undefined);
    },
  },
  {
    name: '3d',
    url: at(NO_PHOTO, 17),
    run: async (page, ctx, touch) => {
      await closePanel(page);
      const t0 = await page.evaluate(() => performance.now());
      await holdMiddle(page, ctx, touch);
      await page.waitForSelector('.vc-sv-compass', { timeout: 25000 });
      // Time from the press to the first frame of the 3D view (StreetView marks it), the target being under 2 s.
      const first = await page.waitForFunction(() => performance.getEntriesByName('vtp-3d-first-frame')[0]?.startTime ?? null, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => null);
      return { firstFrameMs: first == null ? null : Math.round(first - t0 - (touch ? 800 : 0)) };
    },
  },
  {
    name: 'fullscreen',
    url: at(NO_PHOTO, 16, '&layers=zoning'),
    run: async (page) => {
      await closePanel(page);
      await page.click('.vtp-fs-btn');
    },
  },
];

/**
 * Runs every state at every size, light and dark. Returns { results, failures } where each result has the
 * file name and the overlapping pairs; screenshots go to `out`.
 */
export async function runLayout({ browser, base, out, mock = null, only = null, themes = ['light', 'dark'], settle = 3500 }) {
  const results = [];
  for (const vp of VIEWPORTS)
    for (const theme of themes)
      for (const st of STATES) {
        if (only && !only.includes(st.name)) continue;
        if (mock && st.live) continue;
        const ctx = await browser.newContext({ ...vp.ctx, colorScheme: theme });
        await ctx.addInitScript((t) => {
          try {
            localStorage.setItem('vtp:mapbase', 'satellite');
            localStorage.setItem('vtp:theme', t);
          } catch {}
        }, theme);
        if (mock) await mock(ctx);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
        const file = `layout-${vp.name}-${theme}-${st.name}.png`;
        try {
          await page.goto(base + st.url, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.vc-map-tools > button', { timeout: 30000 });
          await page.waitForFunction(() => !document.querySelector('.vc-map-loading'), null, { timeout: 30000 }).catch(() => undefined);
          await page.waitForTimeout(800);
          const extra = (await st.run(page, ctx, Boolean(vp.ctx.hasTouch))) ?? {};
          await page.waitForTimeout(settle);
          const pairs = await overlaps(page);
          await page.screenshot({ path: `${out}/${file}` });
          results.push({ file, viewport: vp.name, theme, state: st.name, overlaps: pairs, errors, ...(extra && typeof extra === 'object' && !Array.isArray(extra) && !('evaluate' in extra) ? extra : {}) });
        } catch (e) {
          await page.screenshot({ path: `${out}/${file}` }).catch(() => undefined);
          results.push({ file, viewport: vp.name, theme, state: st.name, error: String(e).slice(0, 300), errors });
        }
        await ctx.close();
      }
  const failures = results.filter((r) => r.error || r.overlaps?.length);
  return { results, failures };
}
