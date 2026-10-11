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
 * brought back and carried with no new wording. The tally is the one the minutes print for that
 * motion, else the roll call recorded for it (members voting yes to no); a carried motion with
 * neither reads "Carried".
 *
 * Status: Adopted with a carried motion for the number (or the city's adopted copy in the code
 * books); otherwise Draft when a draft copy is held; otherwise no adoption is in the archive.
 *
 * The title, never a file name or a revision label (see fileish):
 *   1. the caption printed on the first page of the copy the index links (the adopted copy when there
 *      is one): "AN ORDINANCE ... AMENDING ..." reads "Amending ...";
 *   2. the title of the city's adopted copy in the code books;
 *   3. the agenda item wording that names the number, without "Approve Ordinance 2026-07" or the presenter;
 *   4. the subject of a filed title;
 *   5. the adopting motion's words;
 *   6. a draft's caption.
 */
import { displayTitle, numberedKindOf, recordNumberOf, recordStatus, MUNICIPAL_CODE_SOURCE, type NumberedKind, type RecordStatus } from '../../src/lib/recordTitle';
import { motionNumbers, type Adoption } from './adoptions';

export interface IndexDoc {
  id: string;
  title: string;
  /** The agenda item the file was posted with (its wording), when it came from a meeting. */
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
  /** The roll call recorded for the motion (motion_votes): members voting yes and no. */
  yes?: number | null;
  no?: number | null;
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
  /** The tally as recorded ("4-1"): printed in the minutes, else counted from the recorded roll call. */
  tally: string | null;
  unanimous: boolean;
  /** The result of the motion found for the number ('carried'), or null when no motion is in the archive. */
  vote: 'carried' | null;
  minutes: { documentId: string; page: number | null } | null;
  document: { id: string; title: string; status: RecordStatus | null } | null;
  /** adopted: a carried motion for the number, or the city's adopted copy; draft: draft copies only; none: no adoption in the archive. */
  status: 'adopted' | 'draft' | 'none';
  /** For a draft: the newest draft copy's date and the body it went to. */
  draft: { date: string | null; body: string | null } | null;
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const noDash = (s: string) => s.replace(/\s*[‒-―]\s*/g, (m) => (/\s/.test(m) ? ' - ' : '-'));

/** The title without the series and number it starts with ("Ordinance 2026-09, Stormwater" reads "Stormwater"). */
const subject = (title: string) => title.replace(/^(?:RDA\s+)?(?:Ordinance|Resolution)\s+(?:No\.?\s*)?(?:RDA[-\s]?|U-?)?(?:19|20)\d{2}-\d{1,3}[A-Z]?\s*[,:-]?\s*/i, '').trim();

const MONTH_WORD = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const FILEISH = new RegExp(
  [
    // "July 28 Revision", "Aug 4 update", "July 9 revision"
    String.raw`\b(?:${MONTH_WORD})\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?:,?\s+\d{4})?\s+(?:revision|rev\b|version|updated?\b|edits?\b|changes\b|copy\b)`,
    String.raw`\brevision\b|\bredline\b|\bclean\s+copy\b|\btracked\s+changes\b`,
    String.raw`\brev\.?\s*\d|\bv\s?\d+(?:\.\d+)*\b|\bversion\s*\d`,
    // "Draft", "FINAL", "(final)", "- Copy" as a mark on a file; inside a name ("Final Budget", "the Draft Geneva ... Plan") they stay.
    String.raw`^(?:draft|copy)\b|\b(?:draft|final|copy)\.?$|[([]\s*(?:draft|final|copy)\s*[)\]]|\b(?:attorney\s+)?reviewed\b`,
    String.raw`\.(?:pdf|docx?|xlsx?|pptx?)\b`,
    String.raw`\.\.\.|…`,
    // File-name dates: 10.01.2026, 9.3.26, 06232026 (not a code section such as 14.06.020 or 1.08.040)
    String.raw`(?<![\d.])(?:0?[1-9]|1[0-2])[./](?:0?[1-9]|[12]\d|3[01])[./](?:\d{4}|\d{2})(?![\d.])|\b\d{8}\b`,
    String.raw`_`,
  ].join('|'),
  'i',
);

/**
 * A title that reads as a file name or a revision label rather than what the measure is: "July 28 Revision",
 * "v2", "FINAL", "Draft", ".pdf", "FY26 Budget Amendment #1 Executive Offic...", "06232026", a cut-off text,
 * or only a number.
 */
export function fileish(t: string | null | undefined): boolean {
  const s = (t ?? '').trim();
  if (!s) return true;
  if (FILEISH.test(s) || /\b(?:DRAFT|FINAL|COPY)\b/.test(s)) return true;
  return /^(?:(?:RDA\s+)?(?:ordinance|resolution|ord|res)\b\.?\s*)?(?:no\.?\s*)?[\d\s./-]*$/i.test(s);
}

const SERIES_CORE = String.raw`(?:RDA\s+)?(?:ordinance|ord|resolution|res)\b\.?\s*(?:no\.?\s*|number\s*|#\s*)?(?:rda[-\s;]?|u-?)?(?:(?:19|20)\d{2}\s*[-‒-―]?|\d{2}\s*[-‒-―])\s*\d{1,3}[A-Z]?\b`;
const SERIES = String.raw`(?:(?:approve|adopt|accept|consider|discuss(?:ion and action)?|discussion and action:?)\s+)?${SERIES_CORE}`;

/**
 * An agenda item's wording as a title: no item number, no leading "Approve Ordinance 2026-07" or
 * "Public Hearing -", no trailing "(Anthony Fletcher)", "(Resolution 2026-13)" or "- Consideration of
 * Ordinance No. 2026-11", no markup. The words are otherwise as recorded.
 */
export function agendaTitle(s: string): string {
  let t = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^\d+(?:\.\d+)*\.?\s+/, '');
  t = t.replace(/^public\s+hearing\s*(?:[-:‒-―]\s*)?(?:(?:for|to)\s+(?=an?\b|consider\b))?/i, '');
  t = t.replace(/^(?:discussion\s+(?:and|&|\/)\s+(?:possible\s+)?action|action\s+item)\s*(?:on\b)?\s*[:‒-―-]?\s*/i, '');
  t = t.replace(new RegExp(`^${SERIES}\\s*[,:-]?\\s*`, 'i'), '');
  t = t.replace(/^to\s+/i, '');
  while (/\s*\([^()]*\)\s*$/.test(t)) t = t.replace(/\s*\([^()]*\)\s*$/, '');
  t = t.replace(new RegExp(`\\s*(?:[-,:;\\u2012-\\u2015]\\s*)?(?:(?:consideration|approval|adoption)\\s+of\\s+|(?:approve|adopt|consider)\\s+)?${SERIES_CORE}[.;,\\s]*$`, 'i'), '');
  t = noDash(t).replace(/[.;,\s]+$/, '').trim();
  return t ? cap(t) : '';
}

