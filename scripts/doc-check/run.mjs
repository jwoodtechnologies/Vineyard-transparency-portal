#!/usr/bin/env node
/**
 * Nightly document check against the live site (.github/workflows/doc-check.yml).
 *
 *   node scripts/doc-check/run.mjs --base https://vineyardportal.org --pw <playwright index.mjs> [--count 25] [--seed N] [--out doc-check.json]
 *        [--ids doc_a,doc_b] (these records instead of a random sample)
 *
 * 1. Links: every record id named by the pages that link records (construction, budget, numbered indexes,
 *    latest, coverage) must open (GET /api/documents/:id answers 200, following old ids to their record).
 * 2. Viewer: `--count` random PDFs (about three in four with an archived copy, the rest without) opened at
 *    phone (390 px) and desktop (1440 px) size in Chromium. The portal's own pdf.js pages are checked (the
 *    browser's built-in viewer cannot be read by a script; its file route is checked instead: a PDF, framable
 *    by the portal). Fails when the first page is blank, its contrast is low (too few dark pixels), the
 *    toolbar is unstyled, the page text does not match the record's own text (page 1 of /api/documents/:id/text),
 *    or a file the portal can serve shows "Open the PDF" instead.
 * Writes a JSON report and a Markdown summary ($GITHUB_STEP_SUMMARY) and exits 1 on any failure.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { judge, pick, recordIds, rng } from './lib.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), []),
);
const BASE = (args.base ?? 'https://vineyardportal.org').replace(/\/+$/, '');
const COUNT = Number(args.count ?? 25);
const SEED = Number(args.seed ?? Date.now() % 100000);
const OUT = args.out ?? 'doc-check.json';
const SHOTS = args.shots ?? 'doc-check-shots';
const UA = 'VineyardTransparencyPortal-DocCheck/1.0 (+https://vineyardportal.org)';
const random = rng(SEED);

async function get(path, init = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
      if (r.status >= 500 && attempt < 2) continue;
      return r;
    } catch (e) {
      if (attempt === 2) throw e;
    }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error('unreachable');
}
const getJson = async (path) => {
  const r = await get(path);
  return r.ok ? r.json() : null;
};

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** 1. Every record id linked from the pages that link records. */
async function checkLinks() {
  const pages = ['/api/pages/construction', '/api/construction', '/api/budget', '/api/budget/archive', '/api/records/ordinances', '/api/records/resolutions', '/api/records/rda-resolutions', '/api/latest', '/api/coverage/summary'];
  const ids = new Set();
  const read = [];
  for (const p of pages) {
    const r = await get(p).catch(() => null);
    read.push({ page: p, status: r?.status ?? 'error' });
    if (r?.ok) for (const id of recordIds(await r.text())) ids.add(id);
  }
  const results = await pool([...ids], 8, async (id) => {
    const r = await get(`/api/documents/${id}`).catch(() => null);
    if (!r) return { id, status: 'error' };
    const body = r.ok ? await r.json().catch(() => null) : null;
    return { id, status: r.status, movedTo: body && body.id !== id ? body.id : undefined };
  });
  return { pages: read, checked: results.length, dead: results.filter((x) => x.status !== 200), moved: results.filter((x) => x.movedTo) };
}

/** 2a. The sample: PDFs with an archived copy, and some without. */
async function sample() {
  if (args.ids) return (await pool(args.ids.split(','), 4, (id) => getJson(`/api/documents/${id}`))).filter(Boolean);
  const first = await getJson('/api/documents?pageSize=100&page=1');
  const total = Number(first?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / 100));
  const want = pick(Array.from({ length: pages }, (_, i) => i + 1), Math.min(pages, 8), random);
  const pdfs = [];
  for (const p of want) {
    const list = p === 1 ? first : await getJson(`/api/documents?pageSize=100&page=${p}`);
    for (const d of list?.items ?? []) if (d.mimeType === 'application/pdf') pdfs.push(d.id);
  }
  const details = await pool(pick(pdfs, Math.min(pdfs.length, COUNT * 4), random), 6, (id) => getJson(`/api/documents/${id}`));
  const ok = details.filter(Boolean);
  const archived = ok.filter((d) => d.archiveUrl);
  const other = ok.filter((d) => !d.archiveUrl);
  const nOther = Math.min(other.length, Math.round(COUNT / 4));
  return [...archived.slice(0, COUNT - nOther), ...other.slice(0, nOther)];
}

/** 2b. The file route: a PDF the portal can frame, or a redirect to the official address. */
async function fileRoute(doc) {
  const r = await get(`/api/documents/${doc.id}/file`, { headers: { range: 'bytes=0-2047' }, redirect: 'manual' }).catch(() => null);
  if (!r) return { ok: false, status: 'error' };
  const body = r.status === 200 || r.status === 206 ? Buffer.from(await r.arrayBuffer()).subarray(0, 2048).toString('latin1') : '';
  return { ok: body.includes('%PDF'), status: r.status, type: r.headers.get('content-type'), frame: r.headers.get('x-frame-options'), via: r.headers.get('x-vtp-archive') };
}

