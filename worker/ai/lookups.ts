/**
 * Lookups the chat answers by code, never by the model: a numbered record ("show Ordinance 2026-09"),
 * a meeting's minutes, agenda or packet ("find the minutes for the September 8 meeting"), what a body
 * voted on at its last meeting (or the one before), who moved and seconded, the fee schedule page for
 * a fee, and who to contact. Also the deterministic reading of short follow-ups ("what about the RDA?",
 * "and the one before that?", "who seconded it?", "show me the minutes"), the short clarifying question
 * asked instead of a guess (two meetings that day, two officials with that first name), and the
 * suggested follow-ups, each one a question one of these paths answers. Pure: no Worker types.
 */
import type { ConvTurn } from './followup';
import { BODY_LABEL, longDay, meetingBodyIn, meetingDateIn, MOVER_Q, type MeetingBody } from './meetingVotes';
import { measureRefIn } from './measureVotes';
import { questionWords } from './quotes';

/* ---------------------------------------------------------------------------------------------- */
/* Numbered records                                                                               */
/* ---------------------------------------------------------------------------------------------- */

export type RecordKind = 'ordinance' | 'resolution' | 'rda-resolution';
export interface RecordLookup {
  kind: RecordKind;
  year: number;
  /** "2026-09" as the index writes it. */
  number: string;
  /** "Ordinance 2026-09", "RDA Resolution 2026-03". */
  label: string;
}

const RDA_RES = /\b(?:rda|redevelopment agency)\s+resolution\s*(?:no\.?\s*|number\s*|#\s*)?(?:rda[-\s]?)?((?:19|20)\d{2})\s*[-‐-―]\s*(\d{1,3})\b|\bresolution\s+(?:no\.?\s*)?rda[-\s;]?((?:19|20)\d{2})\s*[-‐-―]\s*(\d{1,3})\b/i;
const VOTE_ASK = /\b(vot\w*|tie|broke|aye|nay|roll call|support\w*|oppos\w*|against|in favor|unanimous\w*|moved|seconded|split|who (?:made|moved|seconded))\b/i;

/** "Show Ordinance 2026-09", "what is Resolution 2026-34 about?", "RDA Resolution 2026-03": the record itself. */
export function recordLookupIntent(q: string): RecordLookup | null {
  if (VOTE_ASK.test(q)) return null;
  const rda = q.match(RDA_RES);
  if (rda) {
    const year = Number(rda[1] ?? rda[3]);
    const seq = Number(rda[2] ?? rda[4]);
    const number = `${year}-${String(seq).padStart(2, '0')}`;
    return { kind: 'rda-resolution', year, number, label: `RDA Resolution ${number}` };
  }
  const ref = measureRefIn(q);
  if (!ref) return null;
  const number = `${ref.year}-${String(ref.seq).padStart(2, '0')}`;
  return { kind: ref.kind === 'Ordinance' ? 'ordinance' : 'resolution', year: ref.year, number, label: `${ref.kind} ${number}` };
}

/** One row of GET /api/records/<kind>?year= (worker/api/records.ts). */
export interface IndexRow {
  number: string;
  title: string | null;
  adoptedOn: string | null;
  tally: string | null;
  unanimous: boolean;
  vote: string | null;
  minutes: { documentId: string; page: number | null } | null;
  document: { id: string; title: string; status?: string } | null;
  status: string;
  draft: { date: string | null; body: string | null } | null;
}

const BODY_OF_KIND: Record<RecordKind, string> = { ordinance: 'City Council', resolution: 'City Council', 'rda-resolution': 'Redevelopment Agency board' };

/** The sentences for a numbered record, every value from its index row. */
export function recordLookupText(r: RecordLookup, row: IndexRow | null): { sentences: Array<{ text: string; cite: 'document' | 'minutes' | null }> } {
  const out: Array<{ text: string; cite: 'document' | 'minutes' | null }> = [];
  if (!row || (!row.document && !row.title && !row.adoptedOn)) {
    out.push({ text: `The portal's ${r.kind === 'ordinance' ? 'ordinance' : 'resolution'} index for ${r.year} has no ${r.label} on file.`, cite: null });
    return { sentences: out };
  }
  const title = (row.title ?? row.document?.title ?? '').replace(/\s+/g, ' ').trim();
  out.push({ text: `${r.label}${title ? `: ${title}` : ''}.`, cite: row.document ? 'document' : null });
  if (row.adoptedOn) {
    const tally = row.tally ? ` by a vote of ${row.tally}` : row.unanimous ? ' unanimously' : '';
    const how = row.minutes ? `, as recorded in the minutes of that meeting` : '';
    out.push({ text: `The ${BODY_OF_KIND[r.kind]} adopted it on ${longDay(row.adoptedOn)}${tally}${how}.`, cite: row.minutes ? 'minutes' : row.document ? 'document' : null });
  } else if (row.status === 'draft' && row.draft?.date) {
    out.push({ text: `It is a draft, listed on the ${longDay(row.draft.date)} ${row.draft.body ?? ''} agenda`.replace(/\s+agenda$/, ' agenda').replace(/\s{2,}/g, ' ') + ', and has not been adopted.', cite: row.document ? 'document' : null });
  } else {
    out.push({ text: 'The portal holds no record of its adoption.', cite: null });
  }
  if (!row.document) out.push({ text: `The text of ${r.label} is not in the archive.`, cite: null });
  return { sentences: out };
}

/* ---------------------------------------------------------------------------------------------- */
/* A meeting's documents                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export type MeetingDocKind = 'minutes' | 'agenda' | 'agenda_packet';
export interface DocLookup {
  kind: MeetingDocKind;
  date: string | null;
  body: MeetingBody | null;
  /** "the last council meeting": the newest meeting of that body with this document. */
  latest: boolean;
}

