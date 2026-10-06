/** Voting records: shapes from /api/votes and how a member's name is shown. */
import { usePeople, type Person } from './people';

export interface VoteRow {
  member: string;
  vote: 'yes' | 'no' | 'abstain' | 'recused' | 'absent' | string;
}
export interface MotionRow {
  id: string;
  items?: string[];
  meetingId?: string | null;
  date: string | null;
  bodyId: string | null;
  bodyName: string | null;
  item: string | null;
  motion: string;
  mover: string | null;
  seconder: string | null;
  result: string;
  tally: string | null;
  tieBreak: boolean;
  unanimous: boolean;
  inferred: boolean;
  refs: string[];
  documentId: string;
  page: number | null;
  votes: VoteRow[];
}
export interface VoteMember {
  member: string;
  fullName: string | null;
  firstDate: string | null;
  lastDate: string | null;
  motions: number;
  yes: number;
  no: number;
  abstain: number;
  recused: number;
  absent: number;
  moved: number;
  seconded: number;
  bodies: string[];
}

/** A member as the minutes name them ("Jacob Holdaway", or "Holdaway" when only that is printed), with the current official's profile when it is them. */
export function useMemberNames(): (member: string, full?: string | null) => { name: string; short: string; person: Person | null } {
  const people = usePeople();
  return (member, full) => {
    const lower = member.toLowerCase();
    const last = lower.split(' ').pop() ?? lower;
    const person =
      people.find((p) => p.kind === 'elected' && (p.name.toLowerCase() === lower || (!member.includes(' ') && p.name.toLowerCase().split(/\s+/).pop() === last))) ?? null;
    return { name: full ?? (member.includes(' ') ? member : (person?.name ?? member)), short: member.split(' ').pop() ?? member, person };
  };
}

/** The count shown next to a result. When the minutes name how each member voted, the count is taken from those names (the minutes sometimes print a total that does not match their own list). */
export function motionTally(m: MotionRow): string | null {
  const named = m.votes.filter((v) => v.vote === 'yes' || v.vote === 'no' || v.vote === 'abstain');
  if (named.length < 2) return m.tally;
  const n = (k: string) => named.filter((v) => v.vote === k).length;
  return n('abstain') > 0 ? `${n('yes')}-${n('no')}-${n('abstain')}` : `${n('yes')}-${n('no')}`;
}

