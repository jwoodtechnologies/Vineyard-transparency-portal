/** Pure: is this a "when is the next meeting" question? (no Worker types, so tests typecheck anywhere) */
const WHEN = /\b(when|what time|what day|what date|where|is there)\b/i;
const NEXT = /\b(next|upcoming|coming up|this week|tonight|today|tomorrow|soon)\b/i;
const MEETING = /\b(meeting|meetings|council|commission|session|hearing|rda|redevelopment)\b/i;
const CONTENT = /\b(agenda|discuss|discussed|on the|about|decide|vote|voting|items?|happen|elections?|ballot|candidates?|primary|campaign|filing)\b/i;

export function isScheduleQuestion(q: string): boolean {
  return NEXT.test(q) && MEETING.test(q) && (WHEN.test(q) || /^\s*next\b/i.test(q) || /\bnext (city )?council meeting\??\s*$/i.test(q)) && !CONTENT.test(q);
}


/** "How many council meetings are left this year / next year / in 2025?", "What meetings are coming up?" */
export function isMeetingCountQuestion(q: string): boolean {
  return /\b(meetings?|sessions?)\b/i.test(q) && (/\bhow many\b/i.test(q) || /\b(list|what are|which|show)\b.*\b(upcoming|remaining|future|rest of the year|next year|this year)\b/i.test(q) || /\b(upcoming|remaining|future) meetings\b/i.test(q));
}

/** "How many resolutions were passed in 2025 / last year?" : which record type to count. */
export function countKind(q: string): 'resolution' | 'ordinance' | 'minutes' | null {
  const m = q.match(/\bhow many (resolutions?|ordinances?|(?:sets of )?minutes)\b/i);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return w.startsWith('resolution') ? 'resolution' : w.startsWith('ordinance') ? 'ordinance' : 'minutes';
}

/** The body a meeting question is about, and how its meetings are named in the calendar and catalog. */
const BODIES: Array<{ ask: RegExp; label: string; match: RegExp; like: string }> = [
  // Public hearings and notices are filed as their own body ("Public Hearing - Senate Bill 284"), never the council's meeting.
  { ask: /public hearings?|public notices?/i, label: 'public hearing', match: /public hearing|public notice/i, like: '%Public%' },
  { ask: /planning commission/i, label: 'Planning Commission', match: /planning commission/i, like: '%Planning Commission%' },
  { ask: /\bRDA\b|redevelopment/i, label: 'Redevelopment Agency', match: /redevelopment|\bRDA\b/i, like: '%Redevelopment%' },
  { ask: /\barch\b|architect/i, label: 'ARCH Commission', match: /\bARCH\b/i, like: '%ARCH Commission%' },
  { ask: /\blibrary board\b|\blibrary\b.*\bmeeting\b/i, label: 'Library Board', match: /library board/i, like: '%Library Board%' },
  { ask: /pedestrian safety|active transportation|\bATC\b/i, label: 'Pedestrian Safety Commission', match: /pedestrian safety|active transportation|\bATC\b/i, like: '%Active Transportation%' },
  { ask: /development review/i, label: 'Development Review Committee', match: /development review/i, like: '%Development Review%' },
  { ask: /youth council/i, label: 'Youth Council', match: /youth council/i, like: '%Youth Council%' },
  { ask: /vineyard cares coalition/i, label: 'Vineyard Cares Coalition', match: /vineyard cares coalition/i, like: '%Vineyard Cares Coalition%' },
  { ask: /vineyard cares commission|communities that care/i, label: 'Vineyard Cares Commission', match: /vineyard cares commission|communities that care/i, like: '%Cares Commission%' },
];
const COUNCIL = { label: 'City Council', match: /city council|council meeting/i, like: '%City Council%' };

export function bodyOf(q: string): { label: string; match: RegExp; like: string } {
  const hit = BODIES.find((b) => b.ask.test(q));
  return hit ? { label: hit.label, match: hit.match, like: hit.like } : COUNCIL;
}

/** True when the question names a board, commission or committee the schedule does not know: never answer it with the council. */
export function unknownBody(q: string): boolean {
  if (BODIES.some((b) => b.ask.test(q)) || /city council|\bcouncil\b/i.test(q)) return false;
  return /\b(board|commission|committee|coalition)\b/i.test(q);
}

const NEXT_MEETING = /\b(next|upcoming|tonight'?s?|tomorrow'?s?|this week'?s?|coming)\b[^.?!]{0,50}\b(meeting|session|hearing)s?\b|\b(next|upcoming)\s+(city council|council|planning commission|commission|rda|redevelopment agency|arch commission)\b/i;
const AGENDA = /\b(agenda|agendas|on the docket|summar(y|ize|ise)|happening|planned|discuss(ed|ing)?|be (talked about|covered|decided|considered)|items?|topics?|what('?s| is| are| will)\b[^.?!]{0,30}\b(on|about|happen|covered|decided|considered))\b/i;
const ELECTION = /\b(elections?|ballot|candidates?|primary|campaign|filing)\b/i;

/** "When is the next Planning Commission meeting and what is on the agenda?": the next meeting's own agenda only. */
export function isNextAgendaQuestion(q: string): boolean {
  return NEXT_MEETING.test(q) && AGENDA.test(q) && !ELECTION.test(q);
}