/** A motion's words as a title, without the series and number it adopts or "as presented"; none when it only names an item. */
function motionTitle(m: string): string {
  const t = agendaTitle(m.replace(/[\s,]+as (?:presented|amended|discussed|written)\b.*$/i, ''));
  if (!t || t.length > 160 || /^(?:approve|adopt|accept|item|items|the consent|consent)\b/i.test(t)) return '';
  return t;
}

const SMALL = new Set('a an and as at by for from in into of on or the to with within'.split(' '));
/** Words ending in "ing" that name who adopts a measure, not what it does. */
const NOT_VERB = /^(?:governing|planning|building|housing|zoning)$/i;
const ACRONYM = /^(RDA|HTRZ|UDOT|FY|LLC|UPDES|MS4|SB|HB|PID|CDA|CRA|ADU|DADU|CPA|CFE|CIA|AUP|NFIP|FEMA|II|III|IV|US|UT)$/;

/**
 * The caption a measure prints on its first page: "AN ORDINANCE OF THE CITY OF VINEYARD CITY, UTAH, AMENDING THE ..."
 * reads "Amending the ...". The preamble naming who adopts it ("OF THE CITY COUNCIL OF THE CITY OF VINEYARD, UTAH,",
 * "OF THE VINEYARD CITY COUNCIL", "OF THE BOARD OF DIRECTORS OF THE ... AGENCY") is left out. Upper case words are set
 * in title case; acronyms and section numbers stay as printed. The whole caption, never cut short.
 */
