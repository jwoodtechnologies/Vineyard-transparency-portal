/**
 * What counts as a recorded vote. Shared by the minutes reader (worker/lib/votes.ts) and the votes page
 * (src/console/votes.ts), so the stored records, the chat answers and the page agree. Pure: no imports.
 */

/** The motion's own words: lower case, without a leading "to" and without who made it ("Councilmember Nair countermotioned to ..."). */
export function motionWords(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[a-z.'’-]+\s+){1,4}?(?:counter-?\s?motioned|motioned)\s+(?:to\s+|that\s+)?(?=\S)/i, '')
    .replace(/^to[\s-]+/i, '')
    .toLowerCase();
}

/**
 * A motion that moves the meeting along instead of deciding something: putting an item off to another meeting,
 * striking or moving an item, a stretch or recess, a break, adjourning, and going in or out of a closed session.
 * None of these is a vote on the city's business, so none is listed as one.
 */
export function isProceduralMotion(text: string): boolean {
  const t = motionWords(text);
  if (!t) return false;
  // "Continue the item to the next meeting", "table the item", "postpone ... until March 24": the item was put off, not decided.
  // A motion that merely begins with the word and goes on to be about a contract, lease or service is a decision.
  if (/^(?:continue|table|postpone|defer)\b/.test(t) && !/^[^.]{0,40}\b(?:contract|agreement|lease|funding|employment|services?)\b/.test(t)) return true;
  // "Strike the item from the agenda", "remove item 5.2", "move agenda item 5.2 to the next meeting".
  if (/^(?:strike|remove|withdraw)\b[^.]{0,40}\b(?:items?|agenda)\b/.test(t)) return true;
  if (/^move\s+(?:the\s+)?(?:agenda\s+)?items?\b/.test(t)) return true;
  // A stretch, a recess or a break in the meeting.
  if (/\b(?:stretch|recess)\b/.test(t.slice(0, 120))) return true;
  if (/\b(?:take|have|call|go (?:on|into))\s+(?:a\s+|an\s+)?(?:short\s+|brief\s+|quick\s+|(?:five|ten|\d+)[- ]minute\s+)?break\b/.test(t)) return true;
  // Ending the meeting, or moving into or out of a closed session.
  if (/^adjourn\b|\badjourn(?:ed|ing)?\s+(?:the\s+)?meeting\b/.test(t)) return true;
  if (/\b(?:go|enter|move|convene|retire|reconvene)\b[^.]{0,30}\b(?:closed|executive)\s+session\b/.test(t)) return true;
  return false;
}

/**
 * A vote about the person (the seat he held, his resignation) and not about the city's business. How a member voted on
 * a roll, and who moved or seconded, stay in the record; an item whose own subject names him does not.
 */
export function isAboutFormerMember(item: string | null | undefined, text: string): boolean {
  const own = `${item ?? ''} ${motionWordsKeepCase(text)}`;
  return /\b(?:ezra\s+)?nair\b/i.test(own);
}

/** The wording with only the mover's own prefix removed, so "Councilmember Nair countermotioned to strike" does not count as being about him. */
function motionWordsKeepCase(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^(?:[A-Za-z.'’-]+\s+){1,4}?(?:counter-?\s?motioned|motioned)\s+(?:to\s+|that\s+)?(?=\S)/i, '');
}
