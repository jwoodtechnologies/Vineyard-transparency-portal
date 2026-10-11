/**
 * Document check logic (pure, no I/O), used by scripts/doc-check/run.mjs and tested in tests/doc-check.test.ts.
 */

/** Ids of records named anywhere in a JSON payload (doc_ and 16 hex characters). */
export function recordIds(text) {
  return [...new Set(String(text ?? '').match(/\bdoc_[0-9a-f]{16}\b/g) ?? [])];
}

/** A small seeded random generator (mulberry32), so a run can be repeated with its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` items picked without repeats. */
export function pick(items, n, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** Words of four letters or more, lower case. */
export function words(text) {
  return new Set((String(text ?? '').toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).map((w) => w.replace(/['-]+$/, '')));
}

/**
 * How much of the shorter word list the other one shares (0 to 1), or null when either side has under
 * `min` words (a scan with no text layer, a near empty cover page): nothing to compare.
 */
export function overlap(a, b, min = 15) {
  const A = words(a);
  const B = words(b);
  if (A.size < min || B.size < min) return null;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

/**
 * Pixel statistics of an RGBA buffer: the share of dark pixels (text) and of pixels that are not near white.
 * A readable page has dark pixels; a washed out or blank page has almost none.
 */
export function pixelStats(data, step = 4) {
  let dark = 0;
  let ink = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
    if (l < 110) dark++;
    if (l < 235) ink++;
  }
  return { dark: n ? dark / n : 0, ink: n ? ink / n : 0, samples: n };
}

/** minDark: the April 14, 2026 minutes with their scanned text missing measured 0.2% dark pixels; drawn right, 4%. */
export const LIMITS = { minDark: 0.006, minInk: 0.004, minOverlap: 0.5 };

/** The verdict for one page view. `view` comes from the browser; `apiText` is page 1 of /api/documents/:id/text. */
export function judge(view, apiText, expectPdf) {
  const problems = [];
  if (view.error) problems.push(`page error: ${view.error}`);
  if (!view.toolbar?.styled) problems.push(`toolbar unstyled (${view.toolbar?.why ?? 'not found'})`);
  if (view.state === 'card') {
    if (expectPdf) problems.push('shows "Open the PDF" although the portal can serve the file');
  } else if (view.state !== 'drawn') {
    problems.push(`first page not drawn (${view.state ?? 'nothing'})`);
  } else {
    if (!view.pixels || view.pixels.ink < LIMITS.minInk) problems.push('first page is blank');
    else if (view.pixels.dark < LIMITS.minDark) problems.push(`low contrast: ${(view.pixels.dark * 100).toFixed(2)}% dark pixels`);
    const o = overlap(view.text, apiText);
    if (o != null && o < LIMITS.minOverlap) problems.push(`page text does not match the record text (${Math.round(o * 100)}% shared words)`);
  }
  return problems;
}
