/**
 * Short display titles and Draft or Adopted status for records. Pure functions shared by the
 * records pages, search results and the Worker API (which returns displayTitle and status), so a
 * record reads the same everywhere.
 *
 * The stored title stays as filed (and the original file name stays in the record's details);
 * this only decides what a list row shows: a short title plus small chips for the body, the date,
 * the agenda item and Draft or Adopted.
 */

export type RecordStatus = 'draft' | 'adopted';
export type NumberedKind = 'ordinance' | 'resolution' | 'rda-resolution';

export interface TitleInput {
  title: string;
  documentType?: string | null;
  /** The record's own date (YYYY-MM-DD), shown as a chip. */
  date?: string | null;
  documentNumber?: string | null;
  governmentBodyId?: string | null;
  governmentBodyName?: string | null;
  sourceId?: string | null;
  agendaItemId?: string | null;
}

export interface DisplayTitle {
  title: string;
  /** The meeting a file was attached to at ingest ("Planning Commission Regular Meeting - 10/07/2026"). */
  meeting: string | null;
  /** Agenda item number from the ingest suffix ("5", "8.1"). */
  item: string | null;
  /** The file was attached to an agenda item or packet. */
  attached: boolean;
  /** The file name or title says Draft. */
  draftWord: boolean;
  /** The filed title itself names an ordinance or resolution (not only the agenda item it came with). */
  namesMeasure: boolean;
}

