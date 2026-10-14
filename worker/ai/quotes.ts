/**
 * Record quotes written by code from the records themselves, for lookups scoped to one meeting's
 * records (never as the fallback when the model cannot answer: that is one plain line with record
 * cards, see fallback.ts). Nothing here is invented: a quote is the exact sentences a record prints,
 * with its title, date and page, and each quote opens the record at that page.
 *
 * When there is nothing to quote, `routeFor` names the part of the portal that holds what was asked
 * (meetings of that body, voting records, the budget, the map, the directory, the records search),
 * so no question ends with "nothing found". Pure: no Worker types.
 */

export interface QuoteSource {
  documentId: string;
  chunkId?: string;
  title: string;
  documentType: string;
  documentDate: string | null;
  year?: number | null;
  pageStart: number | null;
  text?: string | null;
  governmentBodyId?: string | null;
}

export interface Quote<T extends QuoteSource = QuoteSource> {
  hit: T;
  /** The record's own sentences, in reading order, as printed (whitespace tidied, dashes made plain). */
  sentences: string[];
  score: number;
}

/** What a quote may never carry: these read as a dead end, whoever wrote them. */
export const DEAD_END = /\b(couldn'?t find|could not find|unavailable|unable to|i don'?t know|i do not know)\b/i;

const STOP = new Set(
  (
    'the and for with what when where who whom whose which why how does did done doing will would could should can may might must ' +
    'are was were been being have has had this that those these there their them they its it his her him she you your our ours ' +
    'from into onto about over under than then also just only very much many more most some any all each every other such ' +
    'tell show give find get got please know want need like look city vineyard utah record records document documents portal ' +
    'question answer say said says mean means any anything something thing things one ones'
  ).split(/\s+/),
);