const SHOW = /\b(show|find|where|get|link|open|see|read|pull up|look up|view|download|is there|are there|posted|available|have|copy of|send)\b/i;
const DOC_WORD = /\b(minutes|agenda packet|packet|agenda)\b/i;

/** "Find the minutes for the September 8 meeting", "show me the agenda for the last RDA meeting". */
export function docLookupIntent(q: string, today: string): DocLookup | null {
  const m = q.match(DOC_WORD);
  if (!m || !SHOW.test(q)) return null;
  // A question about what is in them goes to the records ("what did the minutes say about parking?").
  if (/\b(say|says|said|about|mention\w*|discuss\w*|regarding|on parking|who spoke|what happened)\b/i.test(q)) return null;
  const w = m[1].toLowerCase();
  const kind: MeetingDocKind = w === 'minutes' ? 'minutes' : w === 'agenda' ? 'agenda' : 'agenda_packet';
  const date = meetingDateIn(q, today);
  const latest = !date && /\b(last|latest|most recent|newest|previous|recent)\b/i.test(q);
  if (!date && !latest) return null;
  return { kind, date, body: meetingBodyIn(q), latest };
}

export const DOC_LABEL: Record<MeetingDocKind, string> = { minutes: 'minutes', agenda: 'agenda', agenda_packet: 'agenda packet' };

/* ---------------------------------------------------------------------------------------------- */
/* Votes at the last meeting, the one before, who moved and seconded                              */
/* ---------------------------------------------------------------------------------------------- */

export interface LastMeetingVotes {
  body: MeetingBody;
  /** The newest meeting before this date (exclusive); null for the newest of all. */
  before: string | null;
  kind: 'all' | 'no';
}

const LAST = /\b(last|latest|most recent|previous|recent)\b/i;
const WHAT_PASSED = /\b(vot\w*|approv\w*|pass(?:ed|es)?|adopt\w*|decid\w*|decisions?|motions?|actions?|happen\w*|do|did)\b/i;
const MEETING = /\b(meeting|session)\b/i;

/** "What passed at the last council meeting?", "what did the RDA approve at its most recent meeting?", "the meeting before September 8". */
export function lastMeetingIntent(q: string, today: string): LastMeetingVotes | null {
  if (!WHAT_PASSED.test(q) || !MEETING.test(q)) return null;
  if (/\b(discuss\w*|said|say|spoke|speak\w*|public comment|presentations?|about)\b/i.test(q)) return null;
  if (/\b(next|upcoming|tonight|tomorrow|agenda)\b/i.test(q)) return null;
  const body = meetingBodyIn(q) ?? (/\bcommission\b/i.test(q) ? null : 'city-council');
  if (!body) return null;
  const kind = /\b(vote[sd]?\s+(?:no|nay|against)|no\s+votes?|dissent\w*|not\s+unanimous)\b/i.test(q) ? 'no' : 'all';
  const before = q.match(/\b(?:meeting|session)\s+before\s+(?:the\s+)?(.+?)(?:\s+meeting)?[?.!]*$/i);
  if (before) {
    const d = meetingDateIn(before[1], today);
    if (d) return { body, before: d, kind };
  }
  if (meetingDateIn(q, today)) return null;
  if (!LAST.test(q)) return null;
  return { body, before: null, kind };
}