/** 2c. One record in the browser. */
async function view(browser, doc, phone) {
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36 DocCheck' }
      : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 DocCheck` },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  const out = { error: null, state: null, toolbar: null, pixels: null, text: '', shot: null };
  try {
    await page.goto(`${BASE}/documents/${doc.id}?viewer=pdfjs`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const handle = await page
      .waitForSelector('.vc-pdf-page[data-page="1"][data-state="drawn"], .vc-pdf-page[data-page="1"][data-state="failed"], .vc-filecard', { timeout: 60000 })
      .catch(() => null);
    await page.waitForTimeout(1500);
    Object.assign(
      out,
      await page.evaluate(() => {
        const bar = document.querySelector('.vc-vbar');
        const btn = bar?.querySelector('.vc-vbtn');
        const input = bar?.querySelector('input');
        let toolbar = { styled: false, why: 'no toolbar' };
        if (bar && btn) {
          const b = getComputedStyle(bar);
          const r = bar.getBoundingClientRect();
          const bh = btn.getBoundingClientRect().height;
          const iw = input ? input.getBoundingClientRect().width : 0;
          const why = [b.display !== 'flex' && `display ${b.display}`, r.height > 90 && `${Math.round(r.height)} px tall`, bh < 28 && `buttons ${Math.round(bh)} px`, input && iw > 120 && `page box ${Math.round(iw)} px wide`].filter(Boolean);
          toolbar = { styled: why.length === 0, why: why.join(', ') };
        }
        const p1 = document.querySelector('.vc-pdf-page[data-page="1"]');
        const card = document.querySelector('.vc-filecard');
        const state = p1?.getAttribute('data-state') === 'drawn' ? 'drawn' : card ? 'card' : (p1?.getAttribute('data-state') ?? 'missing');
        const canvas = p1?.querySelector('canvas');
        // Every 16th pixel, the same thresholds as pixelStats in lib.mjs (kept here: no eval under the page's CSP).
        let pixels = null;
        const d = canvas && canvas.width && canvas.height ? canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data : null;
        if (d) {
          let dark = 0;
          let ink = 0;
          let n = 0;
          for (let i = 0; i < d.length; i += 64) {
            const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            n++;
            if (l < 110) dark++;
            if (l < 235) ink++;
          }
          pixels = { dark: dark / n, ink: ink / n, samples: n };
        }
        const text = Array.from(p1?.querySelectorAll('.textLayer span') ?? [], (s) => s.textContent ?? '').join(' ');
        return { state, toolbar, pixels, text };
      }),
    );
    if (!handle) out.state = out.state ?? 'timeout';
    if (errors.length) out.error = errors[0];
    out.shot = `${SHOTS}/${doc.id}-${phone ? 390 : 1440}.png`;
    await page.screenshot({ path: out.shot }).catch(() => (out.shot = null));
  } catch (e) {
    out.error = String(e).slice(0, 200);
  }
  await ctx.close();
  return out;
}

async function main() {
  if (!args.pw) throw new Error('--pw <path to playwright index.mjs> is required');
  mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await import(args.pw);
  const links = await checkLinks();
  const docs = await sample();
  const browser = await chromium.launch();
  const records = [];
  for (const doc of docs) {
    const [file, textPages] = await Promise.all([fileRoute(doc), getJson(`/api/documents/${doc.id}/text`)]);
    const apiText = Array.isArray(textPages) ? (textPages.find((p) => p.page === 1)?.text ?? '') : '';
    const servable = Boolean(doc.archiveUrl);
    const problems = [];
    if (servable && !file.ok) problems.push(`file route did not return the PDF (${file.status})`);
    if (file.ok && file.frame && !/sameorigin/i.test(file.frame)) problems.push(`file route forbids the portal's frame (${file.frame})`);
    const views = {};
    for (const phone of [true, false]) {
      const v = await view(browser, doc, phone);
      views[phone ? 'phone' : 'desktop'] = { ...v, problems: judge(v, apiText, servable || file.ok) };
      problems.push(...views[phone ? 'phone' : 'desktop'].problems.map((p) => `${phone ? 'phone' : 'desktop'}: ${p}`));
    }
    records.push({ id: doc.id, title: doc.title, archived: servable, file, views, problems });
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${doc.id} ${doc.title.slice(0, 60)}${problems.length ? `\n     ${problems.join('\n     ')}` : ''}`);
  }
  await browser.close();
  const failed = records.filter((r) => r.problems.length);
  const report = { base: BASE, seed: SEED, at: new Date().toISOString(), links, records, failed: failed.length + links.dead.length };
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  const md = [
    '## Document check',
    '',
    `${records.length} records at 390 and 1440 px (seed ${SEED}), ${records.filter((r) => r.archived).length} with an archived copy. ${links.checked} linked record ids checked.`,
    '',
    failed.length || links.dead.length ? `**${failed.length} records and ${links.dead.length} links failing.**` : 'Everything passed.',
    '',
    ...(links.dead.length ? ['### Links that dead end', '', ...links.dead.map((d) => `- ${d.id}: ${d.status}`), ''] : []),
    ...(failed.length ? ['### Records', '', '| Record | Problems |', '| --- | --- |', ...failed.map((r) => `| [${r.title.replace(/\|/g, '/').slice(0, 70)}](${BASE}/documents/${r.id}) | ${r.problems.join('; ').replace(/\|/g, '/')} |`), ''] : []),
  ].join('\n');
  console.log(`\n${md}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  if (failed.length || links.dead.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