export const MUNICIPAL_CODE_SOURCE = 'vineyard-municipal-code';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function validIso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (y < 1980 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

/** Date forms seen in file names: 10.01.2026, 9.8.26, 2026-10-07, 10/07/2026, October 7, 2026, Oct 7 2026. */
const DATE_SRC = [
  String.raw`(?<!\d)(\d{4})[-.](\d{1,2})[-.](\d{1,2})(?![\d])`,
  String.raw`(?<![\d.])(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})(?![\d])(?!\.\d)`,
  String.raw`\b(${MON})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
].join('|');

function isoOf(m: RegExpMatchArray | RegExpExecArray): string | null {
  if (m[1]) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (m[4]) return validIso(Number(m[6]), Number(m[4]), Number(m[5]));
  if (m[7]) {
    const mon = MONTHS.findIndex((x) => x.startsWith(m[7].toLowerCase().slice(0, 3))) + 1;
    return validIso(Number(m[9]), mon, Number(m[8]));
  }
  return null;
}

const LEAD_DATE = new RegExp(String.raw`^(?:${DATE_SRC})\s*[-_:,]?\s*`, 'i');
const TRAIL_DATE = new RegExp(String.raw`\s*[-_,]?\s*(?:${DATE_SRC})\.?$`, 'i');
const ANY_DATE = new RegExp(DATE_SRC, 'gi');

const formatIso = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/**
 * The trailing "(meeting, 2026-10-07, item 5)" the ingest adds to agenda item attachments, and the
 * "(public notice, 2026-10-13)" on public notices. The last balanced parenthesis group that holds an
 * ISO date or an item number; null when there is none.
 */
export function ingestSuffix(title: string): { rest: string; meeting: string | null; item: string | null } | null {
  const t = title.trimEnd();
  if (!t.endsWith(')')) return null;
  for (let at = t.lastIndexOf(' ('); at > 0; at = t.lastIndexOf(' (', at - 1)) {
    const inner = t.slice(at + 2, -1);
    let depth = 0;
    let ok = true;
    for (const ch of inner) {
      if (ch === '(') depth++;
      else if (ch === ')' && --depth < 0) {
        ok = false;
        break;
      }
    }
    if (!ok || depth !== 0) continue;
    const m = inner.match(/^(.*?)(?:,\s*(\d{4}-\d{2}-\d{2}))?(?:,\s*item\s+([^,()]+))?$/i);
    if (!m || (!m[2] && !m[3])) return null;
    const meeting = m[1].trim();
    return { rest: t.slice(0, at), meeting: /^public notice$/i.test(meeting) ? null : meeting || null, item: m[3]?.trim() || null };
  }
  return null;
}

/** "Ordinance 2026-09", "RES 2026-35", "ORD 2026-1", "Resolution No. 2026-12", "RDA-2026-03", "202631" read as kind and number. */
export function parseRecordNumber(text: string | null | undefined): { kind: 'ordinance' | 'resolution'; number: string } | null {
  if (!text) return null;
  const m = text.replace(/[‒-―]/g, '-').match(/\b(ordinance|ord|resolution|res)\b\.?\s*(?:no\.?\s*|number\s*|#\s*)?(?:rda[-\s]?|u-?)?(?:((?:19|20)\d{2})\s*-?\s*|(\d{2})\s*-\s*)(\d{1,3})([A-Z]?)\b/i);
  if (!m) return null;
  return { kind: /^ord/i.test(m[1]) ? 'ordinance' : 'resolution', number: normalizeNumber(m[2] ?? 2000 + Number(m[3]), m[4], m[5]) };
}

/** "2026", "9", "" to "2026-09": numbers are compared and shown with at least two digits. */
export function normalizeNumber(year: string | number, n: string | number, suffix = ''): string {
  return `${year}-${String(Number(n)).padStart(2, '0')}${String(suffix).toUpperCase()}`;
}

/** The number a record carries: its stored number, then its title. Municipal code titles start with the bare number. */
export function recordNumberOf(input: Pick<TitleInput, 'title' | 'documentNumber' | 'documentType'>): string | null {
  const stored = input.documentNumber?.match(/((?:19|20)\d{2})\s*-\s*(\d{1,3})([A-Z]?)/i);
  if (stored) return normalizeNumber(stored[1], stored[2], stored[3]);
  const fromTitle = parseRecordNumber(input.title);
  if (fromTitle && (input.documentType == null || fromTitle.kind === input.documentType)) return fromTitle.number;
  if (input.documentType === 'ordinance' || input.documentType === 'resolution') {
    const bare = input.title.match(/^(?:rda\s+)?(?:resolution\s+)?((?:19|20)\d{2})\s*-\s*(\d{1,3})([A-Z]?)\b/i);
    if (bare) return normalizeNumber(bare[1], bare[2], bare[3]);
  }
  return null;
}

const RDA_MARK = /\bRDA\s+Res(?:olution)?\b|\bRes(?:olution)?\.?\s+(?:No\.?\s*)?RDA\b|\bRDA[-\s;]?(?:19|20)\d{2}\s*-|\bU-?(?:19|20)\d{2}\s*-?\s*\d/i;

/** Which numbered series a record belongs to, when it is an ordinance or resolution. */
export function numberedKindOf(input: Pick<TitleInput, 'title' | 'documentType' | 'governmentBodyId' | 'governmentBodyName'>): NumberedKind | null {
  if (input.documentType === 'ordinance') return 'ordinance';
  if (input.documentType !== 'resolution') return null;
  // The RDA series by its body, or by the RDA mark at the number ("RDA Resolution U2026-02", "Resolution RDA-2026-03",
  // "RES U2025-01"). "RDA" in the subject ("Resolution 2026-15 RDA Audit Contract Extension") is a council resolution.
  const rda = input.governmentBodyId === 'redevelopment-agency' || /redevelopment/i.test(input.governmentBodyName ?? '') || RDA_MARK.test(input.title);
  return rda ? 'rda-resolution' : 'resolution';
}

/**
 * Draft as a marker on the file: "Draft ...", "... - Draft", "(draft)", "DRAFT", "Draft Minutes",
 * "Draft 1". Inside a name it stays ("Adopting The Draft Geneva Urban Renewal Project Area Plan" is
 * the title of an adopted resolution).
 */
const DRAFT_MARKS: Array<[RegExp, string]> = [
  [/^draft\b\s*[-,:]?\s*/i, ''],
  [/\s*[-,]?\s*\bdraft\.?$/i, ''],
  [/\s*[([]\s*draft\s*[)\]]/gi, ' '],
  [/\s*[-,]+\s*draft\b(?=\s*[-,])/gi, ' '],
  [/\bdraft\s+(?=(?:minutes|ordinance|resolution|agenda|policy|agreement|budget|calendar|res|ord)\b)/gi, ''],
  [/[\s-]*\bdraft\s*\d+(?:\.\d+)?\b/gi, ' '],
  [/\bDRAFT\b\s*/g, ' '],
];

const WORD_FIXES: Array<[RegExp, string]> = [
  [/^ORD\b\.?\s*/i, 'Ordinance '],
  [/^RES\b\.?\s*/i, 'Resolution '],
  [/^ORDINANCE\b/, 'Ordinance'],
  [/^RESOLUTION\b/, 'Resolution'],
  [/^(Ordinance|Resolution)\s+No\.?\s*(?=(?:RDA[-\s]?|U-?)?(?:19|20)\d{2})/i, '$1 '],
  [/\bCC\b/g, 'City Council'],
  [/\bPC\b/g, 'Planning Commission'],
];

/**
 * A short title from a filed title: no leading dates or agenda item numbers, no file suffixes,
 * copy markers or FINAL, no Draft (reported as draftWord), no trailing "(meeting, date, item)".
 */
export function displayTitle(input: TitleInput): DisplayTitle {
  const raw = (input.title ?? '').replace(/[\u2012-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  const suffix = ingestSuffix(raw);
  let t = suffix ? suffix.rest : raw;
  const meetingType = input.documentType === 'agenda' || input.documentType === 'agenda_packet' || input.documentType === 'minutes';

  t = t.replace(/\.(pdf|docx?|xlsx?|pptx?|csv|txt|jpe?g|png)\b\.?$/i, '');
  t = t.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();

  // Copy markers and FINAL ("(1)", "- Copy", "FINAL", "(Final)", a trailing "final"); "Final Plat" keeps its word.
  t = t.replace(/\s*\(\s*\d{1,2}\s*\)/g, ' ').replace(/\s*[-,]?\s*\bcopy\b\s*$/i, ' ');
  t = t.replace(/[([]\s*final\s*[)\]]/gi, ' ').replace(/\bFINAL\b/g, ' ').replace(/\s*[-,]?\s*\bfinal\b\s*$/i, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  // Leading dates. A date that names the meeting of minutes or an agenda, when it is not the record's
  // own date, moves to the end so it is not lost ("9.8.26 CC Minutes" filed with a later packet).
  const moved: string[] = [];
  for (let i = 0; i < 2; i++) {
    const m = t.match(LEAD_DATE);
    if (!m) break;
    const iso = isoOf(m);
    if (!iso) break;
    if (meetingType && input.date && iso !== input.date) moved.push(formatIso(iso));
    t = t.slice(m[0].length);
  }
  // Agenda item numbers: "8.1 ", "8.1. ", "5. ", "5) ", "Item 5 - ".
  t = t.replace(/^(?:item\s*\d{1,2}(?:\.\d{1,2})*[a-z]?\s*[-:.)]?\s+|\d{1,2}(?:\.\d{1,2})+\.?\s+(?=\D)|\d{1,2}[.)]\s+(?=\D))/i, '');
  // Draft as a marker on the file becomes the Draft chip: "Draft ...", "... - Draft", "(draft)", "DRAFT".
  // Inside a name it stays ("Adopting The Draft Geneva Urban Renewal Project Area Plan" is an adopted resolution).
  let draftWord = false;
  for (const [re, to] of DRAFT_MARKS) {
    const next = t.replace(re, to);
    if (next !== t) draftWord = true;
    t = next;
  }
  t = t.replace(/\s+/g, ' ').trim();
  for (let i = 0; draftWord && i < 2; i++) {
    const m = t.match(LEAD_DATE);
    const iso = m ? isoOf(m) : null;
    if (!m || !iso) break;
    if (meetingType && input.date && iso !== input.date) moved.push(formatIso(iso));
    t = t.slice(m[0].length);
  }
  // A trailing date: a version date on a file, or the record's own date (shown as a chip).
  for (let i = 0; i < 2; i++) {
    const m = t.match(TRAIL_DATE);
    if (!m || m.index === 0) break;
    const iso = isoOf(m);
    if (!iso) break;
    if (meetingType && input.date && iso !== input.date) moved.push(formatIso(iso));
    t = t.slice(0, m.index).trim();
  }
  t = t.replace(/[([]\s*final\s*[)\]]/gi, ' ').replace(/\s*[-,]?\s*\bfinal\b\s*$/i, '').trim();
  // The record's own date anywhere else in the title says nothing the chip does not.
  // (A date followed by a time, as in an event listing, stays.)
  if (input.date) {
    t = t.replace(ANY_DATE, (...args) => {
      const at = args[args.length - 2] as number;
      const after = t.slice(at + String(args[0]).length);
      return isoOf(args as unknown as RegExpMatchArray) === input.date && !/^\s*\d{1,2}:\d{2}/.test(after) ? ' ' : String(args[0]);
    });
  }
  // "Planning Commission Agenda - October 7, 2026 Packet" reads "Planning Commission Agenda Packet".
  t = t.replace(/\s*-\s+((?:Agenda\s+)?(?:Packet|Agenda|Minutes))\.?\s*$/i, ' $1');
  t = t.replace(/\bAgenda\s+Agenda\b/gi, 'Agenda');
  t = t.replace(/\b(APPROVED|SIGNED|REVISED|AMENDED|UPDATED|EXECUTED|RECORDED)\b/g, (w) => w[0] + w.slice(1).toLowerCase());

  for (const [re, to] of WORD_FIXES) t = t.replace(re, to);
  // Municipal code ordinances and resolutions start with their bare number: name the series.
  if ((input.documentType === 'ordinance' || input.documentType === 'resolution') && /^(?:19|20)\d{2}-\d{1,3}[A-Z]?\b/.test(t)) {
    t = `${input.documentType === 'ordinance' ? 'Ordinance' : 'Resolution'} ${t}`;
  }
  // "Ordinance 2026-09 Amending" reads "Ordinance 2026-09, Amending".
  t = t.replace(/^((?:RDA\s+)?(?:Ordinance|Resolution)\s+(?:No\.?\s*)?(?:U-?)?(?:19|20)\d{2}-\d{1,3}[A-Z]?)\s+(?=[A-Za-z0-9])/, '$1, ');

  t = t
    // " - " separates parts of a name; between times or numbers ("4:00 PM - 7:00 PM") it stays.
    .replace(/(\S)\s+-\s+(?=(\S))/g, (_m, a: string, b: string) => (/[\dM]/.test(a) && /\d/.test(b) ? `${a} - ` : `${a}, `))
    .replace(/\s*-\s*$/, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.-]+|[\s,;:-]+$/g, '')
    .replace(/(?<!\b(?:No|Inc|Co|St|Ave|Jr|Sr))\.$/, '')
    .trim();
  if (moved.length) t = `${t}${t ? ', ' : ''}${moved.join(', ')}`;
  if (!t) t = raw.replace(/\s*\([^()]*\)\s*$/, '').trim() || 'Untitled record';
  return { title: t, meeting: suffix?.meeting ?? null, item: suffix?.item ?? null, attached: Boolean(suffix?.item || input.agendaItemId), draftWord, namesMeasure: /\b(ordinance|resolution|ord|res)\b/i.test(raw.replace(/_/g, ' ')) };
}

/**
 * Draft or Adopted, from the records only:
 * - Draft in the name: always Draft (a draft is never called adopted).
 * - An ordinance or resolution from the municipal code books (the city's signed, adopted copies): Adopted.
 * - An ordinance or resolution matched to an adopting motion in the minutes: Adopted.
 * - An ordinance or resolution attached to an agenda item or packet, whose own name says so: Draft.
 * Anything else carries no status.
 */
export function recordStatus(input: TitleInput, adoptedByMotion = false, shown: DisplayTitle = displayTitle(input)): RecordStatus | null {
  if (shown.draftWord) return 'draft';
  const legislative = input.documentType === 'ordinance' || input.documentType === 'resolution';
  if (!legislative) return null;
  if (input.sourceId === MUNICIPAL_CODE_SOURCE) return 'adopted';
  if (adoptedByMotion) return 'adopted';
  // A packet file typed by its agenda item ("EPA Stormwater Factsheet" under an ordinance item) is not the measure itself.
  if ((shown.attached || input.agendaItemId) && shown.namesMeasure) return 'draft';
  return null;
}

const BODY_SKIP = /^(public notices|vineyard city|general|city of vineyard)$/i;

/** The body chip: the record's body, short ("Vineyard Redevelopment Agency" reads "Redevelopment Agency"). */
export function bodyChip(name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  if (!n || BODY_SKIP.test(n)) return null;
  return n.replace(/^Vineyard\s+(?=Redevelopment|Library)/i, '');
}

export const STATUS_LABEL: Record<RecordStatus, string> = { draft: 'Draft', adopted: 'Adopted' };