export { MOVER_Q };

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * "What did the council vote on in September?": a month with no day. The meetings that month answer it:
 * one meeting is answered, several are offered as choices. Null when the question names a day.
 */
export function monthVotesIntent(q: string, today: string): { body: MeetingBody; month: string } | null {
  if (!/\b(vot\w*|approv\w*|pass(?:ed|es)?|adopt\w*|decid\w*|motions?)\b/i.test(q) || meetingDateIn(q, today)) return null;
  if (!/\b(council|rda|redevelopment|planning commission|meetings?)\b/i.test(q)) return null;
  const m = q.match(/\b(?:in|during|for|from|at)\s+(?:the\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+((?:19|20)\d{2}))?\b/i);
  if (!m) return null;
  const mi = MONTH_NAMES.indexOf(m[1].toLowerCase()) + 1;
  let year = m[2] ? Number(m[2]) : Number(today.slice(0, 4));
  if (!m[2] && `${year}-${String(mi).padStart(2, '0')}` > today.slice(0, 7)) year -= 1;
  return { body: meetingBodyIn(q) ?? 'city-council', month: `${year}-${String(mi).padStart(2, '0')}` };
}

/** The names a motion question gives ("Jared Tamez"), else its two longest item words: what to find the motion by. */
export function motionSearchWords(q: string): string[] {
  const proper = [...q.matchAll(/\b([A-Z][a-z]{2,})\b/g)].map((m) => m[1].toLowerCase()).filter((w) => !/^(who|what|how|when|the|council|member|city|rda|redevelopment|agency|board|mayor|planning|commission|approve|ordinance|resolution|motion|seconded)$/.test(w));
  if (proper.length) return [...new Set(proper)].slice(0, 3);
  return itemWords(q).sort((a, b) => b.length - a.length).slice(0, 2);
}

/** The item words of a motion question ("who seconded the Library Board appointment?"): what to match a motion on. */
export function itemWords(q: string): string[] {
  return questionWords(q).filter((w) => !/^(who|seconded|second|moved|made|motion|motions|motioned|meeting|council|city|rda|redevelopment|agency|board|planning|commission|vote|voted|votes|night|that|first|it)$/.test(w) && !/^\d+$/.test(w) && !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(w));
}

/* ---------------------------------------------------------------------------------------------- */
/* Fees and contacts                                                                              */
/* ---------------------------------------------------------------------------------------------- */

const FEE = /\b(fees?|deposits?|how much (?:does it|do they|is it|will it) cost to|cost to (?:rent|reserve|get|have|file|apply)|rental (?:rate|cost|price)|utility rates?|water rates?|sewer rates?|garbage rates?|base rate|late fee|penalt(?:y|ies)|fines? for)\b/i;
/** Fee words that are budget or tax questions, answered elsewhere. */
const NOT_FEE = /\b(impact fee revenue|budget|tax rate|property tax|sales tax|revenue|waive[ds]?|waiver|vote[sd]?|approved|increase[ds]?|raise[ds]?|why)\b/i;

/** "How much is the pavilion rental fee?", "what are the water rates?": the subject words to find in the fee schedule. */
export function feeIntent(q: string): { words: string[] } | null {
  if (!FEE.test(q) || NOT_FEE.test(q)) return null;
  const words = questionWords(q).filter((w) => !/^(fee|fees|cost|costs|how|much|rate|rates|charge|charges|price|deposit|deposits|current|currently|pay)$/.test(w));
  if (!words.length) return null;
  return { words };
}

