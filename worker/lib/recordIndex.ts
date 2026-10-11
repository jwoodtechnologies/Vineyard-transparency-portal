/**
 * Numbered indexes of ordinances, resolutions and RDA resolutions by year. Pure, unit-tested.
 *
 * Rows come from two places: adopting motions in the minutes (worker/lib/adoptions.ts) and the
 * archive's documents carrying a number. A number known only because the minutes cite it (no
 * document, no adopting motion read) shows as "Not in the archive". Numbers known from nowhere are
 * never guessed: the index lists what exists.
 */
import { displayTitle, numberedKindOf, recordNumberOf, recordStatus, MUNICIPAL_CODE_SOURCE, type NumberedKind, type RecordStatus } from '../../src/lib/recordTitle';
import type { Adoption } from './adoptions';

export interface IndexDoc {
  id: string;
  title: string;
  document_type: string;
  document_number: string | null;
  document_date: string | null;
  year: number | null;
  government_body_id: string | null;
  government_body_name: string | null;
  source_id: string | null;
  agenda_item_id: string | null;
}

export interface IndexRef {
  number: string;
  date: string | null;
  documentId: string;
  page: number | null;
}

export interface IndexRow {
  number: string;
  title: string | null;
  /** The adoption date: the adopting meeting's date from the minutes, else the date printed in the adopted copy. */
  adoptedOn: string | null;
  adoptedFrom: 'minutes' | 'document' | null;
  tally: string | null;
  unanimous: boolean;
  minutes: { documentId: string; page: number | null } | null;
  document: { id: string; title: string; status: RecordStatus | null } | null;
  /** adopted: an adopting motion or the city's adopted copy; listed: a document only; missing: cited in minutes, not in the archive. */
  state: 'adopted' | 'listed' | 'missing';
}

export interface RecordIndex {
  kind: NumberedKind;
  year: number | null;
  years: Array<{ year: number; count: number }>;
  rows: IndexRow[];
}

const numSort = (a: string, b: string) => {
  const [, x = '0', xs = ''] = a.match(/^\d{4}-(\d+)([A-Z]?)$/) ?? [];
  const [, y = '0', ys = ''] = b.match(/^\d{4}-(\d+)([A-Z]?)$/) ?? [];
  return Number(x) - Number(y) || xs.localeCompare(ys);
};

/** Which copy of a measure the index links: the adopted copy from the code books, then a final copy, then the newest packet copy. */
function rank(d: IndexDoc, status: RecordStatus | null, attached: boolean): number {
  if (d.source_id === MUNICIPAL_CODE_SOURCE) return 0;
  if (status !== 'draft' && !attached) return 1;
  if (status !== 'draft') return 2;
  return 3;
}

const shortMotion = (m: string) => {
  const t = m.replace(/\s+/g, ' ').trim();
  const s = t.length > 140 ? `${t.slice(0, 137).replace(/\s+\S*$/, '')}...` : t;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The title without the series and number it starts with ("Ordinance 2026-09, Stormwater" reads "Stormwater"). */
const subject = (title: string) => title.replace(/^(?:RDA\s+)?(?:Ordinance|Resolution)\s+(?:No\.?\s*)?(?:RDA[-\s]?|U-?)?(?:19|20)\d{2}-\d{1,3}[A-Z]?\s*[,:-]?\s*/i, '').trim();

export function buildIndex(kind: NumberedKind, year: number | null, docs: IndexDoc[], adoptions: Adoption[], refs: IndexRef[]): RecordIndex {
  const byNumber = new Map<string, { docs: Array<{ d: IndexDoc; status: RecordStatus | null; attached: boolean; title: string }>; adoption?: Adoption; ref?: IndexRef }>();
  const slot = (n: string) => byNumber.get(n) ?? byNumber.set(n, { docs: [] }).get(n)!;
  const adopted = new Map(adoptions.filter((a) => a.kind === kind).map((a) => [a.number, a]));
  for (const d of docs) {
    const input = { title: d.title, documentType: d.document_type, date: d.document_date, documentNumber: d.document_number, governmentBodyId: d.government_body_id, governmentBodyName: d.government_body_name, sourceId: d.source_id, agendaItemId: d.agenda_item_id };
    if (numberedKindOf(input) !== kind) continue;
    const n = recordNumberOf(input);
    if (!n) continue;
    const shown = displayTitle(input);
    const status = recordStatus(input, adopted.has(n), shown);
    slot(n).docs.push({ d, status, attached: shown.attached, title: shown.title });
  }
  for (const a of adopted.values()) slot(a.number).adoption = a;
  for (const r of refs) if (!byNumber.has(r.number)) slot(r.number).ref = r;

  const all: IndexRow[] = [];
  for (const [number, s] of byNumber) {
    const best = [...s.docs].sort((x, y) => rank(x.d, x.status, x.attached) - rank(y.d, y.status, y.attached) || (y.d.document_date ?? '').localeCompare(x.d.document_date ?? ''))[0];
    const code = s.docs.find((x) => x.d.source_id === MUNICIPAL_CODE_SOURCE);
    const a = s.adoption;
    const adoptedOn = a?.date ?? code?.d.document_date ?? null;
    all.push({
      number,
      title: best ? subject(best.title) || best.title : a ? shortMotion(a.motion) : null,
      adoptedOn,
      adoptedFrom: a?.date ? 'minutes' : code?.d.document_date ? 'document' : null,
      tally: a?.tally ?? null,
      unanimous: Boolean(a?.unanimous),
      minutes: a ? { documentId: a.documentId, page: a.page } : s.ref ? { documentId: s.ref.documentId, page: s.ref.page } : null,
      document: best ? { id: best.d.id, title: best.title, status: best.status } : null,
      state: a || code ? 'adopted' : best ? 'listed' : 'missing',
    });
  }
  const yearOf = (n: string) => Number(n.slice(0, 4));
  const counts = new Map<number, number>();
  for (const r of all) counts.set(yearOf(r.number), (counts.get(yearOf(r.number)) ?? 0) + 1);
  const years = [...counts.entries()].map(([y, count]) => ({ year: y, count })).sort((a, b) => b.year - a.year);
  const chosen = year && counts.has(year) ? year : (years[0]?.year ?? null);
  return { kind, year: chosen, years, rows: all.filter((r) => yearOf(r.number) === chosen).sort((a, b) => numSort(a.number, b.number)) };
}
