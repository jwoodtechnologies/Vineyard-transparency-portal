/**
 * Deterministic metadata extraction (no AI): document numbers, dates, titles, document type.
 *
 * Rules:
 *  - A document number is only assigned when it is PRINTED in the title or on the first page
 *    ("Never inferred" — see Document.documentNumber). Other numbers found in the text are kept as
 *    references, not as the record's identity.
 *  - Numeric dates are read as U.S. month/day/year (the convention used by Utah municipalities).
 *    Two-digit years are expanded to 20xx when < 70, otherwise 19xx.
 */
import type { DocumentType, ISODate } from '../../src/types/models';
import { documentTypeHint } from './classify';

export interface DocumentNumberMatch {
  kind: 'ordinance' | 'resolution';
  /** Number exactly as printed, dash-normalized (e.g. "2026-07"). */
  number: string;
  /** Canonical label, e.g. "Ordinance 2026-07". */
  label: string;
  raw: string;
  index: number;
}

const DOC_NUMBER_RE =
  /\b(ordinances?|resolutions?|ord\.|res\.)\s*(?:no\.?|number|num\.?|#)?\s*:?\s*((?:19|20)?\d{2}\s*[-–—]\s*\d{1,4}[a-z]?)(?![\d-])/gi;

export function extractDocumentNumbers(text: string): DocumentNumberMatch[] {
  const out: DocumentNumberMatch[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DOC_NUMBER_RE)) {
    const word = m[1].toLowerCase();
    const kind: DocumentNumberMatch['kind'] = word.startsWith('ord') ? 'ordinance' : 'resolution';
    const number = m[2].replace(/\s+/g, '').replace(/[–—]/g, '-').toUpperCase();
    const label = `${kind === 'ordinance' ? 'Ordinance' : 'Resolution'} ${number}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ kind, number, label, raw: m[0], index: m.index ?? 0 });
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export interface DateMatch {
  iso: ISODate;
  raw: string;
  index: number;
}

function toIso(year: number, month: number, day: number): ISODate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function expandYear(y: string): number {
  const n = Number(y);
  if (y.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

const MONTH_NAME_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
const NUMERIC_US_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g;
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

export function extractDates(text: string): DateMatch[] {
  const out: DateMatch[] = [];
  for (const m of text.matchAll(MONTH_NAME_RE)) {
    const key = m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3);
    const iso = toIso(Number(m[3]), MONTHS[key] ?? MONTHS[key.slice(0, 3)], Number(m[2]));
    if (iso) out.push({ iso, raw: m[0], index: m.index ?? 0 });
  }
  for (const m of text.matchAll(ISO_RE)) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) out.push({ iso, raw: m[0], index: m.index ?? 0 });
  }
  for (const m of text.matchAll(NUMERIC_US_RE)) {
    const iso = toIso(expandYear(m[3]), Number(m[1]), Number(m[2]));
    if (iso) out.push({ iso, raw: m[0], index: m.index ?? 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Title heuristics: explicit title > PDF metadata title > first substantial line of page 1 > file name. */
export function chooseTitle(options: { explicit?: string | null; pdfTitle?: string | null; firstPageText?: string | null; fileName: string }): string {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const explicit = clean(options.explicit);
  if (explicit.length >= 3 && !/^(download|view|pdf|click here|here|open|link)$/i.test(explicit)) return explicit.slice(0, 300);
  const pdfTitle = clean(options.pdfTitle);
  if (pdfTitle.length >= 4 && !/^(untitled|microsoft word|document\d*|\S+\.(docx?|pdf))/i.test(pdfTitle)) return pdfTitle.slice(0, 300);
  const firstLine = (options.firstPageText ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length >= 6 && /[a-z]/i.test(l));
  if (firstLine) return firstLine.slice(0, 200);
  return options.fileName.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').trim() || options.fileName;
}

/**
 * Document type: an adapter/crawler hint wins; otherwise title, then the first ~600 characters of
 * page 1. Returns 'other' when nothing matches (never guesses beyond the heuristics).
 */
export function detectDocumentType(options: { hint?: DocumentType | null; title: string; firstPageText?: string | null; url?: string }): DocumentType {
  if (options.hint) return options.hint;
  const fromTitle = documentTypeHint(options.url ?? '', options.title);
  if (fromTitle) return fromTitle;
  const fromText = documentTypeHint('', (options.firstPageText ?? '').slice(0, 600));
  return fromText ?? 'other';
}

/** Document number for the record's identity: printed in the title or on page 1, matching the type. */
export function identityDocumentNumber(documentType: DocumentType, title: string, firstPageText: string): string | null {
  if (documentType !== 'ordinance' && documentType !== 'resolution') return null;
  const matches = [...extractDocumentNumbers(title), ...extractDocumentNumbers(firstPageText.slice(0, 2000))];
  return matches.find((m) => m.kind === documentType)?.label ?? null;
}
