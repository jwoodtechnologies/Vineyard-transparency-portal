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
export type SheetStatus = 'passed' | 'failed' | 'continued' | 'tabled' | 'removed' | 'none';

export const STATUS_WORD: Record<SheetStatus, string> = { passed: 'Passed', failed: 'Failed', continued: 'Continued', tabled: 'Tabled', removed: 'Removed', none: 'No result' };

/** One thing the body decided: the motion, a clean name for it, and how it ended. */
export interface SheetRow {
  m: MotionRow;
  title: string;
  /** What to call it when two rows at one meeting would otherwise read the same. */
  alt: string;
  status: SheetStatus;
}

/** Agenda headings that name a part of the meeting, not a thing being decided. */
const SECTION =
  /^(?:business items?|work session|closed session|consent(?: items?| agenda)?|public comment|discussion items?|action items?|new business|old business|call to order|agenda|items?)$/i;
const ACRONYM = new Set(['RDA', 'TSD', 'TSSD', 'UDOT', 'FY', 'ARCH', 'MAG', 'PD', 'UVU', 'CDBG', 'UTA', 'HOA', 'USA', 'CC', 'II', 'III', 'IV']);
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

/** The minutes are scanned, so a few words come through misspelled; these are the ones seen. */
const OCR: Array<[RegExp, string | ((w: string) => string)]> = [
  [/\bhir[ir]*n?g\)?/gi, 'hiring'],
  [/\badyisors?\b/gi, (w) => w.replace(/yi/i, 'vi')],
  [/\bfora[-\s]+/gi, 'for a '],
  [/\bfora\b/gi, 'for a'],
  [/\bserve as'an\b/gi, 'serve as an'],
  [/\bas'an\b/gi, 'as an'],
  [/\b(appro|remo|impro)ye\b/gi, (w) => w.replace(/ye$/i, 've')],
  [/\bRDA;(?=\d)/g, 'RDA-'],
];

function tidy(t: string): string {
  let out = t.replace(/\s+/g, ' ').trim();
  for (const [re, to] of OCR) out = typeof to === 'string' ? out.replace(re, to) : out.replace(re, to);
  return out
    .replace(/^([A-Za-z])\1\s+(?=[A-Z])/i, '')
    .replace(/[()]+(?=\s|$)/g, '')
    .replace(/\s+'(?=[a-z])/g, ' ')
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

/** The agenda item's name without its number or trailing note. */
export function itemName(m: MotionRow): string {
  return caseWords(tidy((m.item ?? '').replace(/^\d+(?:\.\d+)*\.?\s+/, '').replace(/\s*\([^)]*\)\s*$/, '')));
}

function sentence(t: string): string {
  const first = t.split(/\.\s+(?=[A-Z])/)[0] ?? t;
  const s = caseWords(tidy(first.replace(/^(?:to|td)[-\s]*(?=approve|adopt|appoint|accept|deny|authorize)/i, '').replace(/^to\s+/i, '')));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A vote on something the body actually decided, or null for housekeeping and for motions that never came to a vote. */
function classify(m: MotionRow): SheetRow | null {
  const text = m.motion
    .replace(/^to[\s-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const item = itemName(m);
  const named = item.length >= 6 && !SECTION.test(item);
  if (!text && !named) return null;
  // A motion nobody seconded, or one that only closes the session, is not a decision.
  if (/\bno second\b|\black of (?:a )?second\b|\bdied for\b/i.test(text)) return null;
  if (/\bclose (?:the )?session\b|\bclosed session\b/i.test(text)) return null;
  const consent = /\bconsent (?:agenda|items?)\b/i.test(text) && ((m.items?.length ?? 0) > 0 || /as presented|as written/i.test(text)) && !/resolution|ordinance/i.test(text);
  let status: SheetStatus = m.result === 'carried' ? 'passed' : m.result === 'failed' ? 'failed' : 'none';
  const defer = /^(continue|table|postpone|defer|move\s+(?:agenda\s+)?items?|strike)\b/i.exec(text);
  if (defer) {
    // Continuing or tabling counts when it names the one item being put off; "continue items 5.1 through 6.1" does not.
    const several = /\bitems?\s+[\d.]+\s*(?:,|and|through|to)\s*[\d.]+/i.test(text) || /\bcontinue all\b/i.test(text);
    if (!named || several || m.result !== 'carried') return null;
    const verb = (defer[1] ?? '').toLowerCase();
    status = verb === 'table' ? 'tabled' : verb === 'strike' ? 'removed' : 'continued';
  }
  // A motion whose result the minutes never state, and that names no votes, cannot be reported either way.
  if (status === 'none' && m.votes.length === 0) return null;
  const own = sentence(text);
  const clipped = (s: string) => (s.length > 150 ? `${s.slice(0, 147).replace(/\s+\S*$/, '')}...` : s);
  const title = consent ? `Consent agenda${(m.items?.length ?? 0) > 1 ? ` (${m.items!.length} items)` : ''}` : clipped(named ? item : own || item);
  return { m, title, alt: consent ? title : clipped(own || item), status };
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
  for (const group of names.values()) if (group.length > 1) for (const r of group) r.title = r.alt;
  return rows.filter((r) => (only === 'carried' ? r.status === 'passed' : only === 'failed' ? r.status === 'failed' : true));
}
