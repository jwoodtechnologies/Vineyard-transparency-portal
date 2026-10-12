/**
 * What Ask says when no model writes the answer, and which records it shows instead. Pure: no Worker
 * types, unit-tested.
 *
 * The answer body is never a dump of record quotes. When no model can run (the daily Neuron cap or a
 * Workers AI quota error), the reply is one plain line saying when AI answers resume, with the best
 * matching records as cards under it. Records that only share a word with the question are left out.
 */
import { aiResumesAt, TESTS_SPENT } from './meter';
import { questionWords, sentenceScore } from './quotes';
import { longDay } from './meetingVotes';

/** "6 PM Mountain" (daylight time) or "5 PM Mountain" (standard time): when AI answers resume (meter.ts aiResumesAt). */
export function resumeLabel(now: Date = new Date()): string {
  return aiResumesAt(now).mountainLabel;
}

/** An error that means no model will run until the daily allowance resets. */
export const QUOTA_ERROR = new RegExp(`4006|daily free allocation|neuron|quota|daily answer limit|paused after a quota error|${TESTS_SPENT}`, 'i');

export type NoModelReason = 'paused' | 'off' | 'failed' | 'no-answer';

/** Why no model answer: from the reason string the pipeline records in `engine`. */
export function noModelReason(why: string): NoModelReason {
  if (QUOTA_ERROR.test(why)) return 'paused';
  if (/AI not configured/i.test(why)) return 'off';
  if (/no record|source check|no tax rate record/i.test(why)) return 'no-answer';
  return 'failed';
}

/** The one plain line shown above the record cards. `records` says whether any card follows. */
export function noModelLine(reason: NoModelReason, records: boolean, now: Date = new Date()): string {
  const tail = records ? ' Here are the best matching records.' : '';
  switch (reason) {
    case 'paused':
      return `AI answers are paused until ${resumeLabel(now)}.${tail}`;
    case 'off':
      return `AI answers are off right now.${tail}`;
    case 'failed':
      return records ? 'These records cover your question.' : 'The Records page has every archived record on this.';
    default:
      return records ? 'Nothing in the archive answers that directly. These records come closest.' : 'Nothing in the archive answers that directly.';
  }
}

export interface RelevanceSource {
  documentId: string;
  title: string;
  text?: string | null;
}

/**
 * The fewest question words a record must hold to be shown: two (or every word of a shorter question),
 * and three once a question (with a follow-up's earlier words) has eight or more. "Is the city building an overpass over the railroad?"
 * needs two of building, overpass, railroad: a 2019 line about the Public Works building does not qualify.
 */
export function relevanceFloor(wordCount: number): number {
  if (wordCount <= 0) return Infinity;
  return Math.max(Math.min(2, wordCount), Math.min(3, Math.ceil(wordCount * 0.4)));
}

/** How well a record (title and passage) matches the question's words. */
export function recordScore(words: string[], h: RelevanceSource): number {
  return sentenceScore(`${h.title} ${String(h.text ?? '').replace(/\s+/g, ' ')}`, words);
}

/**
 * The records worth showing for a question, one per document, in the order given (the search ranked
 * them), dropping any that hold too few of the question's words or score under half the best match.
 * Passages the conversation already relied on (`boost`, by chunk id: a follow-up's earlier records)
 * come first when they match.
 */
export function relevantRecords<T extends RelevanceSource & { chunkId?: string }>(question: string, hits: T[], max = 4, boost?: Set<string>): T[] {
  const words = questionWords(question);
  const floor = relevanceFloor(words.length);
  const best = new Map<string, { h: T; score: number; at: number; prior: boolean }>();
  hits.forEach((h, at) => {
    const score = recordScore(words, h);
    if (score < floor) return;
    const prior = Boolean(h.chunkId && boost?.has(h.chunkId));
    const cur = best.get(h.documentId);
    if (!cur) best.set(h.documentId, { h, score, at, prior });
    else if (score > cur.score || prior) best.set(h.documentId, { h, score: Math.max(score, cur.score), at: cur.at, prior: prior || cur.prior });
  });
  const all = [...best.values()].sort((a, b) => Number(b.prior) - Number(a.prior) || a.at - b.at);
  const top = all.reduce((m, x) => Math.max(m, x.score), 0);
  return all.filter((x) => x.prior || x.score >= top / 2).slice(0, max).map((x) => x.h);
}

/**
 * A short answer from the best matching record when no model wrote one: its title and date, then the
 * sentence in it that shares the most words with the question, as a normal sentence (never an error and
 * never a list of quotes). Null when no sentence of it shares at least two words with the question.
 */
export function topRecordLine(question: string, hit: { title: string; documentDate?: string | null; text?: string | null }): string | null {
  const words = questionWords(question);
  const sentences = (hit.text ?? '').replace(/\s+/g, ' ').match(/[^.!?]{25,400}[.!]/g) ?? [];
  let best = '';
  let top = 0;
  for (const x of sentences) {
    const n = sentenceScore(x, words);
    if (n > top) [best, top] = [x.trim(), n];
  }
  if (!best || top < 2) return null;
  const date = hit.documentDate && /^\d{4}-\d{2}-\d{2}/.test(hit.documentDate) ? `, dated ${longDay(hit.documentDate.slice(0, 10))}` : '';
  return `The closest record on this is "${hit.title.replace(/\s+/g, ' ').trim()}"${date}. It says: "${best}"`;
}