export function ownTitle(text: string): string | null {
  const src = text.replace(/[‘’]/g, "'");
  const flat = src.replace(/\s+/g, ' ');
  const END = String.raw`(?:\.\s|\.$|;|\bWHEREAS\b|\bBE IT (?:ORDAINED|RESOLVED)\b|\bNOW,? THEREFORE\b|$)`;
  // A caption is set in capitals; one in mixed case counts only at the start of a line (never "adopted an ordinance" in prose).
  const m = flat.match(new RegExp(String.raw`\bAN?\s+(?:ORDINANCE|RESOLUTION)\b,?\s+(.{8,1200}?)${END}`)) ?? src.match(new RegExp(String.raw`(?:^|\n)[ \t]*An?\s+(?:Ordinance|Resolution)\b,?\s+([^]{8,1200}?)${END}`));
  if (!m) return null;
  let rest = m[1].replace(/\s+/g, ' ').trim();
  if (/^of\b/i.test(rest)) {
    // The preamble runs to the first word that says what the measure does ("AMENDING", "ADOPTING", "TO APPROVE").
    const words = rest.split(' ');
    const at = words.findIndex((w, i) => i > 0 && ((/^[a-z]+ing,?$/i.test(w) && !NOT_VERB.test(w.replace(/,$/, ''))) || /^(?:to|regarding|concerning)$/i.test(w)));
    if (at < 0 || words.slice(0, at).join(' ').length > 160) return null;
    rest = words.slice(at).join(' ');
  }
  rest = rest.replace(/^,\s*/, '').trim();
  if (rest.length < 8) return null;
  const words = rest.split(' ').map((w, i) => {
    if (/[a-z]/.test(w)) return w;
    const core = w.replace(/[^A-Za-z0-9]/g, '');
    if (ACRONYM.test(core) || /\d/.test(core)) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL.has(lower.replace(/[^a-z]/g, ''))) return lower;
    return lower.replace(/^([^a-z]*)([a-z])/, (_, p: string, c: string) => p + c.toUpperCase());
  });
  const t = noDash(words.join(' ')).replace(/[.;,:\s]+$/, '');
  return t || null;
}

/** Longest caption shown as a title; a longer one gives way to the agenda wording (a title is never cut short). */
const MAX_TITLE = 320;

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

/** The tally the minutes print, else the recorded roll call counted as yes to no. */
export function tallyOf(m: Pick<IndexMotion, 'tally' | 'yes' | 'no'> | undefined | null): string | null {
  if (!m) return null;
  if (m.tally) return m.tally;
  const yes = Number(m.yes ?? 0);
  const no = Number(m.no ?? 0);
  return yes + no > 0 ? `${yes}-${no}` : null;
}

