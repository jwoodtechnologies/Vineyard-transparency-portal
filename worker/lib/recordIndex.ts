/**
 * Numbered indexes of ordinances, resolutions and RDA resolutions by year. Pure, unit-tested.
 *
 * Rows come from two places: adopting motions in the minutes (worker/lib/adoptions.ts) and the
 * archive's documents carrying a number. A number known only because the minutes cite it (no
 * document, no adopting motion read) shows as "Not in the archive". Every number from 1 to the
 * highest held for the year is a row: a number the archive holds nothing for is a plain "absent"
 * row, never a guessed title.
 *
 * The vote on a row is, in order: the motion whose own words adopt the number; a carried motion
 * made on an agenda item that names the number; a motion another record ties to the number
 * (`linked`, e.g. the budget ordinance); a motion naming the number that was set aside and then
 * brought back and carried with no new wording. Tallies are shown as the minutes record them.
 *
 * A title that is only the number ("Ordinance 2026-07") is filled from the agenda item wording
 * (the document's agenda description, or the motion's agenda item) when it names the number,
 * else the adopting motion, else the document's own title text.
 */
import { displayTitle, numberedKindOf, recordNumberOf, recordStatus, MUNICIPAL_CODE_SOURCE, type NumberedKind, type RecordStatus } from '../../src/lib/recordTitle';
import { motionNumbers, type Adoption } from './adoptions';

