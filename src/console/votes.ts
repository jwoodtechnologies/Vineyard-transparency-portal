/** Voting records: shapes from /api/votes and how a member's name is shown. */
import { usePeople, type Person } from './people';
import { formatMonthDay } from '@/lib/dates';
import { isAboutFormerMember, isProceduralMotion } from '@/lib/voteRules';

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
  /** Who the minutes list as present and absent at the top (names as printed), when they list it. */
  attendance?: { present: string[]; absent: string[] } | null;
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
export type SheetStatus = 'passed' | 'failed' | 'denied' | 'pending' | 'canceled' | 'none';

export const STATUS_WORD: Record<SheetStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  denied: 'Denied',
  pending: 'Pending',
  canceled: 'Canceled',
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
  /** A meeting the city canceled. */
  canceled?: boolean;
  /** Draft minutes printed inside a later meeting's agenda packet (the packet, its date and the page). */
  draft?: DraftMinutes;
}

/** Where a meeting's draft minutes are printed before the city posts them on their own (/api/draft-minutes). */
export interface DraftMinutes {
  documentId: string;
  title: string;
  date: string | null;
  page: number;
}

/** Agenda headings that name a part of the meeting, not a thing being decided. */
const SECTION =
  /^(?:business items?|work session|closed session|consent(?: items?| agenda)?|public comment|public hearing|discussion(?: and (?:possible )?action)?|discussion items?|action items?|new business|old business|call to order|agenda|items?)$/i;
