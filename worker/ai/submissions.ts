/**
 * Resident submissions in chat. They are never used for votes, the budget, meetings or construction,
 * and whenever an answer cites one, its citation carries the label "Resident submitted. Not a city
 * record." Staff uploads carry "Added by portal staff".
 */
import { RESIDENT_SOURCE_ID, sourceLabelFor } from '../lib/contrib';

const OFFICIAL_TOPIC = /\b(vot(e|es|ed|ing)|motion|ayes?|nays?|budget|fiscal|appropriat\w*|revenue|expenditure|tax(es)?|fund balance|meeting|agenda|minutes|council|commission|session|hearing|construction|road work|roadwork|closure|detour|paving|repaving)\b/i;

/** True when a question is about votes, the budget, meetings or construction (resident items are left out of those answers). */
export function officialTopic(question: string): boolean {
  return OFFICIAL_TOPIC.test(question);
}

export const isResidentHit = (h: { sourceId?: string | null; documentType?: string | null }): boolean => h.sourceId === RESIDENT_SOURCE_ID || h.documentType === 'resident_submission';

/**
 * Drops resident submissions from the passages an answer is written from when the question (or the
 * path that answers it) is about votes, the budget, meetings or construction.
 */
export function withoutResidentFor<T extends { sourceId?: string | null; documentType?: string | null }>(hits: T[], question: string, officialPath = false): T[] {
  if (!officialPath && !officialTopic(question)) return hits;
  return hits.filter((h) => !isResidentHit(h));
}

/** The label a citation carries for a record added on the portal, or null for city records. */
export function citationLabel(sourceId: string | null | undefined): string | null {
  return sourceLabelFor(sourceId);
}