export interface IndexDoc {
  id: string;
  title: string;
  description?: string | null;
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

/** A motion from the minutes of the body that adopts the series. */
export interface IndexMotion {
  id: string;
  body_id: string | null;
  meeting_date: string | null;
  seq: number | null;
  item: string | null;
  motion: string | null;
  result: string | null;
  tally: string | null;
  unanimous: number | null;
  document_id: string;
  page: number | null;
}

/** A motion another record ties to a number (the minutes do not print it). */
export interface IndexLink {
  kind: NumberedKind;
  number: string;
  motionId: string;
}

export interface IndexRow {
  number: string;
  title: string | null;
  /** The adoption date: the adopting meeting's date from the minutes, else the date printed in the adopted copy. */
  adoptedOn: string | null;
  adoptedFrom: 'minutes' | 'document' | null;
  tally: string | null;
  unanimous: boolean;
  /** The result of the motion found for the number ('carried'), or null when no motion is in the archive. */
  vote: 'carried' | null;
  minutes: { documentId: string; page: number | null } | null;
  document: { id: string; title: string; status: RecordStatus | null } | null;
  /**
   * adopted: an adopting motion or the city's adopted copy; listed: a document only; missing: cited in
   * minutes, not in the archive; absent: a number below the year's highest that nothing in the archive names.
   */
  state: 'adopted' | 'listed' | 'missing' | 'absent';
}

export interface RecordIndex {
  kind: NumberedKind;
  year: number | null;
  years: Array<{ year: number; count: number }>;
  rows: IndexRow[];
}

/**
 * Records filed under one series whose own text shows another. Source for each: the document's text, page 1.
 *   doc_0bc5fd0251d5a6d3 "8.4.26 Draft RES 2026-07" reads "ORDINANCE NO. 2026-07 AN ORDINANCE OF THE CITY OF
 *   VINEYARD CITY, UTAH, AMENDING THE VINEYARD SUBDIVISION CODE ..." (a draft of Ordinance 2026-07, not a resolution).
 */
export const SERIES_OVERRIDES: Record<string, { kind: NumberedKind; number: string }> = {
  doc_0bc5fd0251d5a6d3: { kind: 'ordinance', number: '2026-07' },
};

const numSort = (a: string, b: string) => {
  const [, x = '0', xs = ''] = a.match(/^\d{4}-(\d+)([A-Z]?)$/) ?? [];
  const [, y = '0', ys = ''] = b.match(/^\d{4}-(\d+)([A-Z]?)$/) ?? [];
  return Number(x) - Number(y) || xs.localeCompare(ys);
};
const seqOf = (n: string) => Number(n.match(/^\d{4}-(\d+)/)?.[1] ?? 0);

/** Which copy of a measure the index links: the adopted copy from the code books, then a final copy, then the newest packet copy. */
function rank(d: IndexDoc, status: RecordStatus | null, attached: boolean): number {
  if (d.source_id === MUNICIPAL_CODE_SOURCE) return 0;
  if (status !== 'draft' && !attached) return 1;
  if (status !== 'draft') return 2;
  return 3;
}

const clip = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 3).replace(/\s+\S*$/, '')}...` : t);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const noDash = (s: string) => s.replace(/\s*[\u2012-\u2015]\s*/g, (m) => (/\s/.test(m) ? ' - ' : '-'));

const shortMotion = (m: string) => cap(clip(noDash(m).replace(/\s+/g, ' ').trim()));

/** The title without the series and number it starts with ("Ordinance 2026-09, Stormwater" reads "Stormwater"). */
const subject = (title: string) => title.replace(/^(?:RDA\s+)?(?:Ordinance|Resolution)\s+(?:No\.?\s*)?(?:RDA[-\s]?|U-?)?(?:19|20)\d{2}-\d{1,3}[A-Z]?\s*[,:-]?\s*/i, '').trim();

const SERIES = String.raw`(?:(?:approve|adopt|accept|consider|discuss(?:ion and action)?|discussion and action:?)\s+)?(?:RDA\s+)?(?:ordinance|ord|resolution|res)\b\.?\s*(?:no\.?\s*)?(?:rda[-\s;]?|u-?)?(?:19|20)\d{2}\s*[-\u2012-\u2015]?\s*\d{1,3}[A-Z]?\b`;

/**
 * An agenda item's wording as a title: no item number, no leading "Approve Ordinance 2026-07", no
 * trailing "(Anthony Fletcher)" or "(Resolution 2026-13)", no markup. The words are otherwise as recorded.
 */
export function agendaTitle(s: string): string {
  let t = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^\d+(?:\.\d+)*\.?\s+/, '');
  t = t.replace(new RegExp(`^${SERIES}\\s*[,:-]?\\s*`, 'i'), '');
  t = t.replace(/^to\s+/i, '');
  while (/\s*\([^()]*\)\s*$/.test(t)) t = t.replace(/\s*\([^()]*\)\s*$/, '');
  t = noDash(t).replace(/[.;,\s]+$/, '').trim();
  return t ? cap(t) : '';
}

const SMALL = new Set('a an and as at by for from in into of on or the to with within'.split(' '));
/**
 * The title a measure prints for itself: "AN ORDINANCE OF THE CITY OF VINEYARD CITY, UTAH, AMENDING THE ..."
 * reads "Amending the ...". Upper case words are set in title case; short acronyms stay as printed.
 */
export function ownTitle(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ');
  const m = flat.match(/\bAN?\s+(?:ORDINANCE|RESOLUTION)\s+OF\s+THE\s+(.{0,900}?)(?:\.\s|;|\bWHEREAS\b|$)/i);
  if (!m) return null;
  // The preamble names who adopts it, ending at "UTAH" (", STATE OF UTAH") or "AGENCY".
  const rest = m[1].replace(/^.*?\b(?:UTAH(?:\s+COUNTY)?(?:,\s*STATE\s+OF\s+UTAH)?|AGENCY)\b,?\s*/i, '').trim();
  if (rest.length < 8) return null;
  const words = rest.split(' ').map((w, i) => {
    if (/[a-z]/.test(w)) return w;
    const core = w.replace(/[^A-Za-z0-9]/g, '');
    if (/^(RDA|HTRZ|UDOT|FY|LLC|UPDES|MS4|SB|PID|CDA|CRA|ADU|DADU|CPA|CFE|CIA|AUP|II|III|IV)$/.test(core) || /\d/.test(core)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower.replace(/[^a-z]/g, ''))) return lower;
    return lower.replace(/^([^a-z]*)([a-z])/, (_, p: string, c: string) => p + c.toUpperCase());
  });
  return clip(noDash(words.join(' ')).replace(/[.;,\s]+$/, ''));
}

/** A motion that adopts what its agenda item names: carried, adopting wording, not set aside. */
const ITEM_ADOPTS = /\b(adopt\w*|approv\w*|aprove\w*|pass\w*|enact\w*|accept\w*)\b/i;
const ITEM_NOT = /\b(continu\w*|table[sd]?|tabling|postpone\w*|strike|struck|den(y|ied|ial)|reconsider\w*|recommend\w*|forward\w*|remand\w*|reject\w*|pull\w*|public hearing|minutes)\b/i;

function itemVote(m: IndexMotion, kind: NumberedKind, number: string): boolean {
  if (m.result !== 'carried' || !m.item) return false;
  const year = m.meeting_date ? Number(m.meeting_date.slice(0, 4)) : null;
  const inItem = motionNumbers(m.item, m.body_id, year).filter((x) => x.kind === kind);
  if (inItem.length !== 1 || inItem[0].number !== number) return false;
  const text = (m.motion ?? '').replace(/\s+/g, ' ').trim();
  if (!text || !ITEM_ADOPTS.test(text) || ITEM_NOT.test(text)) return false;
  // The motion names another measure of the series: it is not this item's vote.
  if (motionNumbers(text, m.body_id, year).some((x) => x.kind === kind && x.number !== number)) return false;
  // The motion names other agenda items ("approve items 7.1 and 7.2") and not this one.
  const own = m.item.match(/^(\d+(?:\.\d+)+)/)?.[1];
  const named: string[] = text.match(/\b\d+\.\d+\b/g) ?? [];
  if (named.length && own && !named.includes(own)) return false;
  return true;
}

/** A motion naming the number that was set aside, then brought back and carried with no new wording, in the same minutes. */
function broughtBack(motions: IndexMotion[], kind: NumberedKind, number: string): { named: IndexMotion; carried: IndexMotion } | null {
  for (const m of motions) {
    if (m.result === 'carried' || m.result === 'failed' || !m.motion) continue;
    const year = m.meeting_date ? Number(m.meeting_date.slice(0, 4)) : null;
    if (!motionNumbers(m.motion, m.body_id, year).some((x) => x.kind === kind && x.number === number)) continue;
    const next = motions
      .filter((x) => x.document_id === m.document_id && (x.seq ?? 0) > (m.seq ?? 0) && x.item === m.item && x.result === 'carried' && !(x.motion ?? '').trim())
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0];
    if (next) return { named: m, carried: next };
  }
  return null;
}

interface Vote {
  date: string | null;
  tally: string | null;
  unanimous: boolean;
  documentId: string;
  page: number | null;
  item: string | null;
  motion: string;
}

const fromMotion = (m: IndexMotion, page = m.page): Vote => ({
  date: m.meeting_date,
  tally: m.tally ?? null,
  unanimous: Number(m.unanimous ?? 0) === 1,
  documentId: m.document_id,
  page: page ?? null,
  item: m.item,
  motion: (m.motion ?? '').trim(),
});

function voteFor(kind: NumberedKind, number: string, motions: IndexMotion[], links: IndexLink[]): Vote | null {
  const byItem = motions.filter((m) => itemVote(m, kind, number)).sort((a, b) => (a.meeting_date ?? '9999').localeCompare(b.meeting_date ?? '9999'));
  if (byItem[0]) return fromMotion(byItem[0]);
  const link = links.find((l) => l.kind === kind && l.number === number);
  const linked = link ? motions.find((m) => m.id === link.motionId && m.result === 'carried') : undefined;
  if (linked) return fromMotion(linked);
  const back = broughtBack(motions, kind, number);
  if (back) return { ...fromMotion(back.carried, back.carried.page ?? back.named.page), motion: (back.named.motion ?? '').trim() };
  return null;
}

export function buildIndex(
  kind: NumberedKind,
  year: number | null,
  docs: IndexDoc[],
  adoptions: Adoption[],
  refs: IndexRef[],
  motions: IndexMotion[] = [],
  links: IndexLink[] = [],
  textTitles: Map<string, string> = new Map(),
): RecordIndex {
  const byNumber = new Map<string, { docs: Array<{ d: IndexDoc; status: RecordStatus | null; attached: boolean; title: string }>; adoption?: Adoption; ref?: IndexRef }>();
  const slot = (n: string) => byNumber.get(n) ?? byNumber.set(n, { docs: [] }).get(n)!;
  const adopted = new Map(adoptions.filter((a) => a.kind === kind).map((a) => [a.number, a]));
  for (const d of docs) {
    const input = { title: d.title, documentType: d.document_type, date: d.document_date, documentNumber: d.document_number, governmentBodyId: d.government_body_id, governmentBodyName: d.government_body_name, sourceId: d.source_id, agendaItemId: d.agenda_item_id };
    const override = SERIES_OVERRIDES[d.id];
    if ((override?.kind ?? numberedKindOf(input)) !== kind) continue;
    const n = override?.number ?? recordNumberOf(input);
    // "U-2026-0X" is a placeholder in a draft's file name, not a number.
    if (!n || seqOf(n) === 0) continue;
    const shown = displayTitle(input);
    const status = recordStatus(input, adopted.has(n), shown);
    slot(n).docs.push({ d, status, attached: shown.attached, title: shown.title });
  }
  for (const a of adopted.values()) slot(a.number).adoption = a;
  for (const r of refs) if (!byNumber.has(r.number)) slot(r.number).ref = r;

  const all: IndexRow[] = [];
  for (const [number, s] of byNumber) {
    const ordered = [...s.docs].sort((x, y) => rank(x.d, x.status, x.attached) - rank(y.d, y.status, y.attached) || (y.d.document_date ?? '').localeCompare(x.d.document_date ?? ''));
    const best = ordered[0];
    const code = s.docs.find((x) => x.d.source_id === MUNICIPAL_CODE_SOURCE);
    const a = s.adoption;
    const v: Vote | null = a ? { date: a.date, tally: a.tally, unanimous: a.unanimous, documentId: a.documentId, page: a.page, item: null, motion: a.motion } : voteFor(kind, number, motions, links);
    const adoptedOn = v?.date ?? code?.d.document_date ?? null;

    // The title: a document's own subject, else the agenda item wording that names the number, else the motion, else the document's text.
    const named = (t: string | null | undefined) => {
      if (!t) return '';
      const y = Number(number.slice(0, 4));
      return motionNumbers(t, kind === 'rda-resolution' ? 'redevelopment-agency' : 'city-council', y).some((x) => x.kind === kind && x.number === number) ? agendaTitle(t) : '';
    };
    const title =
      ordered.map((x) => subject(x.title)).find(Boolean) ||
      ordered.map((x) => named(x.d.description)).find(Boolean) ||
      named(v?.item) ||
      (v && !best && v.motion ? shortMotion(v.motion) : '') ||
      ordered.map((x) => textTitles.get(x.d.id)).find(Boolean) ||
      (best ? best.title : v?.motion ? shortMotion(v.motion) : null);

    all.push({
      number,
      title,
      adoptedOn,
      adoptedFrom: v?.date ? 'minutes' : code?.d.document_date ? 'document' : null,
      tally: v?.tally ?? null,
      unanimous: Boolean(v?.unanimous),
      vote: v ? 'carried' : null,
      minutes: v ? { documentId: v.documentId, page: v.page } : s.ref ? { documentId: s.ref.documentId, page: s.ref.page } : null,
      document: best ? { id: best.d.id, title: best.title, status: best.status } : null,
      state: a || v || code ? 'adopted' : best ? 'listed' : 'missing',
    });
  }
  const yearOf = (n: string) => Number(n.slice(0, 4));
  const counts = new Map<number, number>();
  for (const r of all) counts.set(yearOf(r.number), (counts.get(yearOf(r.number)) ?? 0) + 1);
  const years = [...counts.entries()].map(([y, count]) => ({ year: y, count })).sort((a, b) => b.year - a.year);
  const chosen = year && counts.has(year) ? year : (years[0]?.year ?? null);
  const rows = all.filter((r) => yearOf(r.number) === chosen);
  // Every number from 1 to the highest the archive holds a record or an adopting motion for.
  const held = new Set(rows.map((r) => seqOf(r.number)));
  const top = Math.max(0, ...rows.filter((r) => r.state !== 'missing').map((r) => seqOf(r.number)));
  for (let i = 1; i < top; i++)
    if (!held.has(i))
      rows.push({ number: `${chosen}-${String(i).padStart(2, '0')}`, title: null, adoptedOn: null, adoptedFrom: null, tally: null, unanimous: false, vote: null, minutes: null, document: null, state: 'absent' });
  return { kind, year: chosen, years, rows: rows.sort((a, b) => numSort(a.number, b.number)) };
}

/** Documents whose index title is only their number, for reading their own title from the text. */
export function numberOnlyDocs(index: RecordIndex): string[] {
  return index.rows.filter((r) => r.document && r.title === r.document.title && !subject(r.document.title)).map((r) => r.document!.id);
}
