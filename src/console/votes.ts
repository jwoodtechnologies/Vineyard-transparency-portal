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
    const person = people.find((p) => p.kind === 'elected' && (p.name.toLowerCase() === lower || (!member.includes(' ') && p.name.toLowerCase().split(/\s+/).pop() === last))) ?? null;
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
  const item = (m.item ?? '').replace(/^\d+(?:\.\d+)*\.?\s+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const text = m.motion.replace(/^to\s+/i, '').replace(/\s+/g, ' ').trim();
  const generic = /^(approve|adopt|accept|deny|table|continue)\b[^.]{0,40}\b(as presented|as written|item|\d+\.\d+)/i.test(text) || text.length < 18;
  if (/\bconsent\b/i.test(text) && (m.items?.length ?? 0) > 0) return 'Consent items';
  const out = item && generic ? item : text.charAt(0).toUpperCase() + text.slice(1);
  return out.length > 140 ? `${out.slice(0, 137).replace(/\s+\S*$/, '')}...` : out;
}

/** The motion's own wording, when it says more than "approve item 5.4 as presented" (amendments, conditions). */
export function motionDetail(m: MotionRow): string | null {
  const text = m.motion.replace(/^to\s+/i, '').replace(/\s+/g, ' ').trim();
  const label = motionLabel(m);
  if (!text || label === text || label.toLowerCase() === text.toLowerCase()) return null;
  if (/^(approve|adopt|accept)\b[^.]{0,30}\b(as presented|as written)\.?(\s*\([^)]*\))?\s*$/i.test(text)) return null;
  if (/\bconsent\b/i.test(text) && !/\b(remov|except|without|pull)/i.test(text)) return null;
  return `Motion: ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