const ACRONYM = new Set(['RDA', 'TSD', 'TSSD', 'UDOT', 'FY', 'ARCH', 'MAG', 'PD', 'UVU', 'CDBG', 'UTA', 'HOA', 'USA', 'CC', 'II', 'III', 'IV', 'DADU', 'SB', 'NUVASSSD']);
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
/** Names that the minutes type in lower case inside a motion. */
const PROPER = /\b(utah|vineyard|orem|provo|lehi|lindon|geneva|timpanogos|intermountain|holdaway|stratton|lauret|mccumber|cosmo|forge|deer valley|rda|tsd|nuvasssd|dadu|fy|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

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
    .replace(/(\w)[–—](\w)/g, '$1-$2')
    .replace(/\s+as presented\.?$/i, '')
    .replace(
      /\b(Resolution|Ordinance)\s+(U?)((?:19|20)\d{2})(\d{2})\b/gi,
      (_, k: string, u: string, y: string, n: string) => `${k.charAt(0).toUpperCase()}${k.slice(1).toLowerCase()} ${u.toUpperCase()}${y}-${n}`,
    )
    .replace(/^resolution\b/i, 'Resolution')
    .replace(/[\s:;,.-]+$/, '')
    .trim();
  if (t === t.toLowerCase() || /\b[a-z]{3,}\b/.test(t.replace(PROPER, 'X')))
    // A name already written with its own capitals (McCumber) is left alone; only plain lower or upper case is fixed.
    t = t.replace(PROPER, (w) => (ACRONYM.has(w.toUpperCase()) ? w.toUpperCase() : /[a-z]/.test(w) && /[A-Z]/.test(w.slice(1)) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
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
  // "In honor of Council Member McCumber's new son, that Council Member Parker McCumber should be Mayor Pro Tem": the vote is on the appointment.
  const named = /^in (?:honou?r|memory|recognition) of [^,]+,\s*that\s+(?:(?:council ?member|councilmember|commissioner|mayor)\s+)?(.+?)\s+should be\s+(.+)$/i.exec(first);
  if (named) return `${named[2]}: ${named[1]}`;
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
  // Every entry is a vote on something the body decided. Putting an item off, striking it, a stretch or recess, and adjourning are motions, not votes;
  // nor is an item whose own subject is a former member (how he voted on a roll stays on the roll).
  if (isProceduralMotion(text) || isAboutFormerMember(m.item, text)) return null;
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
  if (minutesItem && (!text || MINUTES.test(text) || /^(?:approve|accept)\b/i.test(text) || text.split(' ').length < 4)) return null;
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
  // A motion whose result the minutes never state, and that names no votes, cannot be reported either way.
  if (status === 'none' && m.votes.length === 0) return null;
  const ownShown = shown(own);
  if (!title && !generic && aboutItem) {
    // The agenda heading names the item. When the motion adopts a numbered resolution or ordinance that the heading does not mention, the number leads ("Resolution 2026-12: Municipal Financial Institution Signatory Authorization").
    const num = /\b(resolution|ordinance)\s+(u?(?:19|20)\d{2})\s*-?\s*(\d{2,3})\b/i.exec(text);
    const tag = num ? `${num[1].charAt(0).toUpperCase()}${num[1].slice(1).toLowerCase()} ${num[2].toUpperCase()}-${num[3]}` : '';
    const specific = text.split(' ').length >= 5 && !/^(?:approve|accept|adopt)\b[^.]{0,30}\b(?:item|consent|agenda|as presented)\b/i.test(text);
    // A motion that names its agenda item by number ("approve 5.5 with an amendment") is about that item.
    const number = /^(\d+\.\d+)/.exec(m.item ?? '')?.[1];
    const names = !!number && new RegExp(`\\b${number.replace('.', '\\.')}\\b`).test(text);
    // Words that describe who did what with a motion ("Mayor Pro Tem Lauret brought back the original motion") are not the thing decided: the agenda item names it.
    const describesMotion = /\b(?:original|amended|substitute|previous|revised|second) motion\b|^(?:mayor|council ?members?|councilm[ae]n|commissioner|board member)\b/i.test(own);
    if (specific && !names && !describesMotion && !words(itemShown).some((w) => words(text).includes(w)) && !tag) title = ownShown;
    else title = tag && !itemShown.includes(tag.replace(/^\w+\s+/, '')) ? `${tag}: ${itemShown}` : itemShown;
  }
  if (!title) title = ownShown;
  if (m.bodyId === 'redevelopment-agency') title = title.replace(/\b(Resolution|Ordinance)\s+U(?=(?:19|20)\d{2}-)/g, '$1 RDA-');
  title = numberColon(trimTitle(title));
  if (!title || title.length < 4) return null;
  return { m, title: clip(title), full: title, alt: clip(trimTitle(ownShown) || title), status };
}

/** Text as shown on the page: an en or em dash from the minutes becomes a plain hyphen. */
export const plainDashes = (t: string): string => t.replace(/[\u2013\u2014]/g, '-');

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
  for (const r of rows) {
    r.title = plainDashes(r.title);
    r.full = plainDashes(r.full);
    r.alt = plainDashes(r.alt);
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

/** Titles a member can carry before their last name, as the people records and rosters store them. */
const MEMBER_TITLE = /^(mayor|deputy mayor|mayor pro tem(?:pore)?|council ?member|councilor|commissioner|chair(?:person)?|vice[- ]chair(?:person)?|board member)$/i;

/**
 * A member as the minutes address them: the stored title and the last name ("Council Member
 * McCumber", "Mayor Fullmer"). With no stored title (or one that is not a plain title), the last
 * name alone: a title is never made up.
 */
export function memberTitle(name: string, role: string | null | undefined): string {
  const raw = name.trim().split(/\s+/).pop() ?? name;
  const surname = raw !== raw.toLowerCase() ? raw : raw.charAt(0).toUpperCase() + raw.slice(1).replace(/^c([a-z])/, (_, c: string) => (raw.startsWith('mc') ? `c${c.toUpperCase()}` : `c${c}`));
  const title = (role ?? '').split(/[,(]| - /)[0].replace(/\s+/g, ' ').trim();
  return title && MEMBER_TITLE.test(title) ? `${title} ${surname}` : surname;
}

/** The motion as the minutes record it, with only spacing tidied. */
export function recordedMotion(m: Pick<MotionRow, 'motion'>): string {
  return m.motion.replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------------------------------ tally and marks

/**
 * The count for a vote as the minutes record it: "3 to 2", "4 to 0, 1 abstained", "3 to 2 (Mayor breaks tie)".
 * The total the minutes print ("Motion Passed 3-2") is the record. A printed total counts every member who voted,
 * a member who has since left included, so it can name more votes than the chart has columns. When the printed
 * total is lower than the names the minutes list for one side, the minutes contradict themselves and the list of
 * names is used. With no printed total, the count is taken from the names (every name, former members included).
 * "(Mayor breaks tie)" is added only when the minutes say the mayor broke a tie.
 */
export function recordedTally(m: Pick<MotionRow, 'tally' | 'votes' | 'tieBreak' | 'unanimous' | 'result'>): string | null {
  const n = (k: string) => m.votes.filter((v) => v.vote === k).length;
  const yes = n('yes');
  const no = n('no');
  const printed = /^(\d+)-(\d+)$/.exec(m.tally ?? '');
  let count: string | null = null;
  if (printed && yes <= Number(printed[1]) && no <= Number(printed[2])) count = `${printed[1]} to ${printed[2]}`;
  else if (yes + no + n('abstain') >= 2 || (printed && yes + no > 0)) count = `${yes} to ${no}`;
  else if (m.unanimous && m.result === 'carried' && m.votes.length === 0) return 'Unanimous';
  if (!count) return null;
  const extra = [n('abstain') ? `${n('abstain')} abstained` : '', n('recused') ? `${n('recused')} recused` : ''].filter(Boolean).join(', ');
  return `${count}${extra ? `, ${extra}` : ''}${m.tieBreak ? ' (Mayor breaks tie)' : ''}`;
}

/** A seat on the council or commission, with the dates the records show it held (inclusive). */
export interface Seat {
  name: string;
  /** "Alternate" is shown in the column heading. */
  role?: 'Alternate' | 'Chair' | 'Vice Chair';
  /** First day the member could vote. Before it the column is blank. */
  from?: string;
  /** Last day the member could vote. After it the column is blank. */
  to?: string;
}

/**
 * Council members whose seat began after January 2026, when this council's term began.
 *
 * Chip (Christopher) Price: the City Council chose him to fill Ezra Nair's vacant seat at its special meeting of
 * September 15, 2026 (draft minutes of that meeting, item 7.4, printed in the October 13, 2026 City Council agenda
 * packet, doc_778fecc1b705e178 p. 7: Christopher "Chip" Price "was selected to fill the vacant City Council seat ...
 * The oath of office was scheduled to occur following statutory notice requirements"; also "Public Notice -
 * Appointment of New City Council Member", doc_47d614c9864068a8 p. 1: "At its public meeting held on September 15,
 * 2026, the City Council voted to appoint Christopher Price"). No record in the archive gives the date of his oath.
 * He did not vote at the September 15 meeting (Nair voted on every item after the selection), so his column is
 * blank through September 15, 2026.
 */
export const COUNCIL_SEATS: Record<string, Seat> = {
  'chip price': { name: 'Chip Price', from: '2026-09-16' },
};

/**
 * The Planning Commission as its 2026 records show it. Sources (archive document id and page):
 * - March 4, 2026 approved minutes, doc_87f4b9c0a818e65b p. 1: "COMMISSIONERS PRESENT: David Pearce, Graden Ostler,
 *   Jordan Christensen, and Martina Huntington"; Daria Evans is listed under "OTHERS PRESENT" and spoke as a resident.
 * - March 24, 2026 City Council minutes, doc_965360a52383e70e p. 6, item 9.1: the council approved the appointment of
 *   Daria Evans to the Planning Commission and "Deputy Recorder Tony Lara administered the oath of office to Daria
 *   Evans". Her column is blank before that day. The minutes do not say whose seat she filled.
 * - May 6, 2026 minutes, doc_92676662d170d22b p. 1: "Planning Commissioners Present: Daria Evans, Brad Fagg, Martina
 *   Huntington, Graden Ostler, David Pearce, and Nathan Steele"; p. 2: Nathan Steele elected Chair and David Pearce
 *   Vice Chair.
 * - Alternates: January 22, 2025 final minutes, doc_8581dd5de1cb765c p. 2: "Commissioners Fagg and Ostler are
 *   alternates and can not be nominated." No later record found changes either seat. No 2026 minutes print a role
 *   for them.
 * - Nathan Steele and Brad Fagg sat on November 5, 2025 (minutes doc_ccd67fb92b4b6746 p. 1) and are listed on the
 *   city's Board & Commission Members page as read October 5, 2026 (doc_079bc34d0f7ba1da; terms 2024-2027 and
 *   2023-2026), so on March 4, 2026, where the minutes do not list them as present, they are marked absent.
 * - Jordan Christensen: no record found of his leaving; on May 6, 2026 he is not listed as present, so he is marked absent.
 * Not columns: Caden Rhoton (at no 2026 meeting with minutes; "RES 2026-16 Planning Commissioner Removal",
 * doc_fdf9cfd8eff4c237 p. 1, was in the March 24, 2026 council packet, and the August 18, 2026 council minutes,
 * doc_70147d9eaf07e39b p. 1, list him among Vineyard residents) and Natalie Harbin (last at the November 5, 2025
 * meeting, doc_ccd67fb92b4b6746 p. 1; no 2026 votes).
 */
export const PC_SEATS: Seat[] = [
  { name: 'Jordan Christensen' },
  { name: 'Daria Evans', from: '2026-03-24' },
  { name: 'Brad Fagg', role: 'Alternate' },
  { name: 'Martina Huntington' },
  { name: 'Graden Ostler', role: 'Alternate' },
  { name: 'David Pearce', role: 'Vice Chair' },
  { name: 'Nathan Steele', role: 'Chair' },
];

/** What a cell in the chart shows for one member on one vote. */
export type Mark = 'yes' | 'no' | 'abstain' | 'recused' | 'absent' | 'unseated' | 'nonvoting' | 'unrecorded';

const lc = (n: string) => n.toLowerCase();
const lastName = (n: string) => n.split(' ').pop() ?? n;
/** A recorded name belongs to a member when the minutes print their full name, or only their last name. */
export const isMember = (recorded: string, name: string): boolean => lc(recorded) === lc(name) || (!recorded.includes(' ') && lc(recorded) === lc(lastName(name)));

/**
 * A member's mark on one vote, from the records only:
 * - the vote the minutes record for them;
 * - blank ("unseated") when they were not yet seated, or no longer seated, that day;
 * - absent when the minutes list them as absent, or, in minutes that list only who was present, when they are not listed;
 * - the mayor votes only to break a tie, so the mayor's cell is otherwise empty ("nonvoting");
 * - otherwise no vote is recorded for them ("unrecorded").
 */
export function cellMark(m: Pick<MotionRow, 'date' | 'votes' | 'attendance'>, seat: Seat, mayor = false): Mark {
  const day = (m.date ?? '').slice(0, 10);
  if (day && ((seat.from && day < seat.from) || (seat.to && day > seat.to))) return 'unseated';
  const v = m.votes.find((x) => isMember(x.member, seat.name))?.vote;
  if (v === 'yes' || v === 'no' || v === 'abstain' || v === 'recused' || v === 'absent') return v;
  const att = m.attendance;
  if (att?.absent.some((n) => isMember(n, seat.name))) return 'absent';
  if (mayor) return 'nonvoting';
  // Only a present list that names everyone the roll call names is taken as complete.
  const complete = att && att.present.length >= 2 && m.votes.every((x) => x.vote === 'absent' || att.present.some((n) => isMember(x.member, n) || isMember(n, x.member)));
  if (att && complete && att.absent.length === 0 && !att.present.some((n) => isMember(n, seat.name))) return 'absent';
  return 'unrecorded';
}

/** The column heading for a seat: the last name, with "(Alt.)" for an alternate. */
export function seatLabel(seat: Seat): string {
  const n = lastName(seat.name);
  return seat.role === 'Alternate' ? `${n} (Alt.)` : n;
}

// ------------------------------------------------------------------------------------------ the year's meetings

// The sheet is labeled with its year, so the packet date is month and day (docs/DESIGN.md).
const shortDay = (iso: string) => formatMonthDay(iso);

/**
 * Every meeting of a body this year, for a page that lists them all (the Planning Commission):
 * - a meeting held whose minutes are read gets no row here (its votes are its rows), unless none of its votes is
 *   listed (`voted`), when it gets a "No votes recorded" row;
 * - a meeting held with no minutes: "Draft minutes in <date> packet" when a later packet prints them, otherwise
 *   "Minutes not yet posted";
 * - a canceled meeting: "Meeting canceled".
 * A meeting whose date has passed but which the calendar still calls scheduled is counted as held: the calendar is
 * copied from the city's portal and a copy can lag, and the city posted no cancellation for it.
 * Entries on one day are one meeting; a cancellation that day wins over an entry with no minutes. Hearing notices
 * and comment periods filed under the body are not meetings.
 */
export function meetingRows(
  meetings: MeetingLite[],
  read: MinutesRead[],
  today: string,
  opts: { voted?: Set<string>; drafts?: Record<string, DraftMinutes | null>; from?: string } = {},
): SheetRow[] {
  const day = (d: string | null) => (d ?? '').slice(0, 10);
  const from = opts.from ?? `${today.slice(0, 4)}-01-01`;
  const have = new Set(read.map((r) => `${r.bodyId}|${day(r.date)}`));
  const groups = new Map<string, MeetingLite[]>();
  for (const mt of meetings) {
    const date = day(mt.date);
    if (!date || date < from || date > today || !mt.governmentBodyId) continue;
    if (/\b(?:public notice|notice of public hearing|comment period)\b/i.test(mt.title) && !/\bcancel/i.test(mt.title)) continue;
    const k = `${mt.governmentBodyId}|${date}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(mt);
  }
  const rows: SheetRow[] = [];
  for (const [key, list] of groups) {
    const date = key.slice(key.indexOf('|') + 1);
    const cancelled = list.find((m) => m.status === 'cancelled' || /\bcancel+(?:ed|ation)\b/i.test(m.title));
    const held = list.some((m) => m.status === 'held' || (m.status === 'scheduled' && date < today));
    const main = list.find((m) => m !== cancelled) ?? list[0];
    let title: string;
    let status: SheetStatus;
    let draft: DraftMinutes | undefined;
    if (have.has(key)) {
      if (!opts.voted || opts.voted.has(key)) continue;
      title = 'No votes recorded';
      status = 'none';
    } else if (cancelled) {
      title = 'Meeting canceled';
      status = 'canceled';
    } else if (held) {
      const d = opts.drafts?.[key] ?? null;
      if (d) draft = d;
      title = d ? `Draft minutes in ${d.date ? shortDay(d.date) : 'a later'} packet` : 'Minutes not yet posted';
      status = 'pending';
    } else continue;
    const shownMeeting = status === 'canceled' && cancelled ? cancelled : main;
    const bodyId = shownMeeting.governmentBodyId ?? null;
    rows.push({
      m: {
        id: `meeting:${shownMeeting.id}`,
        meetingId: shownMeeting.id,
        date,
        bodyId,
        bodyName: bodyId ? (BODY_NAME[bodyId] ?? shownMeeting.governmentBodyName ?? null) : null,
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
        documentId: draft?.documentId ?? '',
        page: draft?.page ?? null,
        votes: [],
      },
      title,
      full: title,
      alt: title,
      status,
      pending: status !== 'none',
      canceled: status === 'canceled',
      draft,
    });
  }
  return rows.sort((a, b) => (b.m.date ?? '').localeCompare(a.m.date ?? ''));
}

/** Meetings held with no minutes read, keyed "body|date": where to look for draft minutes in a later packet. */
export function meetingsWithoutMinutes(meetings: MeetingLite[], read: MinutesRead[], today: string): Array<{ key: string; date: string; body: string }> {
  return meetingRows(meetings, read, today)
    .filter((r) => r.status === 'pending' && r.m.bodyId && r.m.date)
    .map((r) => ({ key: `${r.m.bodyId}|${r.m.date}`, date: r.m.date as string, body: r.m.bodyName ?? '' }));
}
