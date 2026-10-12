/** Shapes and small helpers for the staff Votes screen. */

export type VoteValue = 'yes' | 'no' | 'abstain' | 'recused' | 'absent';

export interface RollVote {
  member: string;
  vote: VoteValue;
}

export interface MeetingRow {
  date: string;
  body: string;
  motions: number;
  edited: number;
}

export interface BodyOption {
  id: string;
  name: string;
}

export interface MotionItem {
  id: string;
  item: string | null;
  motion: string;
  mover: string | null;
  seconder: string | null;
  result: string;
  tally: string | null;
  inferred: boolean;
  manual: boolean;
  documentId: string;
  page: number | null;
  votes: RollVote[];
}

export interface MotionsReply {
  date: string;
  body: string;
  bodyName: string;
  motions: MotionItem[];
  roster: string[];
}

export interface Match {
  id: string;
  date: string;
  body: string;
  item: string | null;
  motion: string;
  manual: boolean;
}

export const VOTE_CHOICES: Array<{ value: VoteValue; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'abstain', label: 'Abstain' },
  { value: 'recused', label: 'Recused' },
  { value: 'absent', label: 'Absent' },
];

export const RESULT_LABEL: Record<string, string> = {
  carried: 'Carried',
  failed: 'Failed',
  unknown: 'Result not stated',
};

/** What the form holds for one member: a vote, or '' for "not recorded". */
export type Roll = Record<string, VoteValue | ''>;

/** The roll call as the form holds it: everyone on the roster, with the votes already recorded filled in. */
export function rollFrom(votes: RollVote[], roster: string[]): Roll {
  const roll: Roll = {};
  for (const n of roster) roll[n] = '';
  for (const v of votes) roll[v.member] = v.vote;
  return roll;
}

/** The roll call back as a list for the server, leaving out members with no vote recorded. */
export function votesFrom(roll: Roll): RollVote[] {
  return Object.entries(roll)
    .filter((e): e is [string, VoteValue] => e[1] !== '')
    .map(([member, vote]) => ({ member, vote }));
}

export function counts(roll: Roll): {
  yes: number;
  no: number;
  recorded: number;
} {
  const vals = Object.values(roll).filter((v) => v !== '');
  return {
    yes: vals.filter((v) => v === 'yes').length,
    no: vals.filter((v) => v === 'no').length,
    recorded: vals.length,
  };
}

/**
 * The same check the server makes, so the person is told before they save: a motion cannot be marked Carried
 * with more No than Yes, or Failed with more Yes than No. An empty string means the votes are fine.
 */
export function checkRoll(result: string, roll: Roll): string {
  const { yes, no, recorded } = counts(roll);
  if (!recorded) return '';
  if (result === 'carried' && yes < no) return 'The votes show more No than Yes, so this cannot be marked Carried. Check the votes.';
  if (result === 'failed' && yes > no) return 'The votes show more Yes than No, so this cannot be marked Failed. Check the votes.';
  return '';
}

/** "Carried 5-0", "Failed 2-3" or "Carried" when no roll call is kept. */
export function outcomeLabel(result: string, tally: string | null): string {
  const base = RESULT_LABEL[result] ?? 'Result not stated';
  return tally && result !== 'unknown' ? `${base} ${tally}` : base;
}

/** "Yes: A, B. No: C." in last-name order, for a short summary under a motion. */
export function rollSummary(votes: RollVote[]): string {
  const last = (n: string) => n.split(' ').pop() ?? n;
  const group = (v: VoteValue, label: string) => {
    const names = votes
      .filter((x) => x.vote === v)
      .map((x) => x.member)
      .sort((a, b) => last(a).localeCompare(last(b)));
    return names.length ? `${label}: ${names.join(', ')}.` : '';
  };
  return VOTE_CHOICES.map((c) => group(c.value, c.label))
    .filter(Boolean)
    .join(' ');
}

/** Today's date as the form's default, in the city's time zone's calendar day (no UTC shift). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "Sep 15, 2026 · City Council · 7 votes" for the meeting picker. */
export function meetingOption(m: MeetingRow, bodies: BodyOption[], day: (iso: string) => string): string {
  const body = bodies.find((b) => b.id === m.body)?.name ?? m.body;
  return `${day(m.date)} · ${body} · ${m.motions} ${m.motions === 1 ? 'vote' : 'votes'}`;
}

/** A blank vote for the "Add a vote" form. */
export const EMPTY_DRAFT = {
  item: '',
  motion: '',
  mover: '',
  seconder: '',
  result: '',
  votes: [] as RollVote[],
};
