/** Voting records: shapes from /api/votes and how a member's name is shown. */
import { usePeople, type Person } from './people';

export interface VoteRow {
  member: string;
  vote: 'yes' | 'no' | 'abstain' | 'recused' | 'absent' | string;
}
export interface MotionRow {
  id: string;
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

/** What was voted on, in a few words: the agenda item when the motion just says "approve item 5.4". */
export function motionLabel(m: MotionRow): string {
  const item = (m.item ?? '').replace(/^\d+(?:\.\d+)*\.?\s+/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const text = m.motion.replace(/^to\s+/i, '').replace(/\s+/g, ' ').trim();
  const generic = /^(approve|adopt|accept|deny|table|continue)\b[^.]{0,40}\b(as presented|as written|item|\d+\.\d+)/i.test(text) || text.length < 18;
  const out = item && generic ? item : text.charAt(0).toUpperCase() + text.slice(1);
  return out.length > 140 ? `${out.slice(0, 137).replace(/\s+\S*$/, '')}...` : out;
}
