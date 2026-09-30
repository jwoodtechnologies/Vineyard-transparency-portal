/**
 * Text utilities shared by the demo search engine and the UI (highlighting).
 * Everything here treats document text as untrusted plain text.
 */

export const STOPWORDS = new Set(
  'a an and are as at be been but by for from has have in into is it its of on or that the their them then there these they this those to was were will with within without which who whom whose what when where why how any all can could do does did done should would may might must shall about above after again against also am because before being below between both during each few further here if more most no nor not only other our ours out over own same so some such than too under until up very via'.split(
    ' ',
  ),
);

/** Words that carry no retrieval value in natural-language questions to this archive. */
export const QUESTION_STOPWORDS = new Set(
  'show me find list give tell please record records document documents public information info regarding concerning related relating mention mentions mentioned discuss discusses discussed say says said involve involves involving happen happened happening vineyard city utah ut know anything everything something us we i you your my get see look looking search decide decided decision decisions talk talked much many has have'.split(
    ' ',
  ),
);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, '');
  if (/^\d/.test(w)) return w;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) w = w.slice(0, -1);
  // Deliberately light: no -ing/-ed stripping, so "parking" never collides with "parks".
  return w;
}

export interface Token {
  raw: string;
  stem: string;
  start: number;
  end: number;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const raw = m[0].replace(/[-’']+$/, '');
    if (!raw) continue;
    // Split hyphenated compounds into parts as well as keeping the compound for identifiers.
    const start = m.index ?? 0;
    out.push({ raw, stem: stem(raw), start, end: start + raw.length });
    if (raw.includes('-')) {
      let offset = 0;
      for (const part of raw.split('-')) {
        if (part) out.push({ raw: part, stem: stem(part), start: start + offset, end: start + offset + part.length });
        offset += part.length + 1;
      }
    }
  }
  return out;
}

export function contentStems(text: string, extraStopwords?: Set<string>): string[] {
  const seen = new Set<string>();
  for (const t of tokenize(text)) {
    const lower = t.raw.toLowerCase();
    if (STOPWORDS.has(lower) || extraStopwords?.has(lower)) continue;
    if (lower.length < 2) continue;
    seen.add(t.stem);
  }
  return [...seen];
}

/** Normalizes an identifier like "Resolution No. DEMO-RES-2026-04" → "DEMORES202604". */
export function normalizeIdentifier(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface ParsedQuery {
  phrases: string[];
  terms: string[];
  stems: string[];
  identifiers: string[];
}

const IDENTIFIER_RE = /\b(?:[A-Za-z]{1,6}-)*\d{2,4}-\d{1,4}[A-Za-z]?\b|\b[A-Za-z]{2,6}-[A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/g;

export function parseQuery(query: string): ParsedQuery {
  const phrases: string[] = [];
  const rest = query.replace(/["“”]([^"“”]+)["“”]/g, (_, p: string) => {
    const phrase = normalizeWhitespace(p);
    if (phrase) phrases.push(phrase);
    return ' ';
  });
  const identifiers = [...query.matchAll(IDENTIFIER_RE)].map((m) => m[0]);
  const terms: string[] = [];
  const stems: string[] = [];
  for (const t of tokenize(rest)) {
    const lower = t.raw.toLowerCase();
    if (STOPWORDS.has(lower) || lower.length < 2) continue;
    if (!stems.includes(t.stem)) {
      terms.push(t.raw);
      stems.push(t.stem);
    }
  }
  return { phrases, terms, stems, identifiers };
}

/** Character ranges in `text` that match any of the stems or phrases (sorted, merged). */
export function findHighlights(text: string, stems: string[], phrases: string[] = []): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (stems.length) {
    const set = new Set(stems);
    for (const t of tokenize(text)) if (set.has(t.stem)) ranges.push([t.start, t.end]);
  }
  const lower = text.toLowerCase();
  for (const p of phrases) {
    const needle = p.toLowerCase();
    if (!needle) continue;
    let idx = lower.indexOf(needle);
    while (idx !== -1) {
      ranges.push([idx, idx + needle.length]);
      idx = lower.indexOf(needle, idx + needle.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Builds a snippet window around the first highlight, re-basing highlight offsets. */
export function makeSnippet(
  text: string,
  highlights: Array<[number, number]>,
  maxLength = 260,
): { text: string; highlights: Array<[number, number]> } {
  if (text.length <= maxLength) return { text, highlights };
  const anchor = highlights[0]?.[0] ?? 0;
  let start = Math.max(0, anchor - Math.floor(maxLength / 3));
  // Snap to a word boundary.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < anchor) start = space + 1;
  }
  let end = Math.min(text.length, start + maxLength);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + maxLength / 2) end = space;
  }
  const prefix = start > 0 ? '… ' : '';
  const suffix = end < text.length ? ' …' : '';
  const shifted = highlights
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]) => [a - start + prefix.length, b - start + prefix.length] as [number, number]);
  return { text: prefix + text.slice(start, end) + suffix, highlights: shifted };
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
