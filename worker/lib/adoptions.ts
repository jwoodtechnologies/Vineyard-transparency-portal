/**
 * Which ordinances and resolutions a motion in the minutes adopted. Pure, unit-tested.
 *
 * A motion adopts a numbered measure when it carried, it was made by the body that adopts that
 * series (City Council: ordinances and resolutions; Redevelopment Agency board: RDA resolutions), its
 * wording adopts or approves (not continues, tables, strikes, denies or recommends), and the number
 * is written in the motion itself ("approve Ordinance 2026-09, Stormwater Management Code Update",
 * "Adopt Resolution 202618", "Adopt resolution u202604") or in the consent items a consent motion
 * approved. Numbers the minutes only mention nearby are not counted as adopted.
 */
import { normalizeNumber, type NumberedKind } from '../../src/lib/recordTitle';

export interface MotionRow {
  id?: string;
  body_id: string | null;
  meeting_date: string | null;
  motion: string | null;
  items?: string | null;
  result: string | null;
  tally?: string | null;
  unanimous?: number | null;
  document_id: string;
  page: number | null;
}

export interface Adoption {
  kind: NumberedKind;
  number: string;
  date: string | null;
  motion: string;
  tally: string | null;
  unanimous: boolean;
  documentId: string;
  page: number | null;
  /** The number came from a consent item list, not the motion's own words. */
  consent: boolean;
}

const NUM = /\b(ordinance|ord|resolution|res)\b\.?\s*(?:no\.?\s*|number\s*|#\s*)?(?:rda[-\s]?|u-?)?((?:19|20)\d{2})\s*-?\s*(\d{1,3})([A-Z]?)\b/gi;
const ADOPTS = /\b(adopt\w*|approv\w*|aprove\w*|pass\w*|enact\w*)\b/i;
const NOT_ADOPTING = /\b(continu\w*|table[sd]?|tabling|postpone\w*|strike|struck|den(y|ied|ial)|reconsider\w*|recommend\w*|forward\w*|remand\w*|reject\w*)\b/i;

const kindFor = (word: string, body: string | null): NumberedKind | null => {
  const ord = /^ord/i.test(word);
  if (body === 'redevelopment-agency') return ord ? null : 'rda-resolution';
  if (body === 'city-council') return ord ? 'ordinance' : 'resolution';
  return null;
};

/** The numbered measures a text names, for the series the body adopts; numbers years from the meeting are left out. */
export function motionNumbers(text: string, body: string | null, year: number | null): Array<{ kind: NumberedKind; number: string }> {
  const out: Array<{ kind: NumberedKind; number: string }> = [];
  for (const m of text.replace(/[\u2012-\u2015]/g, '-').matchAll(NUM)) {
    const kind = kindFor(m[1], body);
    if (!kind) continue;
    const y = Number(m[2]);
    // A number years away from the meeting is a misread (or a measure only cited), never this meeting's adoption.
    if (year && Math.abs(y - year) > 1) continue;
    const number = normalizeNumber(m[2], m[3], m[4]);
    if (!out.some((x) => x.kind === kind && x.number === number)) out.push({ kind, number });
  }
  return out;
}

export function adoptionsFrom(row: MotionRow): Adoption[] {
  if (row.result !== 'carried') return [];
  const text = (row.motion ?? '').replace(/\s+/g, ' ').trim();
  if (!text || !ADOPTS.test(text) || NOT_ADOPTING.test(text)) return [];
  const year = row.meeting_date ? Number(row.meeting_date.slice(0, 4)) : null;
  const base = { date: row.meeting_date, motion: text, tally: row.tally ?? null, unanimous: Number(row.unanimous ?? 0) === 1, documentId: row.document_id, page: row.page ?? null };
  const own = motionNumbers(text, row.body_id, year).map((n) => ({ ...n, ...base, consent: false }));
  if (own.length || !/consent/i.test(text) || !row.items) return own;
  let items: string[];
  try {
    items = (JSON.parse(row.items) as unknown[]).filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
  return items.flatMap((it) => motionNumbers(it, row.body_id, year)).map((n) => ({ ...n, ...base, consent: true }));
}

/** One adoption per measure: the motion that names it beats a consent list; the earliest meeting wins a tie. */
export function adoptionMap(rows: MotionRow[]): Map<string, Adoption> {
  const map = new Map<string, Adoption>();
  for (const r of rows)
    for (const a of adoptionsFrom(r)) {
      const key = `${a.kind}|${a.number}`;
      const have = map.get(key);
      if (!have || (have.consent && !a.consent) || (have.consent === a.consent && (a.date ?? '9999') < (have.date ?? '9999'))) map.set(key, a);
    }
  return map;
}

export const adoptionKey = (kind: NumberedKind, number: string) => `${kind}|${number}`;
