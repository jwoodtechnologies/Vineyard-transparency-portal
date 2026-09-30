/**
 * Turns user input into a safe SQLite FTS5 MATCH expression.
 *
 * User text is never spliced into FTS syntax directly: every term and phrase is emitted as an
 * FTS5 string literal ("..." with embedded quotes doubled), so operators, column filters and
 * parentheses typed by a user are treated as plain words. The only syntax we emit ourselves is
 * AND / OR / NOT-free combinations, an optional trailing * prefix marker the user typed, and an
 * optional doc_title column filter for title-only search.
 */
import type { DocumentType, QueryInterpretation, SearchMatchMode } from '../../src/types/models';

export interface ParsedQuery {
  fts: string | null;
  interpretation: QueryInterpretation;
  /** Lower-cased words used for match explanations and highlighting. */
  words: string[];
}

const STOPWORDS = new Set(
  'a an and are as at be been by did do does for from had has have how i in is it its of on or that the their them there these this those to was were what when where which who why will with would about into can could should any all our we you your me my show find tell list give'.split(' '),
);

const TYPE_HINTS: Array<[RegExp, DocumentType]> = [
  [/\bagenda packets?\b/i, 'agenda_packet'],
  [/\bagendas?\b/i, 'agenda'],
  [/\bminutes\b/i, 'minutes'],
  [/\bordinances?\b/i, 'ordinance'],
  [/\bresolutions?\b/i, 'resolution'],
  [/\bbudgets?\b/i, 'budget'],
  [/\baudits?\b/i, 'audit'],
  [/\bdevelopment agreements?\b/i, 'development_agreement'],
  [/\bcontracts?\b/i, 'contract'],
  [/\bpublic notices?\b/i, 'public_notice'],
];

const DOC_NUMBER = /\b(ordinance|resolution|ord\.?|res\.?)\s*(?:no\.?|number|#)?\s*(\d{2,4}\s*[-–]\s*\d{1,4}[a-z]?)\b/i;

const literal = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** Split on anything FTS5's unicode61 tokenizer would split on. */
function tokens(s: string): string[] {
  return s
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}*]+/u)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function parseQuery(raw: string, opts: { match?: SearchMatchMode; titleOnly?: boolean; dropStopwords?: boolean } = {}): ParsedQuery {
  const input = raw.slice(0, 500);
  const match = opts.match ?? 'all';
  const phrases: string[] = [];
  let rest = input.replace(/"([^"]{1,200})"/g, (_m, p: string) => {
    const words = tokens(p).map((w) => w.replace(/\*/g, ''));
    if (words.length) phrases.push(words.join(' '));
    return ' ';
  });

  let documentNumber: string | null = null;
  const num = DOC_NUMBER.exec(rest);
  if (num) {
    const kind = num[1].toLowerCase().startsWith('res') ? 'Resolution' : 'Ordinance';
    const n = num[2].replace(/\s+/g, '').replace('–', '-');
    documentNumber = `${kind} ${n}`;
    phrases.push(n.replace('-', ' '));
    rest = rest.replace(num[0], ` ${num[1]} `);
  }

  // Hyphenated or dotted identifiers ("2026-07", "9.15.26") become phrases so their parts stay adjacent.
  rest = rest.replace(/\b\d+(?:[-./]\d+)+\b/g, (m) => {
    phrases.push(tokens(m.replace(/[-./]/g, ' ')).join(' '));
    return ' ';
  });

  let terms = tokens(rest);
  const dropStop = opts.dropStopwords ?? match !== 'phrase';
  if (dropStop) {
    const kept = terms.filter((t) => !STOPWORDS.has(t.toLowerCase().replace(/\*$/, '')));
    if (kept.length || phrases.length) terms = kept;
  }
  terms = [...new Set(terms)].slice(0, 16);

  const yearMatch = /\b(19[5-9]\d|20\d{2})\b/.exec(input);
  const hint = TYPE_HINTS.find(([re]) => re.test(input));

  const interpretation: QueryInterpretation = {
    phrases,
    terms: terms.map((t) => t.replace(/\*$/, '')),
    documentNumber,
    detectedYear: yearMatch ? Number(yearMatch[1]) : null,
    detectedDocumentType: hint ? hint[1] : null,
  };

  const termExpr = (t: string): string => {
    const prefix = t.endsWith('*') && t.replace(/\*+$/, '').length >= 2;
    const word = t.replace(/\*+/g, '');
    return word ? `${literal(word)}${prefix ? '*' : ''}` : '';
  };

  let parts: string[];
  if (match === 'phrase') {
    const all = [...phrases, ...terms.map((t) => t.replace(/\*/g, ''))].join(' ').trim();
    parts = all ? [literal(all)] : [];
  } else {
    parts = [...phrases.map(literal), ...terms.map(termExpr)].filter(Boolean);
  }

  let fts: string | null = null;
  if (parts.length) {
    const joined = parts.join(match === 'any' ? ' OR ' : ' AND ');
    fts = opts.titleOnly ? `doc_title : (${joined})` : joined;
  }

  const words = [...phrases.flatMap((p) => p.split(' ')), ...interpretation.terms].map((w) => w.toLowerCase());
  return { fts, interpretation, words: [...new Set(words)] };
}

/** Converts an FTS5 snippet() result that uses \u0002/\u0003 markers into text + highlight ranges. */
export function parseSnippet(snippet: string): { text: string; highlights: Array<[number, number]> } {
  let text = '';
  const highlights: Array<[number, number]> = [];
  let start = -1;
  for (const ch of snippet) {
    if (ch === '\u0002') start = text.length;
    else if (ch === '\u0003') {
      if (start >= 0 && text.length > start) highlights.push([start, text.length]);
      start = -1;
    } else text += ch;
  }
  return { text, highlights };
}

/** 32-bit FNV-1a, used for deterministic shard assignment. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
