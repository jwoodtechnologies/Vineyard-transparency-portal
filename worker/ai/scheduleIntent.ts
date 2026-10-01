/** Pure: is this a "when is the next meeting" question? (no Worker types, so tests typecheck anywhere) */
const WHEN = /\b(when|what time|what day|what date|where|is there)\b/i;
const NEXT = /\b(next|upcoming|coming up|this week|tonight|today|tomorrow|soon)\b/i;
const MEETING = /\b(meeting|meetings|council|commission|session|hearing|rda|redevelopment)\b/i;
const CONTENT = /\b(agenda|discuss|discussed|on the|about|decide|vote|items?|happen)\b/i;

export function isScheduleQuestion(q: string): boolean {
  return NEXT.test(q) && MEETING.test(q) && (WHEN.test(q) || /^\s*next\b/i.test(q) || /\bnext (city )?council meeting\??\s*$/i.test(q)) && !CONTENT.test(q);
}


/** "How many council meetings are left this year?", "What meetings are coming up?" */
export function isRemainingQuestion(q: string): boolean {
  return /\b(meetings?|sessions?)\b/i.test(q) && (/\bhow many\b.*\b(left|remaining|rest of|more|still)\b/i.test(q) || /\b(list|what are|which|show)\b.*\b(upcoming|remaining|future|rest of the year)\b/i.test(q) || /\b(upcoming|remaining|future) meetings\b/i.test(q));
}

/** "How many resolutions were passed in 2025?" : a count from the catalog. */
export function countQuestion(q: string): { type: 'resolution' | 'ordinance' | 'minutes' | 'meetings'; year: number } | null {
  const m = q.match(/\bhow many (resolutions?|ordinances?|meetings?|council meetings?|minutes)\b[^?]*?\b(?:in|during|for|of)\s+((?:19|20)\d{2})\b/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  const type = w.startsWith('resolution') ? 'resolution' : w.startsWith('ordinance') ? 'ordinance' : w === 'minutes' ? 'minutes' : 'meetings';
  return { type, year: Number(m[2]) };
}
