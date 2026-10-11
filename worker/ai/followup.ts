/**
 * Deterministic follow-up resolution. A message such as "who voted for it and how much did it
 * cost?" names no subject of its own: it refers back ("it", "that project", "they") or trails on
 * ("and the cost?"). Such a message is rewritten with the subject of the previous turns (the
 * previous question and the titles of the records the previous answer cited) before anything
 * searches, so retrieval never runs on a question with no topic. The model rewrite (rewrite.ts)
 * may do better; this is the floor it can never fall below. Pure: no Worker types.
 */

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
