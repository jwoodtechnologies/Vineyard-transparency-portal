/**
 * Deterministic follow-up resolution. A message such as "who voted for it and how much did it
 * cost?" names no subject of its own: it refers back ("it", "that project", "they") or trails on
 * ("and the cost?"). Such a message is rewritten with the subject of the previous turns (the
 * previous question and the titles of the records the previous answer cited) before anything
 * searches, so retrieval never runs on a question with no topic. The model rewrite (rewrite.ts)
 * may do better; this is the floor it can never fall below. Pure: no Worker types.
 */

import { hasFigure, sentenceNumbers } from './answer';

export type ConvTurn = { role: 'user' | 'assistant'; content: string; sources?: string[] };

/** Words that refer back to something said before. */
export const ANAPHORA = /\b(it|its|it's|that|this|those|these|they|them|their|there|that one|this one|that project|this project|the project|the same|same one)\b/i;
const TRAILING = /^\s*(and|also|what about|how about|so|then|but|plus)\b/i;

/** Words that carry no subject: question words, pronouns, verbs and nouns any question uses. */
const GENERIC = new Set(
  (
    'a an the and or but so then also plus of on in at to for from with by about as into over under up out off ' +
    'who whom whose what whats which when where why how is are was were be been being am do does did done doing ' +
    'will would could should can may might must shall has have had having get got it its they them their there ' +
    'this that those these he she his her him we our us you your i me my one ones same else more most much many ' +
    'some any all each every other another such only just very really please tell show give explain detail details ' +
    'vote voted votes voting voter voters motion moved second seconded approve approved approval pass passed adopt adopted ' +
    'decide decided decision decisions support supported oppose opposed against favor yes no aye nay ' +
    'cost costs costing spend spent spending paid pay pays price priced amount amounts money budget budgeted funding funded fund dollars total ' +
    'happen happened happening going status update updates progress news latest current currently now still yet ' +
    'start started starting begin began finish finished done complete completed end ended open opened close closed ' +
    'long soon time date dates year years month months day days week weeks ' +
    'project projects thing things item items part parts work works plan plans planned ' +
    'city council vineyard mayor members member staff record records say said says mean means know find found ' +
    'like look looks need needs want wants think about why'
  ).split(/\s+/),
);

const words = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[^A-Za-z0-9' -]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/i, ''))
    .filter(Boolean);

/** The words of a message that name a subject (roads, places, projects, people, numbers). */
export function topicWords(q: string): string[] {
  return words(q).filter((w) => (/^\d{2,}$/.test(w) || w.length >= 3) && !GENERIC.has(w.toLowerCase()));
}

/** True when the message refers back or trails on and names no subject of its own. */
export function needsCarryOver(q: string): boolean {
  const t = q.trim();
  if (!t) return false;
  if (/^[?.!\s]*$/.test(t) || /^(explain|why|how so|more|go on|details?)\??$/i.test(t)) return true;
  return (ANAPHORA.test(t) || TRAILING.test(t)) && topicWords(t).length === 0;
}

/** Record titles reduced to their subject: dates, file names and generic record words removed. */
export function titleSubject(title: string): string {
  return title
    .replace(/\.(pdf|docx?|html?)$/i, '')
    .replace(/\(recorded vote\)/gi, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*(\d{4})?/gi, ' ')
    .replace(/\b(city council|planning commission|redevelopment agency|rda|regular|special|work session|meeting|meetings|minutes|agenda|packet|staff report|draft|approved|final|page|item|attachment|exhibit|vineyard|city|utah)\b/gi, ' ')
    .replace(/[_|]+/g, ' ')
    .replace(/\s*[-,:;]\s*(?=[-,:;]|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
}

export interface PriorTopic {
  /** The subject words of the previous question, in order. */
  phrase: string;
  /** The subjects of the records the previous answer cited (at most two). */
  titles: string[];
  /** Every subject word, for checking that a rewrite kept the topic. */
  terms: string[];
}

/** The subject of the conversation so far: the latest user turn that had one, and what its answer cited. */
export function priorTopic(conversation: ConvTurn[]): PriorTopic | null {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const t = conversation[i];
    if (t.role !== 'user') continue;
    const topic = topicWords(t.content);
    if (!topic.length) continue;
    const answer = conversation.slice(i + 1).find((x) => x.role === 'assistant');
    const titles = [...new Set((answer?.sources ?? []).map(titleSubject).filter((s) => s.length >= 4 && topicWords(s).length > 0))].slice(0, 2);
    const terms = [...new Set([...topic, ...titles.flatMap(topicWords)].map((w) => w.toLowerCase()))];
    return { phrase: topic.join(' '), titles, terms };
  }
  return null;
}

const REFERENT: RegExp[] = [/\b(that project|this project|the project|that one|this one|the same one)\b/i, /\bit\b/i, /\bthem\b/i, /\bthat\b/i, /\bthis\b/i, /\bthose\b/i, /\bthese\b/i, /\bthey\b/i];

/**
 * "who voted for it and how much did it cost?" after a question about Holdaway Fields becomes
 * "who voted for Holdaway Fields and how much did it cost? (records: ...)". Null when the message
 * names its own subject, or there is no earlier subject to carry over.
 */
export function carryOver(question: string, conversation: ConvTurn[]): { standalone: string; terms: string[] } | null {
  if (!needsCarryOver(question)) return null;
  const prior = priorTopic(conversation);
  if (!prior) return null;
  const q = question.trim();
  let text: string;
  if (/^[?.!\s]*$/.test(q) || /^(explain|why|how so|more|go on|details?)\??$/i.test(q)) text = `More detail about ${prior.phrase}`;
  else {
    const re = REFERENT.find((r) => r.test(q));
    text = re ? q.replace(re, prior.phrase) : `${q.replace(/[?.!\s]+$/, '')} about ${prior.phrase}`;
  }
  text = text.replace(/[?.!\s]+$/, '');
  const records = prior.titles.length ? ` (${prior.titles.join('; ')})` : '';
  return { standalone: `${text}${records}?`, terms: prior.terms };
}

/** Does a rewritten question still carry the earlier subject? */
export function keepsTopic(standalone: string, terms: string[]): boolean {
  const lower = ` ${standalone.toLowerCase()} `;
  return terms.some((t) => lower.includes(t));
}

/**
 * Elliptical follow-ups: "and parks?", "what about the library?", "and for 2026?". The message is a
 * new subject (or a new time) dropped into the previous question's frame, so the previous question
 * is kept word for word and only its subject (or its time) is swapped:
 *   "How much is the city spending on police and fire in the FY27 budget?" + "and parks?"
 *   -> "How much is the city spending on parks in the FY27 budget?"
 * This runs before the model rewrite and wins over it. Pure.
 */

/** Words that frame a question (what is asked about a subject), never the subject itself. */
const FRAME = new Set(
  (
    'spend spends spending spent budget budgets budgeted cost costs costing much revenue revenues income fund funds funding funded ' +
    'money dollars total totals allocate allocated allocation allocations appropriation appropriations appropriated tax taxes fee fees ' +
    'vote votes voted voting agenda agendas meeting meetings minutes ordinance ordinances resolution resolutions salary salaries wage wages ' +
    'pay paid staff staffing employees employee positions headcount fiscal year years adopted adoption final tentative proposed amended amendment ' +
    'approved department departments division divisions contract contracts construction status schedule increase decrease change changes ' +
    'compared percent share line lines item items expense expenses expenditure expenditures operating capital get gets receive receives ' +
    'next last upcoming recent previous latest first new old today tonight week near around between along across behind past within ' +
    'without after before during since until through via per versus'
  ).split(/\s+/),
);

const LEAD = /^\s*(?:(?:ok(?:ay)?|so|right|thanks|thank you)[,.!]?\s+)?(?:and\s+(?:what|how)\s+about|what\s+about|how\s+about|same\s+(?:question\s+)?for|and|also|plus|or)\b[\s,]*/i;
const NOT_A_FRAGMENT = /\b(is|are|was|were|be|do|does|did|will|would|can|could|should|has|have|had|who|what|when|where|why|how|which|it|its|they|them|their|that|this|those|these|he|she|i|me|my|we|you)\b/i;
/** A time on its own: "2026", "FY26", "FY 2026", "fiscal year 2026", "last year". */
const TIME_ALONE = /^(?:(?:the\s+)?(?:fy\s?'?\d{2}(?:\d{2})?|fiscal\s+(?:year\s+)?\d{2,4}|(?:19|20)\d{2}(?:\s*-\s*\d{2,4})?)(?:\s+budget)?|(?:last|this|next|prior|previous)\s+(?:fiscal\s+)?year)$/i;
/** A time inside a question. */
const TIME_IN = /\b(?:fiscal\s+(?:year\s+)?\d{2,4}|fy\s?'?\d{2}(?:\d{2})?|(?:19|20)\d{2}(?:\s*-\s*\d{2,4})?|(?:last|this|next|prior|previous)\s+(?:fiscal\s+)?year)\b/i;
const CONNECT = new Set(['and', '&', 'or', 'of']);

/** The new subject or time of an elliptical follow-up, or null when the message is not one. */
export function ellipticalFragment(q: string): { subject: string } | { time: string } | null {
  const t = q.trim();
  const lead = t.match(LEAD);
  if (!lead) return null;
  let frag = t
    .slice(lead[0].length)
    .replace(/[?.!\s]+$/, '')
    .trim();
  if (!frag || frag.split(/\s+/).length > 5 || NOT_A_FRAGMENT.test(frag)) return null;
  const timeFrag = frag.replace(/^(?:for|in|during|of|from)\s+/i, '').trim();
  if (TIME_ALONE.test(timeFrag)) return { time: timeFrag.replace(/^the\s+/i, '').replace(/\s+budget$/i, '') };
  // "and parks spending?" is "parks"; "and for the library?" is "the library".
  frag = frag.replace(/^(?:for|on|in|at|to|with)\s+/i, '').replace(/^(?:the|a|an)\s+/i, '');
  const ws = frag.split(/\s+/);
  while (ws.length && FRAME.has(ws[ws.length - 1].toLowerCase())) ws.pop();
  while (ws.length && FRAME.has(ws[0].toLowerCase())) ws.shift();
  if (!ws.length || TIME_IN.test(ws.join(' '))) return null;
  if (!topicWords(ws.join(' ')).length) return null;
  return { subject: ws.join(' ') };
}

const isSubjectWord = (w: string) => {
  const c = w.replace(/[‘’]/g, "'").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').replace(/'s$/i, '');
  if (!c) return false;
  if (TIME_IN.test(c) && /\d/.test(c)) return false;
  if (FRAME.has(c.toLowerCase())) return false;
  return topicWords(c).length > 0;
};

/** Swap the subject of a question for a new one; null when the question has no subject to swap. */
export function swapSubject(prev: string, subject: string): string | null {
  // Tokens with their positions, so everything outside the subject stays exactly as written.
  const toks = [...prev.matchAll(/\S+/g)].map((m) => ({ w: m[0], at: m.index ?? 0 }));
  let best: [number, number] | null = null;
  for (let i = 0; i < toks.length; i++) {
    if (!isSubjectWord(toks[i].w)) continue;
    let j = i;
    // A subject run ends at punctuation that closes a phrase ("police and fire, and ...").
    for (let k = i + 1; k < toks.length && !/[,;:.?!)]$/.test(toks[k - 1].w); k++) {
      if (isSubjectWord(toks[k].w)) j = k;
      else if (CONNECT.has(toks[k].w.toLowerCase()) && !/[,;:.?!]$/.test(toks[k].w)) continue;
      else break;
    }
    if (!best || j - i > best[1] - best[0]) best = [i, j];
    i = j;
  }
  if (!best) return null;
  const start = toks[best[0]].at;
  const lastTok = toks[best[1]];
  const word = lastTok.w.replace(/[^A-Za-z0-9']+$/, '');
  const end = lastTok.at + word.length;
  return `${prev.slice(0, start)}${subject}${prev.slice(end)}`;
}

/** Swap (or add) the time of a question. */
export function swapTime(prev: string, time: string): string {
  if (TIME_IN.test(prev)) return prev.replace(TIME_IN, time);
  return `${prev.replace(/[?.!\s]+$/, '')} in ${time}?`;
}

/** The previous user question, with earlier elliptical follow-ups already resolved. */
export function previousQuestion(conversation: ConvTurn[]): string | null {
  let last: string | null = null;
  for (const t of conversation) {
    if (t.role !== 'user') continue;
    const resolved: string | null = last ? substitute(t.content, last) : null;
    if (resolved) last = resolved;
    else if (topicWords(t.content).length) last = t.content.trim();
  }
  return last;
}

function substitute(question: string, prev: string): string | null {
  const frag = ellipticalFragment(question);
  if (!frag) return null;
  const out = 'time' in frag ? swapTime(prev, frag.time) : swapSubject(prev, frag.subject);
  if (!out) return null;
  const text = out.replace(/\s+/g, ' ').trim();
  return /[?.!]$/.test(text) ? text : `${text}?`;
}

/**
 * "and parks?" after "How much is the city spending on police and fire in the FY27 budget?" is
 * "How much is the city spending on parks in the FY27 budget?". Null when the message is not an
 * elliptical follow-up or there is no earlier question to take the frame from.
 */
export function ellipticalFollowUp(question: string, conversation: ConvTurn[]): string | null {
  const prev = previousQuestion(conversation);
  return prev ? substitute(question, prev) : null;
}

/**
 * How well a passage of a record the previous answer cited serves a follow-up: each figure of that
 * answer the passage holds counts most (the follow-up may repeat it, and the source check needs the
 * passage that states it), then each subject word of the follow-up. Zero when it holds neither.
 */
export function priorPassageScore(text: string, previousAnswer: string, question: string): number {
  const flatText = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const figures = sentenceNumbers(previousAnswer.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, ''));
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const subject = [...new Set(topicWords(question).map((w) => w.toLowerCase()))];
  return figures.filter((forms) => hasFigure(flatText, forms)).length * 3 + subject.filter((w) => lower.includes(` ${w} `)).length;
}