/** "Who do I contact about a pothole?", "who handles code enforcement?": a directory answer. */
export const CONTACT_Q = /\b(who (?:do|should|can) i (?:contact|call|email|talk to|ask|reach|report (?:it )?to)|who handles|who is in charge of|who'?s in charge of|who (?:do|should) i speak (?:to|with)|contact (?:for|about)|how (?:do|can) i (?:contact|reach) (?:the )?(?:city|someone))\b/i;

/* ---------------------------------------------------------------------------------------------- */
/* Follow-ups resolved from the conversation                                                      */
/* ---------------------------------------------------------------------------------------------- */

const BODY_PHRASE = /\b(?:the\s+)?(city council|council|rda|redevelopment agency(?: board)?|planning commission|library board)\b/i;
const BODY_FROM_PHRASE = (p: string): MeetingBody | 'library' | null => (/planning/i.test(p) ? 'planning-commission' : /rda|redevelopment/i.test(p) ? 'redevelopment-agency' : /library/i.test(p) ? 'library' : /council/i.test(p) ? 'city-council' : null);
const LABEL_OF = (b: MeetingBody | 'library') => (b === 'library' ? 'Library Board' : BODY_LABEL[b]);

/** The newest user question in the conversation (with what it resolved to, when the answer echoed it). */
function userTurns(conv: ConvTurn[]): string[] {
  return conv.filter((t) => t.role === 'user').map((t) => t.content);
}

/** The meeting (date and body) the conversation is about: the newest turn, answer or question, that names one. */
export function meetingInContext(conv: ConvTurn[], today: string): { date: string; body: MeetingBody } | null {
  for (let i = conv.length - 1; i >= 0; i--) {
    const t = conv[i];
    const date = meetingDateIn(t.content, today);
    if (!date) continue;
    if (t.role === 'assistant' && !/\b(meeting|motions?|minutes|agenda)\b/i.test(t.content)) continue;
    if (t.role === 'user' && !/\b(meeting|session|council|commission|rda|redevelopment|board|vot\w*|minutes|agenda|approv\w*)\b/i.test(t.content)) continue;
    // The body: this turn's, else the question before an answer.
    let body = meetingBodyIn(t.content);
    if (!body && t.role === 'assistant') body = meetingBodyIn(conv.slice(0, i).reverse().find((x) => x.role === 'user')?.content ?? '');
    return { date, body: body ?? 'city-council' };
  }
  return null;
}

/** The numbered measure the conversation is about (newest turn first). */
export function measureInContext(conv: ConvTurn[]): string | null {
  for (let i = conv.length - 1; i >= 0; i--) {
    const ref = measureRefIn(conv[i].content);
    if (ref) return `${ref.kind} ${ref.year}-${String(ref.seq).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Short follow-ups rewritten from the conversation, exactly (no model):
 *   "what about the RDA?" after "When is the next City Council meeting?" -> "When is the next Redevelopment Agency meeting?"
 *   "and the one before that?" after an answer about the September 8 meeting -> "What did the City Council vote on at the meeting before September 8, 2026?"
 *   "who seconded it?" after Ordinance 2026-07 -> "Who moved and seconded Ordinance 2026-07?"
 *   "show me the minutes" after the September 8 meeting -> "Show the minutes of the September 8, 2026 City Council meeting"
 * Null when the message stands on its own or the conversation names nothing to resolve it with.
 */
export function resolveFollowUp(question: string, conv: ConvTurn[], today: string): string | null {
  const q = question.trim().replace(/\s+/g, ' ');
  if (!conv.length || q.split(' ').length > 12) return null;
  // The previous question, with earlier "what about the RDA?" turns already resolved.
  let prev = '';
  for (const u of userTurns(conv)) prev = (prev ? swapBody(u, prev) : null) ?? u;

  const swapped = prev ? swapBody(q, prev) : null;
  if (swapped) return swapped;

  // "and the one before that?", "what about the meeting before?", "the previous one?"
  if (/^(?:and\s+|what about\s+|how about\s+)?(?:the\s+)?(?:one|meeting|session)\s+before(?:\s+that)?(?:\s+one)?\s*\??$|^(?:and\s+|what about\s+)?the\s+previous\s+(?:one|meeting)\s*\??$/i.test(q)) {
    const m = meetingInContext(conv, today);
    if (m) return `What did the ${BODY_LABEL[m.body]} vote on at the meeting before ${longDay(m.date)}?`;
  }

  // "who seconded it?", "who made the motion?": the measure or the meeting of the last question.
  if (MOVER_Q.test(q) && !measureRefIn(q) && !meetingDateIn(q, today) && !itemWords(q).length) {
    const users = userTurns(conv);
    const last = users[users.length - 1] ?? '';
    const ref = measureRefIn(last);
    const measure = ref ? `${ref.kind} ${ref.year}-${String(ref.seq).padStart(2, '0')}` : null;
    const m = measure ? null : meetingInContext(conv, today);
    const other = measure ?? (m ? null : measureInContext(conv));
    if (other) return `Who moved and seconded ${other}?`;
    if (m) return `Who moved and seconded the motions at the ${longDay(m.date)} ${BODY_LABEL[m.body]} meeting?`;
  }

  // "How did the council vote on it?", "was it unanimous?", "who voted against it?" after a numbered measure.
  if (/\b(it|that|this)\b/i.test(q) && /\b(vot\w*|pass(?:ed)?|adopt\w*|approv\w*|unanimous|against|tie)\b/i.test(q) && !measureRefIn(q) && !meetingDateIn(q, today)) {
    const users = userTurns(conv);
    const ref = measureRefIn(users[users.length - 1] ?? '');
    if (ref) {
      const label = `${ref.kind} ${ref.year}-${String(ref.seq).padStart(2, '0')}`;
      return q.replace(/\b(it|that|this)\b/i, label).replace(/^\w/, (c) => c.toUpperCase());
    }
  }

  // "show me the minutes", "is there an agenda?", "the packet?"
  const doc = q.match(/^(?:(?:can you\s+)?(?:show|send|give|get|find|open|link)(?:\s+me)?\s+|where (?:are|is)\s+|is there\s+(?:a|an)?\s*|are there\s+|and\s+|what about\s+)?(?:the\s+)?(minutes|agenda packet|packet|agenda)(?:\s+(?:for|of|from)\s+(?:it|that|that meeting|this meeting|the meeting))?\s*\??$/i);
  if (doc) {
    const m = meetingInContext(conv, today);
    if (m) return `Show the ${doc[1].toLowerCase()} of the ${longDay(m.date)} ${BODY_LABEL[m.body]} meeting`;
  }
  return null;
}

/** "what about the RDA?" with the previous question: that question about the RDA. Null when not a body swap. */
export function swapBody(q: string, prev: string): string | null {
  const swap = q.trim().match(/^(?:(?:ok(?:ay)?|so)[,\s]+)?(?:and|what about|how about|same for|and what about)\s+(?:for\s+)?(?:the\s+)?(city council|council|rda|redevelopment agency(?: board)?|planning commission|library board)\s*\??$/i);
  if (!swap) return null;
  const to = BODY_FROM_PHRASE(swap[1]);
  if (!to) return null;
  const label = LABEL_OF(to);
  if (BODY_PHRASE.test(prev)) return prev.replace(BODY_PHRASE, (m) => (/^the\s/i.test(m) ? `the ${label}` : label));
  if (/\bmeeting\b/i.test(prev)) return prev.replace(/\bmeeting\b/i, `${label} meeting`);
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Clarifying questions                                                                           */
/* ---------------------------------------------------------------------------------------------- */

export interface Clarify {
  prompt: string;
  choices: Array<{ label: string; question: string }>;
}

/** "What did they vote on September 15?" when the council and the RDA both met that day: which one. */
export function bodyClarify(q: string, date: string, bodies: MeetingBody[]): Clarify | null {
  if (meetingBodyIn(q) || bodies.length < 2) return null;
  const choices = bodies.slice(0, 4).map((b) => {
    const label = BODY_LABEL[b];
    let text = q.replace(/[?.!\s]+$/, '');
    if (/\b(?:the|that|this)\s+meeting\b/i.test(text)) text = text.replace(/\b(?:the|that|this)\s+meeting\b/i, `the ${label} meeting`);
    else if (/\bmeeting\b/i.test(text)) text = text.replace(/\bmeeting\b/i, `${label} meeting`);
    else text = `${text} at the ${label} meeting`;
    return { label, question: `${text.replace(/\bthey\b/i, `the ${label}`)}?` };
  });
  return { prompt: `${bodies.length === 2 ? 'Two' : bodies.length === 3 ? 'Three' : 'Several'} bodies met on ${longDay(date)}. Which meeting do you mean?`, choices };
}

/**
 * "How did Jacob vote on Ordinance 2026-07?" when two officials are named Jacob: which one. Officials
 * are given as "First Last" with their title; the question names a first name and none of their last names.
 */
export function personClarify(q: string, officials: Array<{ name: string; title: string }>): Clarify | null {
  const text = ` ${q.toLowerCase().replace(/[^a-z' ]+/g, ' ')} `;
  const byFirst = new Map<string, Array<{ name: string; title: string }>>();
  for (const o of officials) {
    const parts = o.name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const first = parts[0].toLowerCase();
    byFirst.set(first, [...(byFirst.get(first) ?? []), o]);
  }
  for (const [first, list] of byFirst) {
    if (list.length < 2 || !text.includes(` ${first} `) && !text.includes(` ${first}'s `)) continue;
    const lasts = list.map((o) => o.name.trim().split(/\s+/).pop()!.toLowerCase());
    if (lasts.some((l) => text.includes(` ${l} `) || text.includes(` ${l}'`))) continue;
    const re = new RegExp(`\\b${first}\\b`, 'i');
    return {
      prompt: `${list.length === 2 ? 'Two' : 'Several'} officials are named ${list[0].name.split(/\s+/)[0]}. Which one do you mean?`,
      choices: list.slice(0, 4).map((o) => {
        const who = `${o.title} ${o.name.trim().split(/\s+/).pop()}`;
        return { label: who, question: q.replace(re, who) };
      }),
    };
  }
  return null;
}

/* ---------------------------------------------------------------------------------------------- */
/* Suggested follow-ups: only questions a code path answers                                       */
/* ---------------------------------------------------------------------------------------------- */

export interface FollowUpContext {
  engine: string;
  /** The meeting the answer was about. */
  meeting?: { date: string; body: MeetingBody } | null;
  /** The numbered measure the answer was about ("Ordinance 2026-07"). */
  measure?: string | null;
  /** The body a schedule answer was about ("Planning Commission"). */
  scheduleBody?: string | null;
  /** A motion list answer had a No vote. */
  hadNo?: boolean;
  /** The minutes document is in the archive for that meeting. */
  hasMinutes?: boolean;
}

/** Up to three follow-ups for an answer, every one answerable by a code path for that context. */
export function suggestFollowUps(c: FollowUpContext): string[] {
  const out: string[] = [];
  const m = c.meeting;
  const at = m ? `the ${longDay(m.date)} ${BODY_LABEL[m.body]} meeting` : '';
  switch (c.engine) {
    case 'votes-meeting':
      if (m) {
        out.push(`Who moved and seconded the motions at ${at}?`);
        if (c.hasMinutes !== false) out.push(`Show the minutes of ${at}`);
        out.push(`What did the ${BODY_LABEL[m.body]} vote on at the meeting before ${longDay(m.date)}?`);
      }
      break;
    case 'votes-measure':
      if (c.measure) out.push(`Show ${c.measure}`);
      if (m) {
        out.push(`What else did the ${BODY_LABEL[m.body]} vote on at its ${longDay(m.date)} meeting?`);
        out.push(`Show the minutes of ${at}`);
      }
      break;
    case 'record-lookup':
      if (c.measure && m) out.push(`How did the ${BODY_LABEL[m.body]} vote on ${c.measure}?`);
      if (m) out.push(`Show the minutes of ${at}`);
      break;
    case 'meeting-docs':
      if (m) {
        out.push(`What did the ${BODY_LABEL[m.body]} vote on at its ${longDay(m.date)} meeting?`);
        out.push(`Show the agenda of ${at}`);
      }
      break;
    case 'schedule': {
      const b = c.scheduleBody ?? 'City Council';
      if (/^(City Council|Redevelopment Agency|Planning Commission)$/.test(b)) out.push(`What did the ${b} vote on at its last meeting?`);
      for (const other of ['City Council', 'Planning Commission', 'Redevelopment Agency']) if (other !== b && out.length < 3) out.push(`When is the next ${other} meeting?`);
      break;
    }
    case 'budget-data':
      out.push('What is the total city budget?', 'What is the property tax rate?', 'When was the budget amended?');
      break;
    case 'tax-rate-data':
      out.push('What was the property tax rate for fiscal 2026?', 'How much revenue does property tax bring in?');
      break;
    default:
      break;
  }
  return [...new Set(out)].slice(0, 3);
}