/** What was voted on, in a few words: the agenda item when the motion just says "approve item 5.4". */
export function motionLabel(m: MotionRow): string {
  const item = (m.item ?? '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  const text = m.motion
    .replace(/^to\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const generic = /^(approve|adopt|accept|deny|table|continue)\b[^.]{0,40}\b(as presented|as written|item|\d+\.\d+)/i.test(text) || text.length < 18;
  if (/\bconsent\b/i.test(text) && (m.items?.length ?? 0) > 0) return 'Consent items';
  const out = item && generic ? item : text.charAt(0).toUpperCase() + text.slice(1);
  return out.length > 140 ? `${out.slice(0, 137).replace(/\s+\S*$/, '')}...` : out;
}

/** The motion's own wording, when it says more than "approve item 5.4 as presented" (amendments, conditions). */
export function motionDetail(m: MotionRow): string | null {
  const text = m.motion
    .replace(/^to\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const label = motionLabel(m);
  if (!text || label === text || label.toLowerCase() === text.toLowerCase()) return null;
  if (/^(approve|adopt|accept)\b[^.]{0,30}\b(as presented|as written)\.?(\s*\([^)]*\))?\s*$/i.test(text)) return null;
  if (/\bconsent\b/i.test(text) && !/\b(remov|except|without|pull)/i.test(text)) return null;
  return `Motion: ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** How a row of the vote list ended. */
export type SheetStatus = 'passed' | 'failed' | 'denied' | 'continued' | 'tabled' | 'removed' | 'pending' | 'none';

export const STATUS_WORD: Record<SheetStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  denied: 'Denied',
  continued: 'Continued',
  tabled: 'Tabled',
  removed: 'Removed',
  pending: 'Pending',
  none: 'No result',
};

/** One thing the body decided (or a meeting whose minutes are not posted yet): the motion, a clean name for it, and how it ended. */
export interface SheetRow {
  m: MotionRow;
  /** The name shown in the chart (clipped when long). */
  title: string;
  /** The whole name, when the chart clips it. */
  full: string;
  /** What to call it when two rows at one meeting would otherwise read the same. */
  alt: string;
  status: SheetStatus;
  /** A meeting that was held but whose minutes are not posted: there are no votes to show yet. */
  pending?: boolean;
}

/** Agenda headings that name a part of the meeting, not a thing being decided. */
const SECTION =
  /^(?:business items?|work session|closed session|consent(?: items?| agenda)?|public comment|public hearing|discussion(?: and (?:possible )?action)?|discussion items?|action items?|new business|old business|call to order|agenda|items?)$/i;
const ACRONYM = new Set(['RDA', 'TSD', 'TSSD', 'UDOT', 'FY', 'ARCH', 'MAG', 'PD', 'UVU', 'CDBG', 'UTA', 'HOA', 'USA', 'CC', 'II', 'III', 'IV', 'DADU', 'SB', 'NUVASSSD']);
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
/** Names that the minutes type in lower case inside a motion. */
const PROPER = /\b(utah|vineyard|orem|provo|lehi|lindon|geneva|timpanogos|intermountain|holdaway|stratton|lauret|mccumber|cosmo|forge|deer valley|rda|tsd|nuvasssd|dadu|fy)\b/gi;

/** The minutes are scanned, so a few words come through misspelled; these are the ones seen. */
/** Names the minutes type in lower case or half in capitals. */
const PHRASES: Array<[RegExp, string | ((w: string) => string)]> = [
  [/\bintermountain health\b/gi, 'Intermountain Health'],
  [/\bdeer valley\b/gi, 'Deer Valley'],
  [/\b(?:friends of )?vineyard library\b/gi, (w) => w.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bOf\b/, 'of')],
];

const OCR: Array<[RegExp, string | ((w: string) => string)]> = [
  [/\bhir[ir]*n?g\)?/gi, 'hiring'],
  [/\badyisors?\b/gi, (w) => w.replace(/yi/i, 'vi')],
  [/\bfora[-\s]+/gi, 'for a '],
  [/\bfora\b/gi, 'for a'],
  [/\bserve as'an\b/gi, 'serve as an'],
  [/\bas'an\b/gi, 'as an'],
  [/\b(appro|remo|impro)ye\b/gi, (w) => w.replace(/ye$/i, 've')],
  [/\bRDA;(?=\d)/g, 'RDA-'],
  [/\bconsent\s*i\s*items\b/gi, 'consent items'],
  [/\bconsentitems\b/gi, 'consent items'],
  [/\ba3\)?\s+presented/gi, 'as presented'],
  [/\bsubcomittee\b/gi, 'subcommittee'],
  [/\bAprove\b/g, 'Approve'],
  [/\bregularl\b/gi, 'regular'],
  [/\bfot\b/gi, 'for'],
];

/** Drops a bracket that has no partner: scanned text leaves "hiring)" and "(CUWCD" behind, but "(CUWCD)" is kept. */
function balanced(t: string): string {
  const keep = new Array<boolean>(t.length).fill(true);
  const open: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') open.push(i);
    else if (t[i] === ')') {
      if (open.length) open.pop();
      else keep[i] = false;
    }
  }
  for (const i of open) keep[i] = false;
  return [...t].filter((_, i) => keep[i]).join('');
}

function tidy(t: string): string {
  let out = t.replace(/\s+/g, ' ').trim();
  for (const [re, to] of OCR) out = typeof to === 'string' ? out.replace(re, to) : out.replace(re, to);
  return balanced(out)
    .replace(/^([A-Za-z])\1\s+(?=[A-Z])/i, '')
    .replace(/\s+'(?=[a-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function caseWords(t: string): string {
  if (!/[A-Z]/.test(t) || t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      const up = w.toUpperCase();
      if (ACRONYM.has(up)) return up;
      return i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** The agenda item's name without its number or the presenter in brackets at the end. */
export function itemName(m: MotionRow): string {
  return caseWords(tidy((m.item ?? '').replace(/^\d+(?:\.\d+)*\.?\s+/, '').replace(/\s*\((?:[^()]*)\)\s*$/, '')));
}

/** A name ready to show: no leading verb, no section prefix, no dashes between parts, proper names capitalised. */
function shown(raw: string): string {
  let t = caseWords(tidy(raw))
    .replace(/^(?:public hearing|discussion and (?:possible )?(?:action|acton)|action item|business item)\s*[:\-–—]*\s*/i, '')
    .replace(/^(?:approve|adopt|accept|approval of|adoption of|adopting|approving|discuss|discussion of)\s+(?:the\s+)?/i, '')
    .replace(/\s+[-–—]+\s+/g, ': ')
    .replace(/\s+as presented\.?$/i, '')
    .replace(
      /\b(Resolution|Ordinance)\s+(U?)((?:19|20)\d{2})(\d{2})\b/gi,
      (_, k: string, u: string, y: string, n: string) => `${k.charAt(0).toUpperCase()}${k.slice(1).toLowerCase()} ${u.toUpperCase()}${y}-${n}`,
    )
    .replace(/^resolution\b/i, 'Resolution')
    .replace(/[\s:;,.-]+$/, '')
    .trim();
  if (t === t.toLowerCase() || /\b[a-z]{3,}\b/.test(t.replace(PROPER, 'X')))
    t = t.replace(PROPER, (w) => (ACRONYM.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  for (const [re, to] of PHRASES) t = typeof to === 'string' ? t.replace(re, to) : t.replace(re, to);
  // A title typed in capitals-for-every-word keeps its small words small: "In Support Of Parking" reads "In Support of Parking".
  t = t.replace(/(?<=\b[A-Z][\w'-]*\s)(A|An|And|As|At|By|For|From|In|Of|On|Or|The|To|With)(?=\s)/g, (w) => w.toLowerCase());
  // A commission's finding ("The conditional use request is approved with the conditions ...") is named for the thing decided.
  t = t.replace(/^the\s+(.+?)\s+(?:is|was)\s+(?:approved|denied|continued)\b.*$/i, '$1');
  return numberColon(t.charAt(0).toUpperCase() + t.slice(1));
}

/** "Resolution 2026-33 400 South Road" reads "Resolution 2026-33: 400 South Road" when a name follows the number. */
function numberColon(t: string): string {
  return t.replace(/^((?:Resolution|Ordinance)\s+(?:RDA-)?\d{4}-\d{1,3}[A-Z]?)\s+(?=[A-Z0-9])/, '$1: ');
}

/** Longer titles stop at the first clause that only adds conditions, so a name never ends in a trailing word or a dot dot dot. */
function trimTitle(t: string): string {
  if (t.length <= 80) return t;
  const cut =
    /\s+(?:starting|beginning|effective|as well as|with the (?:previous|recommended|conditions|following|edits)|with (?:an? )?(?:amendment|conditions)|and moving|which|that (?:were|was))\b|,\s/.exec(
      t,
    );
  return cut && cut.index >= 25 ? t.slice(0, cut.index) : t;
}

function sentence(t: string): string {
  const first = t.split(/\.\s+(?=[A-Z])/)[0] ?? t;
  return first.replace(/^(?:to|td)[-\s]*(?=approve|adopt|appoint|accept|deny|authorize)/i, '').replace(/^to\s+/i, '');
}

const STOPWORDS = new Set([
  'with',
  'that',
  'this',
  'from',
  'their',
  'shall',
  'will',
  'have',
  'been',
  'were',
  'item',
  'items',
  'council',
  'city',
  'meeting',
  'proposed',
  'presented',
  'amended',
  'approve',
  'adopt',
  'accept',
]);
/** The content words of a phrase, for telling whether a motion is about the item it was made under. */
const words = (t: string): string[] => (t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 117).replace(/\s+\S*$/, '')}...` : s);
const PUBLIC_HEARING = /\b(?:start|end|enter|leave|open|close|exit|begin|conclude|go (?:in)?to)\b[^.]{0,25}\bpublic hearing\b/i;
const MINUTES = /\bminutes\b/i;

/** A vote on something the body actually decided, or null for housekeeping and for motions that never came to a vote. */
function classify(m: MotionRow): SheetRow | null {
  const text = m.motion
    .replace(/^to[\s-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Only a numbered agenda item ("5.4 ...") is an item; "3 Delay further analysis" is a line of the minutes.
  const itemRaw = /^\d+\.\d+/.test(m.item ?? '') ? itemName(m) : '';
  const itemShown = shown(itemRaw);
  const generic = itemRaw.length < 6 || SECTION.test(itemRaw) || SECTION.test(itemShown);
  if (!text && generic) return null;
  // A motion nobody seconded, one that only closes the session, and the choosing of a chair for the night are not decisions.
  if (/\bno second\b|\black of (?:a )?second\b|\bdied for\b/i.test(text)) return null;
  if (/\bclose (?:the )?session\b|\bclosed session\b/i.test(text)) return null;
  // Opening or closing a public hearing, and pulling an item off the consent list (it is voted on by itself), are steps, not decisions.
  if (PUBLIC_HEARING.test(text) || /^(?:to\s+)?pull(?:ed)?\s+items?\b/i.test(text)) return null;
  if (/\b(?:elect|nominat)\w*\b[^.]{0,50}\b(?:chair|vice[- ]chair)\b|\bchair (?:pro tem|tempore)\b/i.test(text)) return null;
  let status: SheetStatus = m.result === 'carried' ? 'passed' : m.result === 'failed' ? 'failed' : 'none';
  // Approving minutes is housekeeping. A motion made under the minutes heading that decides something else keeps its own name.
  const minutesItem = MINUTES.test(itemRaw);
  const aboutItem = !minutesItem;
  if (minutesItem && (!text || MINUTES.test(text) || /^(?:continue|table|postpone|defer|move|strike|approve|accept)\b/i.test(text) || text.split(' ').length < 4)) return null;
  // Consent items: a bundle of routine items. Minutes alone are housekeeping; one real item takes its own name.
  let title = '';
  let own = sentence(text);
  if (/\bconsent\b/i.test(text)) {
    const items = m.items ?? [];
    const real = items.filter((i) => !MINUTES.test(i));
    if (items.length > 0 && real.length === 0) return null;
    if (real.length === 1) title = shown(real[0].replace(/^\d+(?:\.\d+)*\.?\s+/, '').replace(/\s*\((?:[^()]*)\)\s*$/, ''));
    else title = `Consent agenda${real.length > 1 ? ` (${real.length} items)` : ''}`;
    own = title;
  }
  // A motion to deny that carried is a denial; one that failed decides nothing worth listing.
  const negative = /^(?:not to|deny|reject|do not (?:approve|accept)|not approve)\b/i.exec(text);
  if (negative) {
    if (status !== 'passed') return null;
    status = 'denied';
    own = sentence(text.replace(negative[0], '').trim());
  }
  const defer = /^(continue|table|postpone|defer|move\s+(?:agenda\s+)?items?|strike)\b/i.exec(text);
  if (defer) {
    // Continuing or tabling counts when it names the one item being put off; "continue items 5.1 through 6.1" does not.
    const several = /\bitems?\s+[\d.]+\s*(?:,|and|through|to)\s*[\d.]+/i.test(text) || /\bcontinue all\b/i.test(text);
    if (generic || !aboutItem || several || m.result !== 'carried') return null;
    const verb = (defer[1] ?? '').toLowerCase();
    status = verb === 'table' ? 'tabled' : verb === 'strike' ? 'removed' : 'continued';
  }
  // A motion whose result the minutes never state, and that names no votes, cannot be reported either way.
  if (status === 'none' && m.votes.length === 0) return null;
  const ownShown = shown(own);
  if (!title && !generic && aboutItem) {
    // The agenda heading names the item. When the motion adopts a numbered resolution or ordinance that the heading does not mention, the number leads ("Resolution 2026-12: Municipal Financial Institution Signatory Authorization").
    const num = /\b(resolution|ordinance)\s+(u?(?:19|20)\d{2})\s*-?\s*(\d{2,3})\b/i.exec(text);
    const tag = num ? `${num[1].charAt(0).toUpperCase()}${num[1].slice(1).toLowerCase()} ${num[2].toUpperCase()}-${num[3]}` : '';
    const specific = text.split(' ').length >= 5 && !/^(?:continue|table|move|strike|approve|accept|adopt)\b[^.]{0,30}\b(?:item|consent|agenda|as presented)\b/i.test(text);
    // A motion that names its agenda item by number ("approve 5.5 with an amendment") is about that item.
    const number = /^(\d+\.\d+)/.exec(m.item ?? '')?.[1];
    const names = !!number && new RegExp(`\\b${number.replace('.', '\\.')}\\b`).test(text);
    if (specific && !names && !words(itemShown).some((w) => words(text).includes(w)) && !tag) title = ownShown;
    else title = tag && !itemShown.includes(tag.replace(/^\w+\s+/, '')) && !defer ? `${tag}: ${itemShown}` : itemShown;
  }
  if (!title) title = ownShown;
  if (m.bodyId === 'redevelopment-agency') title = title.replace(/\b(Resolution|Ordinance)\s+U(?=(?:19|20)\d{2}-)/g, '$1 RDA-');
  title = numberColon(trimTitle(title));
  if (!title || title.length < 4) return null;
  return { m, title: clip(title), full: title, alt: clip(trimTitle(ownShown) || title), status };
}

/** The vote list for a set of motions: only real decisions, duplicates removed, newest first as given. */
export function sheetRows(items: MotionRow[], only: 'carried' | 'failed' | '' = ''): SheetRow[] {
  const sig = (r: SheetRow) =>
    [
      r.m.bodyId,
      r.m.date,
      r.m.motion.toLowerCase().replace(/[^a-z0-9]/g, ''),
      r.status,
      [...r.m.votes]
        .map((v) => `${v.member}:${v.vote}`)
        .sort()
        .join(','),
    ].join('|');
  const seen = new Set<string>();
  const rows: SheetRow[] = [];
  for (const m of items) {
    const r = classify(m);
    if (!r || seen.has(sig(r))) continue;
    seen.add(sig(r));
    rows.push(r);
  }
  // Two different motions at one meeting that would carry the same name are told apart by what each motion says.
  const names = new Map<string, SheetRow[]>();
  for (const r of rows) {
    const k = `${r.m.bodyId}|${r.m.date}|${r.title.toLowerCase()}`;
    (names.get(k) ?? names.set(k, []).get(k)!).push(r);
  }
  for (const group of names.values())
    if (group.length > 1)
      for (const r of group) {
        r.title = r.alt;
        r.full = r.alt;
      }
  return rows.filter((r) => (only === 'carried' ? r.status === 'passed' : only === 'failed' ? r.status === 'failed' || r.status === 'denied' : true));
}

/** A meeting from the archive's calendar. */
export interface MeetingLite {
  id: string;
  title: string;
  date: string | null;
  status: string;
  governmentBodyId?: string | null;
  governmentBodyName?: string | null;
  meetingType?: string;
}

/** A meeting whose minutes the portal has read: its date and body. */
export interface MinutesRead {
  date: string;
  bodyId: string;
}

const BODY_NAME: Record<string, string> = { 'city-council': 'City Council', 'redevelopment-agency': 'Redevelopment Agency', 'planning-commission': 'Planning Commission' };

/** Days a held meeting can wait for its minutes and still be listed as not yet posted. */
export const PENDING_DAYS = 60;

/** Meetings held in the last two months whose minutes are not posted yet: a row each, so a recent meeting is never mistaken for a meeting with no votes. */
export function pendingRows(meetings: MeetingLite[], read: MinutesRead[], today: string, from = '2026-01-01'): SheetRow[] {
  const day = (d: string | null) => (d ?? '').slice(0, 10);
  const [y, mo, d] = today.split('-').map(Number);
  const recent = new Date(Date.UTC(y, mo - 1, d - PENDING_DAYS)).toISOString().slice(0, 10);
  const since = recent > from ? recent : from;
  const have = new Set(read.map((r) => `${r.bodyId}|${day(r.date)}`));
  const cancelled = new Set(meetings.filter((m) => m.status === 'cancelled' && m.date).map((m) => `${m.governmentBodyId}|${day(m.date)}`));
  const seen = new Set<string>();
  const rows: SheetRow[] = [];
  for (const mt of meetings) {
    const date = day(mt.date);
    const key = `${mt.governmentBodyId}|${date}`;
    if (!date || date < since || date > today || mt.status !== 'held' || have.has(key) || cancelled.has(key) || seen.has(key)) continue;
    if (/\b(?:notice|cancel\w*)\b/i.test(mt.title)) continue;
    seen.add(key);
    const kind =
      mt.meetingType === 'special' || /special/i.test(mt.title)
        ? 'Special meeting'
        : mt.meetingType === 'work_session' || /work\s+(?:session|meeting)/i.test(mt.title)
          ? 'Work session'
          : '';
    const title = `${kind ? `${kind} minutes` : 'Minutes'} not yet posted`;
    const bodyId = mt.governmentBodyId ?? null;
    rows.push({
      m: {
        id: `pending:${mt.id}`,
        meetingId: mt.id,
        date,
        bodyId,
        bodyName: bodyId ? (BODY_NAME[bodyId] ?? mt.governmentBodyName ?? null) : null,
        item: null,
        motion: '',
        mover: null,
        seconder: null,
        result: 'unknown',
        tally: null,
        tieBreak: false,
        unanimous: false,
        inferred: false,
        refs: [],
        documentId: '',
        page: null,
        votes: [],
      },
      title,
      full: title,
      alt: title,
      status: 'pending',
      pending: true,
    });
  }
  return rows;
}

/** Real votes and pending meetings in one list, newest meeting first (rows of one meeting keep their order). */
export function mergeRows(votes: SheetRow[], pending: SheetRow[]): SheetRow[] {
  return [...votes, ...pending].sort((a, b) => (b.m.date ?? '').localeCompare(a.m.date ?? ''));
}
