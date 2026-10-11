/**
 * "How did the council vote on Ordinance 2026-07?", "How did Council Member McCumber vote on
 * Ordinance 2026-07?", "Who broke the tie on Ordinance 2026-07?": answered by code from the voting
 * records (the motions table read from the minutes): the result, the recorded tally, each member by
 * title and last name with their vote, the meeting date, and the minutes it is recorded in. Never the
 * model's wording, which drops titles and can misread a roll call. Pure: no Worker types.
 */
import { BODY_LABEL, longDay, memberTitle, type MeetingBody } from './meetingVotes';

export interface MeasureRef {
  kind: 'Ordinance' | 'Resolution';
  year: number;
  seq: number;
  /** As the answer writes it: "Ordinance 2026-07". */
  label: string;
}

export interface MeasureVotesIntent {
  ref: MeasureRef;
  /** 'tie': who broke a tie; 'mover': who moved and seconded; 'vote': how the members voted. */
  focus: 'vote' | 'tie' | 'mover';
}

const REF = /\b(ordinance|ord\.?|resolution|res\.?)\s*(?:no\.?\s*|number\s*|#\s*)?((?:19|20)\d{2})\s*[-‐-―]\s*(\d{1,3})\b/i;
const VOTE_WORDS = /\b(vot\w*|motion\w*|tie|tie-?break\w*|broke|pass(?:ed|es)?|approv\w*|adopt\w*|aye|nay|roll call|support\w*|oppos\w*|against|in favor|unanimous\w*|moved|seconded|split)\b/i;

const ITEM_VOTE = /\bhow did (?:the )?(?:city council|council|rda|redevelopment agency(?: board)?|planning commission|board|commission)\s+vote\s+(?:on|for)\s+(?:the\s+)?(.+?)\s*\??\s*$/i;

/**
 * "How did the council vote on the First Amendment to the Holdaway Fields development agreement?": a vote
 * question about an item named in words, not by number. The item as the question names it, or null.
 */
export function itemVoteIn(q: string): { label: string; phrase: string } | null {
  if (measureRefIn(q)) return null;
  const m = q.match(ITEM_VOTE);
  if (!m) return null;
  const phrase = m[1].replace(/\s+(?:at|in|on|during)\s+(?:the\s+)?(?:last|latest|recent|\w+ \d{1,2}).*$/i, '').trim();
  if (phrase.split(/\s+/).length < 2 || /^(it|that|this|them|those|these|his|her|their|its)\b/i.test(phrase)) return null;
  return { phrase, label: `the ${phrase}` };
}

/** "Ordinance 2026-07", "Ord. 2026-7", "RES 2026-16" in a message. */
export function measureRefIn(q: string): MeasureRef | null {
  const m = q.match(REF);
  if (!m) return null;
  const kind = /^o/i.test(m[1]) ? 'Ordinance' : 'Resolution';
  const year = Number(m[2]);
  const seq = Number(m[3]);
  return { kind, year, seq, label: `${kind} ${year}-${String(seq).padStart(2, '0')}` };
}

/** A question about how a numbered ordinance or resolution was voted on. */
export function measureVotesIntent(q: string): MeasureVotesIntent | null {
  const ref = measureRefIn(q);
  if (!ref || !VOTE_WORDS.test(q)) return null;
  const focus = /\btie\b|tie-?break|\bbroke\b/i.test(q) ? 'tie' : /\bwho\b[^?]*\b(second\w*|moved|made (?:the |that )?motion|motioned)\b/i.test(q) ? 'mover' : 'vote';
  return { ref, focus };
}

export interface MeasureMotion {
  date: string | null;
  bodyId: string | null;
  item: string | null;
  motion: string;
  mover: string | null;
  seconder: string | null;
  result: string;
  tally: string | null;
  tieBreak: boolean;
  unanimous: boolean;
  refs: string[];
  votes: Array<{ member: string; vote: string }>;
}

const refRe = (ref: MeasureRef) => new RegExp(`\\b(${ref.kind === 'Ordinance' ? 'ordinance|ord\\.?' : 'resolution|res\\.?'})\\s*(?:no\\.?\\s*)?${ref.year}\\s*[-\\u2010-\\u2015]\\s*0*${ref.seq}(?![\\d])`, 'i');

/** True when the motion is about this ordinance or resolution (its recorded refs, agenda item or wording). */
export function motionIsAbout(m: Pick<MeasureMotion, 'refs' | 'item' | 'motion'>, ref: MeasureRef): boolean {
  const re = refRe(ref);
  return [...m.refs, m.item ?? '', m.motion].some((t) => re.test(t));
}

/**
 * The motion that decided a measure, from the motions about it, newest first: one whose agenda item or
 * wording names the measure comes before one that only lists it among its references, then the newest
 * with a recorded result and roll call.
 */
export function decidingMotion<T extends Pick<MeasureMotion, 'refs' | 'item' | 'motion' | 'result' | 'votes'>>(newestFirst: T[], ref: MeasureRef): T | null {
  const re = refRe(ref);
  const direct = newestFirst.filter((m) => re.test(m.item ?? '') || re.test(m.motion));
  const pool = direct.length ? direct : newestFirst;
  return pool.find((m) => m.result !== 'unknown' && m.votes.length) ?? pool.find((m) => m.result !== 'unknown') ?? pool[0] ?? null;
}

const bodyOf = (id: string | null): MeetingBody => (id === 'redevelopment-agency' || id === 'planning-commission' ? id : 'city-council');

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "3-2" as "3 to 2". */
export function tallyWords(t: string | null): string | null {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(t ?? '');
  return m ? `${m[1]} to ${m[2]}` : null;
}

const VOTE_LABEL: Record<string, string> = { yes: 'Voting yes', no: 'Voting no', abstain: 'Abstaining', recused: 'Recused', absent: 'Absent' };

/**
 * The answer sentences for one motion, every value from the record. `mayor` is the mayor as of the
 * meeting (the minutes' attendance list, or the directory); `member` is the member the question
 * names, by the name the record uses, if any.
 */
export function measureVotesText(intent: { ref: { label: string }; focus: MeasureVotesIntent['focus'] }, m: MeasureMotion, mayor: string | null, member: string | null): string[] {
  const body = bodyOf(m.bodyId);
  const who = (n: string) => memberTitle(n, body, mayor);
  const where = `at the ${m.date ? `${longDay(m.date)} ` : ''}${BODY_LABEL[body]} meeting`;
  const label = intent.ref.label;
  const tally = tallyWords(m.tally);
  const verb = m.result === 'carried' ? 'passed' : m.result === 'failed' ? 'failed' : null;
  const lastOf = (n: string) => (n.trim().split(/\s+/).pop() ?? n).toLowerCase();
  const mayorVote = mayor ? m.votes.find((v) => lastOf(v.member) === lastOf(mayor)) : undefined;
  const tieBy = m.tieBreak ? (mayorVote ? who(mayorVote.member) : 'the mayor') : null;
  const tiePart = tieBy && intent.focus !== 'tie' ? `, ${tieBy} breaking the tie` : '';
  const head = verb
    ? `${label} ${verb}${tally ? ` ${tally}` : m.unanimous && !m.votes.length ? ' unanimously' : ''} ${where}${tiePart}.`
    : `The minutes of the ${m.date ? `${longDay(m.date)} ` : ''}${BODY_LABEL[body]} meeting record a vote on ${label} but not its result.`;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  const out: string[] = [];
  const moverLine = m.mover ? `${who(m.mover)} moved it${m.seconder ? ` and ${who(m.seconder)} seconded` : ''}.` : null;
  if (intent.focus === 'mover') out.push(moverLine ? moverLine.replace(/^(.+?) moved it/, `$1 moved ${label}`) : `The minutes record no mover for ${label}.`);
  if (intent.focus === 'tie') {
    if (m.tieBreak) out.push(`${tieBy![0].toUpperCase()}${tieBy!.slice(1)} broke the tie on ${label}${mayorVote ? `, voting ${mayorVote.vote}` : ''}, ${where}.`);
    else out.push(`The minutes record no tie on ${label}.`);
  }
  if (member) {
    const v = m.votes.find((x) => lastOf(x.member) === lastOf(member));
    const name = who(member);
    if (v) out.push(v.vote === 'yes' || v.vote === 'no' ? `${name} voted ${v.vote} on ${label} ${where}.` : `${name} is recorded as ${v.vote === 'absent' ? 'absent' : v.vote} on ${label} ${where}.`);
    else out.push(`The minutes record no vote by ${name} on ${label}.`);
  }
  out.push(cap(head));
  const groups = ['yes', 'no', 'abstain', 'recused', 'absent']
    .map((k) => ({ k, names: m.votes.filter((v) => v.vote === k).map((v) => who(v.member)).sort((a, b) => Number(a.startsWith('Mayor ')) - Number(b.startsWith('Mayor ')) || lastOf(a).localeCompare(lastOf(b))) }))
    .filter((g) => g.names.length);
  if (groups.length) out.push(`${groups.map((g) => `${VOTE_LABEL[g.k]}: ${list(g.names)}`).join('. ')}.`);
  else if (m.unanimous) out.push('The minutes record the vote as unanimous without listing each member.');
  if (moverLine && intent.focus !== 'mover') out.push(moverLine);
  return out;
}