const fromMotion = (m: IndexMotion, page = m.page): Vote => ({
  date: m.meeting_date,
  tally: tallyOf(m),
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

const bodyFor = (kind: NumberedKind) => (kind === 'rda-resolution' ? 'redevelopment-agency' : 'city-council');

/**
 * A file posted with an agenda item whose own name carries no number ("10.01.2026 DADU Ordinance - Senate Bill 284")
 * takes the one number its agenda item names ("... Consideration of Ordinance No. 2026-11"), when the file is the
 * measure itself (its name says Ordinance or Resolution) and not a presentation, notice, letter or report.
 */
function agendaNumber(d: IndexDoc, kind: NumberedKind): string | null {
  const name = d.title.replace(/_/g, ' ');
  if (!d.description || !/\b(?:ordinance|resolution)\b/i.test(name) || /\b(?:presentation|notice|letter|fact\s*sheet|report|memo|map|exhibit|staff)\b/i.test(name)) return null;
  const ns = motionNumbers(d.description.replace(/<[^>]*>/g, ' '), bodyFor(kind), d.year ?? (d.document_date ? Number(d.document_date.slice(0, 4)) : null)).filter((x) => x.kind === kind);
  return ns.length === 1 ? ns[0].number : null;
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
  type Held = { d: IndexDoc; input: Parameters<typeof displayTitle>[0]; shown: ReturnType<typeof displayTitle> };
  const byNumber = new Map<string, { docs: Held[]; adoption?: Adoption; ref?: IndexRef }>();
  const slot = (n: string) => byNumber.get(n) ?? byNumber.set(n, { docs: [] }).get(n)!;
  const adopted = new Map(adoptions.filter((a) => a.kind === kind).map((a) => [a.number, a]));
  const motionById = new Map(motions.map((m) => [m.id, m]));
  for (const d of docs) {
    const input = { title: d.title, documentType: d.document_type, date: d.document_date, documentNumber: d.document_number, governmentBodyId: d.government_body_id, governmentBodyName: d.government_body_name, sourceId: d.source_id, agendaItemId: d.agenda_item_id };
    const override = SERIES_OVERRIDES[d.id];
    if ((override?.kind ?? numberedKindOf(input)) !== kind) continue;
    const n = override?.number ?? recordNumberOf(input) ?? agendaNumber(d, kind);
    // "U-2026-0X" is a placeholder in a draft's file name, not a number.
    if (!n || seqOf(n) === 0) continue;
    slot(n).docs.push({ d, input, shown: displayTitle(input) });
  }
  for (const a of adopted.values()) slot(a.number).adoption = a;
  for (const r of refs) if (!byNumber.has(r.number)) slot(r.number).ref = r;

  const all: IndexRow[] = [];
  for (const [number, s] of byNumber) {
    const code = s.docs.find((x) => x.d.source_id === MUNICIPAL_CODE_SOURCE);
    const a = s.adoption;
    const v: Vote | null = a
      ? { date: a.date, tally: a.tally ?? tallyOf(a.id ? motionById.get(a.id) : null), unanimous: a.unanimous, documentId: a.documentId, page: a.page, item: a.id ? (motionById.get(a.id)?.item ?? null) : null, motion: a.motion }
      : voteFor(kind, number, motions, links);
    const adoptedOn = v?.date ?? code?.d.document_date ?? null;
    const isAdopted = Boolean(v || code);
    // A copy named Draft stays a draft; a packet copy of a measure the minutes show adopted is the adopted text.
    const copies = s.docs.map((x) => ({ d: x.d, status: recordStatus(x.input, isAdopted, x.shown), attached: x.shown.attached, title: x.shown.title }));
    const ordered = [...copies].sort((x, y) => rank(x.d, x.status, x.attached) - rank(y.d, y.status, y.attached) || (y.d.document_date ?? '').localeCompare(x.d.document_date ?? ''));
    const best = ordered[0];
    const drafts = copies.filter((x) => x.status === 'draft').sort((x, y) => (y.d.document_date ?? '').localeCompare(x.d.document_date ?? ''));
    const status: IndexRow['status'] = isAdopted ? 'adopted' : drafts.length ? 'draft' : 'none';

    // The agenda wording that names this number (the copy's own agenda item first, the motion's item, then the newest other copy's).
    const named = (t: string | null | undefined) => {
      if (!t) return '';
      const y = Number(number.slice(0, 4));
      return motionNumbers(t.replace(/<[^>]*>/g, ' '), bodyFor(kind), y).some((x) => x.kind === kind && x.number === number) ? agendaTitle(t) : '';
    };
    const byDate = [...copies].sort((x, y) => (y.d.document_date ?? '').localeCompare(x.d.document_date ?? ''));
    const ok = (t: string | null | undefined): t is string => Boolean(t) && !fileish(t) && (t as string).length <= MAX_TITLE;
    const caption = best && best.status !== 'draft' ? textTitles.get(best.d.id) : undefined;
    const title =
      [
        caption,
        code ? subject(code.shown.title) : '',
        best ? named(best.d.description) : '',
        named(v?.item),
        ...byDate.map((x) => named(x.d.description)),
        ...ordered.map((x) => subject(x.title)),
        v?.motion ? motionTitle(v.motion) : '',
        best ? textTitles.get(best.d.id) : '',
      ].find(ok) ?? null;

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
      status,
      draft: status === 'draft' && drafts[0] ? { date: drafts[0].d.document_date, body: drafts[0].d.government_body_name } : null,
      state: isAdopted ? 'adopted' : best ? 'listed' : 'missing',
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
      rows.push({
        number: `${chosen}-${String(i).padStart(2, '0')}`,
        title: null,
        adoptedOn: null,
        adoptedFrom: null,
        tally: null,
        unanimous: false,
        vote: null,
        minutes: null,
        document: null,
        status: 'none',
        draft: null,
        state: 'absent',
      });
  return { kind, year: chosen, years, rows: rows.sort((a, b) => numSort(a.number, b.number)) };
}

/** The copies the index links, whose first page is read for the caption they print. */
export function captionDocs(index: RecordIndex): string[] {
  return index.rows.filter((r) => r.document).map((r) => r.document!.id);
}
