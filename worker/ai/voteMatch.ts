/**
 * Which recorded motions belong with a question. Pure (no Worker types) so it is tested directly.
 *
 * A motion is shown only when the question's subject words are in what was voted on (the motion
 * as recorded, its agenda item title, its consent items or the resolution and ordinance numbers).
 * A last name that is part of a place ("Holdaway Fields", "Holdaway Road") is the place, not the
 * council member.
 */

const PLACE_WORD =
  'fields?|park|parks|road|rd|street|st|drive|dr|lane|ln|way|boulevard|blvd|elementary|school|trail|center|centre|plaza|crossing|parkway|pkwy|avenue|ave|connector|station|commons|village|beach|harbor|marina|preserve|pond|lake|loop|circle|court|ct|subdivision|development|estates|apartments';

/** Words that start a place name in the question ("holdaway" in "Holdaway Fields"). */
export function placeWords(question: string): Set<string> {
  const lower = question.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ');
  const out = new Set<string>();
  for (const m of lower.matchAll(new RegExp(`\\b([a-z][a-z'-]{2,})\\s+(?:${PLACE_WORD})\\b`, 'g'))) out.add(m[1]);
  return out;
}

const stem = (w: string) => w.toLowerCase().replace(/'s$/, '').replace(/(?<=[a-z]{3})(es|s)$/, '');

export interface MotionText {
  motion: string;
  item: string | null;
  items?: string[];
  refs?: string[];
}

/** True when every subject word is in what the motion was about. */
export function motionMatches(m: MotionText, terms: string[]): boolean {
  if (!terms.length) return false;
  const hay = ` ${[m.motion, m.item ?? '', ...(m.items ?? []), ...(m.refs ?? [])].join(' ').toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).map(stem).join(' ')} `;
  return terms.every((t) => {
    const s = stem(t);
    return s.length > 0 && (hay.includes(` ${s} `) || (s.length >= 4 && hay.includes(` ${s}`)));
  });
}

/** The subject words to try, most specific first: all of them, then pairs; one word only when the question has one. */
export function termTries(words: string[]): string[][] {
  const top = words.slice(0, 4);
  if (top.length <= 1) return top.length ? [top] : [];
  const tries: string[][] = [top];
  if (top.length >= 3) {
    const byLen = [...top].sort((a, b) => b.length - a.length);
    for (let i = 0; i < byLen.length; i++) for (let j = i + 1; j < byLen.length; j++) tries.push([byLen[i], byLen[j]]);
  }
  return tries;
}

/** When the answer cites recorded motions ("vote:<id>" passages), only those motions are shown. */
export function citedMotions<T extends { id: string }>(items: T[], citedChunkIds: Array<string | null | undefined>): T[] {
  const ids = new Set(citedChunkIds.filter((c): c is string => typeof c === 'string' && c.startsWith('vote:')).map((c) => c.slice(5)));
  if (!ids.size) return items;
  const picked = items.filter((m) => ids.has(m.id));
  return picked.length ? picked : items;
}
