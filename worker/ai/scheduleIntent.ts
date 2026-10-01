/** Pure: is this a "when is the next meeting" question? (no Worker types, so tests typecheck anywhere) */
const WHEN = /\b(when|what time|what day|what date|where|is there)\b/i;
const NEXT = /\b(next|upcoming|coming up|this week|tonight|today|tomorrow|soon)\b/i;
const MEETING = /\b(meeting|meetings|council|commission|session|hearing|rda|redevelopment)\b/i;
const CONTENT = /\b(agenda|discuss|discussed|on the|about|decide|vote|items?|happen)\b/i;

export function isScheduleQuestion(q: string): boolean {
  return NEXT.test(q) && MEETING.test(q) && (WHEN.test(q) || /^\s*next\b/i.test(q) || /\bnext (city )?council meeting\??\s*$/i.test(q)) && !CONTENT.test(q);
}

