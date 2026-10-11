/**
 * "What did the City Council vote on at the September 8 meeting?" and the follow-up "did anyone
 * vote no that night?" are answered from the voting records (the motions table read from the
 * minutes), written by code: every recorded motion of that one meeting (body and date), each with
 * its result, or the motions with a No vote and who cast it. Never the model's summary, which can
 * leave a motion out. Pure: no Worker types.
 */
import type { ConvTurn } from './followup';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_NAMES = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';

export type MeetingBody = 'city-council' | 'redevelopment-agency' | 'planning-commission';
export const BODY_LABEL: Record<MeetingBody, string> = { 'city-council': 'City Council', 'redevelopment-agency': 'Redevelopment Agency', 'planning-commission': 'Planning Commission' };

const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;

/** The meeting date a message names ("September 8", "Sept. 8th, 2026", "9/8", "2026-09-08"), as ISO. A date with no year is the most recent one on or before today. */
export function meetingDateIn(q: string, today: string): string | null {
  const ty = Number(today.slice(0, 4));
  const pick = (y: number | null, m: number, d: number): string | null => {
    if (y != null) return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
    for (const yy of [ty, ty - 1]) {
      const iso = `${yy}-${pad(m)}-${pad(d)}`;
      if (valid(yy, m, d) && iso <= today) return iso;
    }
    return null;
  };
  const iso = q.match(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return pick(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const named = q.match(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+((?:19|20)\\d{2}))?`, 'i'));
  if (named) {
    const m = MONTHS.findIndex((x) => x.startsWith(named[1].toLowerCase().replace(/\.$/, '').slice(0, 3))) + 1;
    return m ? pick(named[3] ? Number(named[3]) : null, m, Number(named[2])) : null;
  }
  // "9/8", "9/8/26", "9.8.26" (a dotted date needs its year, so "3.5 million" is not March 5).
  const slash = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/((?:19|20)?\d{2}))?\b(?!\/)/) ?? q.match(/\b(\d{1,2})\.(\d{1,2})\.((?:19|20)?\d{2})\b/);
  if (slash) {
    const y = slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : null;
    return pick(y, Number(slash[1]), Number(slash[2]));
  }
  return null;
}

/** "2026-09-08" as "September 8, 2026". */
export function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

export function meetingBodyIn(q: string): MeetingBody | null {
  if (/planning commission/i.test(q)) return 'planning-commission';
  if (/\bRDA\b|redevelopment/i.test(q)) return 'redevelopment-agency';
  if (/\bcouncil\b/i.test(q)) return 'city-council';
  return null;
}

const VOTED = /\b(vote[sd]?|voting|approv\w*|pass(?:ed|es)?|adopt\w*|decid\w*|decisions?|motions?|actions?|roll calls?|nay|dissent\w*|unanimous\w*)\b/i;
const NO_VOTE = /\b(vote[sd]?\s+(?:no|nay|against)|voting\s+(?:no|against)|no\s+votes?|nays?|dissent\w*|opposed|against|not\s+unanimous|split\s+votes?)\b/i;
const MEETINGISH = /\b(meeting|session|council|commission|rda|redevelopment|board|night|evening)\b/i;

export interface MeetingVotesIntent {
  date: string;
  body: MeetingBody;
  /** 'no': only the motions with a No vote; 'all': every recorded motion. */
  kind: 'all' | 'no';
}

/** "What did the city council vote on at the September 8 meeting?", "did anyone vote no at the 9/8 meeting?". */
export function meetingVotesIntent(q: string, today: string): MeetingVotesIntent | null {
  if (!VOTED.test(q) || !MEETINGISH.test(q)) return null;
  const date = meetingDateIn(q, today);
  if (!date) return null;
  return { date, body: meetingBodyIn(q) ?? 'city-council', kind: NO_VOTE.test(q) ? 'no' : 'all' };
}

/** Words that point back at a meeting named earlier in the conversation. */
const MEETING_REF = /\b(?:at |in |during |from |on )?(?:that|this|the same|the) (?:night|meeting|evening|session|day)\b|\bat it\b|\bthat night\b|\bthen\b/i;

/**
 * "did anyone vote no that night?" after a question about the September 8 City Council meeting
 * becomes "Did anyone vote no at the September 8, 2026 City Council meeting?". A message with its
 * own date stands alone. Null when no earlier turn named a meeting date.
 */
export function meetingFollowUp(question: string, conversation: ConvTurn[], today: string): string | null {
  const q = question.trim();
  if (meetingDateIn(q, today)) return null;
  const refers = MEETING_REF.test(q);
  const voteAsk = VOTED.test(q);
  // "anyone vote no?", "was it unanimous?": a short vote question with no subject of its own.
  const bareVote = voteAsk && q.split(/\s+/).length <= 10 && /\b(any(?:one|body)|every(?:one|body)|who|was it|were they|all of them|members?)\b/i.test(q);
  if (!refers && !bareVote) return null;
  for (let i = conversation.length - 1; i >= 0; i--) {
    const t = conversation[i];
    if (t.role !== 'user') continue;
    const date = meetingDateIn(t.content, today);
    if (!date || !(MEETINGISH.test(t.content) || VOTED.test(t.content))) continue;
    const body = meetingBodyIn(t.content) ?? 'city-council';
    const where = `at the ${longDay(date)} ${BODY_LABEL[body]} meeting`;
    if (voteAsk && NO_VOTE.test(q)) return `Did anyone vote no ${where}?`;
    if (voteAsk) return `What did the ${BODY_LABEL[body]} vote on at its ${longDay(date)} meeting?`;
    if (!refers) return null;
    const text = q.replace(MEETING_REF, where).replace(/\s+/g, ' ').replace(/[?.!\s]+$/, '');
    return `${text[0].toUpperCase()}${text.slice(1)}?`;
  }
  return null;
}

export interface MeetingMotion {
  item: string | null;
  motion: string;
  result: string;
  tally: string | null;
  items: string[];
  votes: Array<{ member: string; vote: string }>;
}

/** A member as the answer names them: title and last name ("Council Member McCumber", "Mayor Stratton"). */
export function memberTitle(name: string, body: MeetingBody, mayor: string | null): string {
  const last = name.trim().split(/\s+/).pop() ?? name;
  if (mayor && (mayor === name || (mayor.split(/\s+/).pop() ?? '') === name)) return `Mayor ${last}`;
  return `${body === 'planning-commission' ? 'Commissioner' : body === 'redevelopment-agency' ? 'Board Member' : 'Council Member'} ${last}`;
}

const tidy = (s: string) => s.replace(/\s*[\u2013\u2014]\s*/g, (d) => (/\s/.test(d) ? ' - ' : '-')).replace(/\s+/g, ' ').replace(/^(\d+(?:\.\d+)*\s+)?discussion and action\s*-\s*/i, '$1').trim();

/** What a motion was about, as recorded: its agenda item (and consent items), then the motion. */
export function motionLine(m: MeetingMotion): string {
  const item = m.item ? tidy(m.item) : '';
  const consent = m.items.length ? ` (${m.items.map(tidy).join('; ')})` : '';
  const motion = `motion to ${tidy(m.motion).replace(/^to\s+/i, '')}`;
  const res = m.result === 'carried' ? 'Passed' : m.result === 'failed' ? 'Failed' : 'Result not recorded';
  const head = item ? `${item}${consent}: ${motion}` : `${motion[0].toUpperCase()}${motion.slice(1)}${consent}`;
  return `${head}. ${res}${m.tally ? ` ${m.tally}` : ''}.`;
}

/** The answer sentences, every value from the motions as recorded. */
export function meetingVotesText(intent: MeetingVotesIntent, motions: MeetingMotion[], mayor: string | null): string[] {
  const label = BODY_LABEL[intent.body];
  const when = longDay(intent.date);
  if (intent.kind === 'no') {
    const withNo = motions.filter((m) => m.votes.some((v) => v.vote === 'no'));
    if (!withNo.length) {
      return motions.every((m) => m.result === 'carried')
        ? [`Every recorded motion at the ${when} ${label} meeting passed, with no No votes.`]
        : [`No member voted No on any recorded motion at the ${when} ${label} meeting.`];
    }
    return [
      `${withNo.length === 1 ? 'One recorded motion' : `${withNo.length} recorded motions`} at the ${when} ${label} meeting had a No vote:`,
      ...withNo.map((m) => {
        const no = m.votes.filter((v) => v.vote === 'no').map((v) => memberTitle(v.member, intent.body, mayor));
        return `${motionLine(m)} Voting No: ${no.join(', ')}.`;
      }),
    ];
  }
  return [`The ${label} recorded ${motions.length === 1 ? 'one motion' : `${motions.length} motions`} at its ${when} meeting:`, ...motions.map(motionLine)];
}
