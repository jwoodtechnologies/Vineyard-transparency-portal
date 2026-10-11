#!/usr/bin/env node
/**
 * Draws the share image and the icon set from the wordmark, in a headless browser, into public/:
 *
 *   og.png                1200 x 630   Open Graph and Twitter card
 *   favicon.svg           any          the tab icon (vector)
 *   favicon-32.png        32 x 32      tab icon for browsers without SVG icons
 *   apple-touch-icon.png  180 x 180    iOS home screen
 *   icon-192.png          192 x 192    web app manifest
 *   icon-512.png          512 x 512    web app manifest (also the maskable icon: the mark sits in the safe zone)
 *
 * Usage (playwright-core is not a project dependency; point at any install of it and at a Chromium):
 *   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.mjs CHROME=/path/to/chrome node scripts/og/make.mjs
 *
 * The type is the site's own: Source Serif 4 (the wordmark) and Inter, read from node_modules/@fontsource-variable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pub = join(root, 'public');
const font = (pkg, file) => readFileSync(join(root, 'node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64');
const SERIF = font('source-serif-4', 'source-serif-4-latin-wght-normal.woff2');
const SANS = font('inter', 'inter-latin-wght-normal.woff2');

// The brand: carbon ink, white, and the Vineyard wine accent in its light (dark theme) form.
const INK = '#0b0b0d';
const PAPER = '#ffffff';
const WINE = '#e6a9c6';
const MUTED = '#a3a3ab';

const faces = `
  @font-face { font-family: 'Serif'; src: url(data:font/woff2;base64,${SERIF}) format('woff2'); font-weight: 200 900; }
  @font-face { font-family: 'Sans'; src: url(data:font/woff2;base64,${SANS}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; box-sizing: border-box; }
  html, body { background: ${INK}; }
`;

/** The share card: the wordmark as the header shows it, large, with one line under it. */
const og = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
  body { width: 1200px; height: 630px; display: flex; flex-direction: column; justify-content: center; padding: 0 104px; color: ${PAPER}; font-family: 'Sans'; }
  .name { font-family: 'Serif'; font-weight: 560; font-size: 156px; line-height: 1; letter-spacing: -0.02em; }
  .tag { margin-top: 26px; font-weight: 600; font-size: 25px; letter-spacing: 0.34em; text-transform: uppercase; color: ${MUTED}; }
  .rule { width: 72px; height: 4px; margin: 56px 0 28px; border-radius: 2px; background: ${WINE}; }
  .line { font-size: 32px; line-height: 1.35; color: ${PAPER}; opacity: 0.92; }
  .url { position: absolute; left: 104px; bottom: 56px; font-size: 24px; font-weight: 500; color: ${MUTED}; letter-spacing: 0.01em; }
</style></head><body>
  <div class="name">Vineyard</div>
  <div class="tag">Transparency Portal</div>
  <div class="rule"></div>
  <div class="line">Public records of Vineyard, Utah: meetings, votes, budget and every source document.</div>
  <div class="url">vineyardportal.org</div>
</body></html>`;

/** The mark: the wordmark's serif V on carbon, with the wine dot. `pad` keeps it inside a maskable safe zone. */
const icon = (size, { round = true, pad = 0 } = {}) => {
  const inner = size * (1 - pad * 2);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
  html, body { background: transparent; }
  body { width: ${size}px; height: ${size}px; display: grid; place-items: center; background: ${round ? 'transparent' : INK}; }
  .tile { position: relative; width: ${round ? size : inner}px; height: ${round ? size : inner}px; border-radius: ${round ? size * 0.23 : 0}px; background: ${INK}; }
  .v { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center; font-family: 'Serif'; font-weight: 600; font-size: ${(round ? size : inner) * 0.7}px; line-height: 1; color: ${PAPER}; margin-top: ${(round ? size : inner) * 0.02}px; }
  .dot { position: absolute; width: ${(round ? size : inner) * 0.1}px; height: ${(round ? size : inner) * 0.1}px; border-radius: 50%; right: ${(round ? size : inner) * 0.17}px; bottom: ${(round ? size : inner) * 0.24}px; background: ${WINE}; }
</style></head><body><div class="tile"><span class="v">V</span><i class="dot"></i></div></body></html>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="11" fill="${INK}"/>
  <text x="23" y="36" text-anchor="middle" font-family="'Source Serif 4', 'Source Serif Pro', Georgia, 'Times New Roman', serif" font-size="34" font-weight="600" fill="${PAPER}">V</text>
  <circle cx="38.5" cy="35" r="2.6" fill="${WINE}"/>
</svg>
`;

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const shoot = async (html, w, h, file, transparent = false) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(pub, file), omitBackground: transparent });
  await page.close();
  console.log(`public/${file}`);
};

await shoot(og, 1200, 630, 'og.png');
await shoot(icon(32, { round: true }), 32, 32, 'favicon-32.png', true);
await shoot(icon(180, { round: false, pad: 0 }), 180, 180, 'apple-touch-icon.png');
await shoot(icon(192, { round: false, pad: 0.1 }), 192, 192, 'icon-192.png');
await shoot(icon(512, { round: false, pad: 0.1 }), 512, 512, 'icon-512.png');
writeFileSync(join(pub, 'favicon.svg'), svg);
console.log('public/favicon.svg');
await browser.close();