/** The words of a question worth matching in a record, lower case, each at least three letters (numbers kept). */
export function questionWords(q: string): string[] {
  const out = new Set<string>();
  for (const raw of q.toLowerCase().replace(/[‘’]/g, "'").split(/[^a-z0-9'$.-]+/)) {
    const w = raw.replace(/^[^a-z0-9$]+|[^a-z0-9]+$/g, '').replace(/'s$/, '');
    if (!w || STOP.has(w)) continue;
    if (/^\d+$/.test(w) ? w.length >= 2 : w.length >= 3) out.add(w);
  }
  return [...out];
}

/** "parks" matches "park"; "fees" matches "fee"; "voting" matches "vote" (a light stem, never a guess). */
function stem(w: string): string {
  return w.replace(/(?:ings?|ies|es|ed|s)$/, '').slice(0, Math.max(4, w.length - 3)) || w;
}

/** Plain text of a record passage: one line, plain hyphens, no stray control characters. */
export function plainRecordText(s: string): string {
  return s
    .replace(/[–—−]/g, '-')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A passage cut into sentences that read on their own (table rows, page furniture and dot leaders left out). */
export function recordSentences(text: string): string[] {
  const blocks = text.split(/\n\s*\n|\r\n\s*\r\n/);
  const out: string[] = [];
  for (const block of blocks) {
    const flat = plainRecordText(block);
    for (const s of flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)) {
      const t = s.trim();
      if (t.length < 30 || t.length > 340) continue;
      if (/\.{4,}|…{2,}|_{3,}/.test(t)) continue; // table of contents, blanks to fill in
      const letters = (t.match(/[A-Za-z]/g) ?? []).length;
      if (letters / t.length < 0.55) continue; // numbers and table cells
      if (!/[a-z]{3,}/.test(t) || t.split(/\s+/).length < 5) continue;
      if (/^page \d+( of \d+)?$/i.test(t)) continue;
      if (DEAD_END.test(t)) continue;
      out.push(t);
    }
  }
  return out;
}

/** How many of the question's words a sentence holds (each counted once), with numbers worth more. */
export function sentenceScore(sentence: string, words: string[]): number {
  const lower = ` ${sentence.toLowerCase().replace(/[^a-z0-9$.-]+/g, ' ')} `;
  let score = 0;
  for (const w of words) {
    if (/\d/.test(w)) {
      if (lower.includes(` ${w} `) || lower.includes(w)) score += 2;
      continue;
    }
    if (lower.includes(` ${w} `)) score += 1;
    else if (w.length >= 5 && lower.includes(` ${stem(w)}`)) score += 0.75;
  }
  return score;
}

/**
 * The best sentences to quote for a question, from at most `docs` records (in the order given: the
 * search ranked them), at most `perDoc` sentences each. A record is quoted only when a sentence holds
 * at least `min` of the question's words (or every word, for a one-word question).
 */
export function pickQuotes<T extends QuoteSource>(question: string, hits: T[], opts: { docs?: number; perDoc?: number; min?: number; boost?: Set<string> } = {}): Quote<T>[] {
  const words = questionWords(question);
  if (!words.length) return [];
  const docs = opts.docs ?? 3;
  const perDoc = opts.perDoc ?? 2;
  const min = opts.min ?? Math.min(2, words.length);
  const byDoc = new Map<string, Quote<T>>();
  const order: string[] = [];
  for (const h of hits) {
    if (!h.text) continue;
    const ranked = recordSentences(h.text)
      .map((s, i) => ({ s, i, score: sentenceScore(s, words) }))
      .filter((x) => x.score >= min)
      .sort((a, b) => b.score - a.score || a.i - b.i);
    if (!ranked.length) continue;
    const best = ranked.slice(0, perDoc).sort((a, b) => a.i - b.i);
    // Passages the conversation already relied on (a follow-up's earlier records) count a little more.
    const score = ranked[0].score + (best.length > 1 ? best[1].score / 4 : 0) + (h.chunkId && opts.boost?.has(h.chunkId) ? 2 : 0);
    const cur = byDoc.get(h.documentId);
    if (!cur) {
      byDoc.set(h.documentId, { hit: h, sentences: best.map((x) => x.s), score });
      order.push(h.documentId);
    } else if (score > cur.score) byDoc.set(h.documentId, { hit: h, sentences: best.map((x) => x.s), score });
  }
  // Search order first, then the strongest quote: a record that answers well is never pushed out by one that only shares a word.
  const all = order.map((id) => byDoc.get(id)!);
  const top = all.reduce((m, q) => Math.max(m, q.score), 0);
  return all.filter((q) => q.score >= Math.max(min, top / 2)).slice(0, docs);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-09-08" as "September 8, 2026". */
export function longDate(iso: string | null | undefined): string | null {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

const BODY_NAMES: Record<string, string> = {
  'city-council': 'City Council',
  'planning-commission': 'Planning Commission',
  'redevelopment-agency': 'Redevelopment Agency',
  'vineyard-library-board': 'Library Board',
  'arch-commission': 'ARCH Commission',
  'active-transportation-commission': 'Pedestrian Safety Commission',
};

/** "FY 27 Final Budget (June 23, 2026), page 12" */
export function quoteLabel(h: QuoteSource): string {
  const title = plainRecordText(h.title).replace(/\.(pdf|docx?)$/i, '');
  const body = h.governmentBodyId ? BODY_NAMES[h.governmentBodyId] : null;
  const date = longDate(h.documentDate) ?? (h.year ? String(h.year) : null);
  const meta = [body && !title.toLowerCase().includes(body.toLowerCase()) ? body : null, date && !title.includes(date) ? date : null].filter(Boolean).join(', ');
  return `${title}${meta ? ` (${meta})` : ''}${h.pageStart ? `, page ${h.pageStart}` : ''}`;
}

/** One line per quote: where it is, then the record's own words in quotation marks. */
export function quoteLine(q: Quote): string {
  const words = q.sentences.map((s) => s.replace(/"/g, "'")).join(' ');
  return `${quoteLabel(q.hit)}: "${words}"`;
}

export const QUOTES_LEAD = 'The records closest to your question:';

/* ---------------------------------------------------------------------------------------------- */
/* Where to look when nothing can be quoted                                                       */
/* ---------------------------------------------------------------------------------------------- */

export interface Route {
  text: string;
  section: { path: string; label: string; hint: string };
}

const MEETING_BODIES: Array<[RegExp, string, string]> = [
  [/planning commission/i, 'planning-commission', 'Planning Commission'],
  [/\bRDA\b|redevelopment/i, 'redevelopment-agency', 'Redevelopment Agency'],
  [/library board|\blibrary\b.*\b(meeting|agenda|minutes)\b/i, 'vineyard-library-board', 'Library Board'],
  [/\barch\b|architect/i, 'arch-commission', 'ARCH Commission'],
  [/pedestrian safety|active transportation|\bATC\b|\bPSC\b/i, 'active-transportation-commission', 'Pedestrian Safety Commission'],
  [/youth council/i, 'youth-council', 'Youth Council'],
  [/development review/i, 'development-review-committee', 'Development Review Committee'],
  [/\bcouncil\b/i, 'city-council', 'City Council'],
];

/**
 * The portal page that holds what a question asks about, with one plain line saying what it holds.
 * Every route is a page inside the portal; the most specific match wins.
 */
export function routeFor(question: string): Route {
  const q = question.replace(/[‘’]/g, "'");
  const terms = questionWords(q).filter((w) => !/^(minutes|agenda|agendas|meeting|meetings|records?|find|show)$/.test(w)).slice(0, 6).join(' ');
  const recordsQ = (label: string, hint: string, text: string): Route => ({ text, section: { path: `/records${terms ? `?q=${encodeURIComponent(terms)}` : ''}`, label, hint } });
  if (/\b(agendas?|minutes|packets?|meet|meets|meetings?|hearings?|sessions?)\b/i.test(q)) {
    const body = MEETING_BODIES.find(([re]) => re.test(q));
    if (body)
      return {
        text: `Every ${body[2]} meeting the portal holds, with its agenda, packet, minutes and video, is on the Meetings page.`,
        section: { path: `/meetings?view=past&type=meetings&body=${body[1]}`, label: `Open ${body[2]} meetings`, hint: 'Agendas, packets, minutes and video' },
      };
    return { text: 'Every public meeting the portal holds, with its agenda, packet, minutes and video, is on the Meetings page.', section: { path: '/meetings', label: 'Open meetings', hint: 'Agendas, packets, minutes and video' } };
  }
  if (/\b(vot\w*|motions?|roll ?calls?|seconded|abstain\w*)\b/i.test(q)) return { text: 'Every recorded vote since January 2026, with how each member voted, is on the Votes page.', section: { path: '/votes', label: 'Open voting records', hint: 'Every recorded vote, meeting by meeting' } };
  if (/\bordinances?\b/i.test(q)) return { text: 'Every numbered ordinance the portal holds, with its adoption, is on the ordinance index.', section: { path: '/records/ordinances', label: 'Open the ordinance index', hint: 'Numbered ordinances by year' } };
  if (/\bresolutions?\b/i.test(q)) return { text: 'Every numbered resolution the portal holds, with its adoption, is on the resolution index.', section: { path: '/records/resolutions', label: 'Open the resolution index', hint: 'Numbered resolutions by year' } };
  if (/\b(budget|fund|funds|revenue|spending|spend|tax|taxes|fiscal|fy\s?\d{2})\b/i.test(q)) return { text: 'Every fund, department and revenue line of the city budget is on the Budget page.', section: { path: '/budget', label: 'Open the budget', hint: 'Every fund, department and project' } };
  if (/\b(construction|road ?work|closures?|closed|detours?|paving|widening)\b/i.test(q)) return { text: "The city's funded projects and its current construction table are listed beside the map.", section: { path: '/map?layers=projects#projects', label: 'Open construction projects', hint: 'Funded projects and work now, on the map' } };
  if (/\b(zon\w*|parcels?|lots?|propert(y|ies)|address|map|trails?|where is|located)\b/i.test(q)) return { text: 'Zoning, parcels, parks, trails and capital projects are on the city map.', section: { path: '/map', label: 'Open the map', hint: 'Roads, zoning, parks and capital projects' } };
  if (/\b(contact|phone|email|call|who (do|should) i|department|staff|director|manager|office)\b/i.test(q)) return { text: 'The mayor, the City Council and city staff, with phone numbers and email, are in the staff directory.', section: { path: '/people', label: 'Open the staff directory', hint: 'Mayor, council and city staff by department' } };
  if (/\b(fees?|utilit\w*|water bill|garbage|trash|recycl\w*|permits?|license|pay|bill|reserv\w*|pavilion|rental|apply|sign up|register)\b/i.test(q)) return { text: 'City forms, payments and how-to pages are on the Services page, each opening here in the portal.', section: { path: '/services', label: 'Open city services', hint: 'Forms, payments and how to do things' } };
  if (/\b(boards?|commissions?|committees?|appoint\w*)\b/i.test(q)) return { text: 'Every board and commission, with its current members and meetings, is on the Boards page.', section: { path: '/boards', label: 'Open boards and commissions', hint: 'Current members, roles and meetings' } };
  if (/\b(elections?|ballot|candidates?|voters?|campaign)\b/i.test(q)) return recordsQ('Search election records', 'Notices, candidate filings and results', 'Election notices, candidate filings and results the city published are in the record archive.');
  if (/\b(notices?|public hearing)\b/i.test(q)) return recordsQ('Search public notices', 'Hearings and notices, newest first', 'Public notices and hearing notices the city published are in the record archive.');
  if (/\b(parks?|recreation|events?|library|playground|pickleball|splash pad)\b/i.test(q)) return { text: 'Parks, recreation and library programs, with dates, are on the calendar and the Services page.', section: { path: '/services', label: 'Open city services', hint: 'Recreation, parks and library' } };
  return recordsQ('Search the records', 'Agendas, minutes, ordinances and more', 'The full public record archive, searchable by any word, is on the Records page.');
}
