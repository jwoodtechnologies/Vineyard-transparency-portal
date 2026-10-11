/**
 * Issues of today in Vineyard that need more than keyword search to get right. Each topic, when a
 * question touches it, pulls the records that settle it (searched by these phrases) to the front
 * and gives the model the plain state of things, which it must still cite from those records.
 * Pure (no Worker types).
 */
import { budgetFacts, projectFacts } from '../lib/budgetFacts';

export interface CivicTopic {
  id: string;
  match: RegExp;
  queries: Array<{ q: string; from?: string }>;
  note: string;
}

export const TOPICS: CivicTopic[] = [
  {
    id: 'city-hall',
    match: /\b(new )?city hall\b|\bcity center\b|\bcivic center\b|\bmunicipal (building|center)\b|\bcity offices? building\b/i,
    queries: [
      { q: '"bond parameters" repealed referendum "city center"', from: '2025-01-01' },
      { q: 'referendum petition bonding "city center"', from: '2025-01-01' },
    ],
    // Source: NOT TRACED - verify. The referendum petition, Resolution 2025-15 (the 2025 bond parameters
    // resolution for the city center), its repeal by the City Council in May 2025, and Resolution 2024-34 are
    // stated with no document id or page. Open Resolution 2025-15, the May 2025 City Council minutes or
    // resolution that repealed it, and the referendum petition notice (the queries above find them).
    note: 'New City Hall / city center: residents filed a referendum petition against the 2025 bond parameters resolution for the proposed city center (Resolution 2025-15), and the City Council repealed that resolution in May 2025. There are no current plans to build a new City Hall. For any City Hall or city center question, say that first and cite the record that shows the repeal or the referendum; older planning records (such as Resolution 2024-34) are history, never current plans.',
  },
  {
    id: 'form-of-government',
    match: /\b(mayor|vot(e|es|ed|ing)|form of government|six-member|five-member|tie|council members?|who decides)\b/i,
    // The six-member council facts (from January 1, 2026; Resolution 2024-21; Utah Code 10-3b-301) are written
    // in worker/ai/answer.ts, which carries their source comment; this topic only pulls the records forward.
    queries: [
      { q: '"six-member council" "took effect" January 2026', from: '2025-06-01' },
      { q: '"six-member" mayor vote tie', from: '2024-01-01' },
    ],
    note: '',
  },
  {
    id: 'elections',
    match: /\b(elections?|candidates?|ballot|canvass|primary|general election|running for|re-?elect|campaign|term ends?|referendum|initiative)\b/i,
    queries: [{ q: 'municipal election canvass results council', from: '2023-01-01' }, { q: 'election candidates council seats', from: '2025-01-01' }],
    // Source: NOT TRACED - verify. "Municipal general elections in November of odd-numbered years" is stated
    // with no record; it is Utah election law (Utah Code Title 20A) and the city's Elections page,
    // https://www.vineyardutah.gov/government/elections.php, should confirm it.
    note: 'Elections: Utah cities hold municipal general elections in November of odd-numbered years, so the next Vineyard municipal election is in November {NEXT_ELECTION}. Council seats (and the mayor when that term ends) are on that ballot. Use the newest canvass, candidate and election records, give their dates, and never present an old election as the current one.',
  },
];

/** The budget topic. Its figures come from worker/lib/budgetData.ts (see the sources there). */
// Source for "adopted by the City Council in June {FY_START}" and the "FY {FYS} Final Budget" / "Budget Amendment"
// titles: FY 27 Final Budget (doc_2c248c52cbadfa22) and FY 27 First Budget Amendment (doc_3931ec08b88d5fbf), page not recorded.
TOPICS.push({
  id: 'budget',
  match: /\bbudgets?\b|\bfiscal year\b|\bappropriat|\bgeneral fund\b|\bcity spending\b|\btax revenue\b|\bhow much (does|is|will) (the city|vineyard) (spend|make|collect|take in)\b/i,
  queries: [{ q: 'FY {FYS} Final Budget', from: '{FY_START}-05-01' }, { q: 'FY {FYS} Budget Amendment', from: '{FY_START}-07-01' }, { q: 'FY {FYS} budget general fund total', from: '{FY_START}-04-01' }],
  note: 'Budgets: the city budget runs on a fiscal year from July 1 to June 30. The budget in effect now is the fiscal year {FY} budget (July {FY_START} to June {FY}), adopted by the City Council in June {FY_START}; its records are titled "FY {FYS} Final Budget", with amendments titled "FY {FYS} Budget Amendment". When the question says this year, current, now, or names no year, answer from the FY {FYS} final budget and its amendments: say it is fiscal year {FY} (July {FY_START} to June {FY}), give the totals from the record titled "FY {FYS} Final Budget" (never a draft or tentative version when the final is among the sources) with the adoption date, and never present an older fiscal year\'s budget as this year\'s. When the question names another year, use that fiscal year\'s budget. Every year\'s budget is listed for the reader under your answer, so do not list them yourself.',
});

/** The projects in the adopted budget; the city's own project map still lists earlier years' work. */
// Source: the note is projectFacts() in worker/lib/budgetFacts.ts, built from budgetData PROJECTS
// (FY 27 Final Budget Slides, pages 4 to 6, doc_4d69a97b95e87bea).
TOPICS.push({
  id: 'capital-projects',
  match: /\bcapital (improvement )?(projects?|plans?|improvements?)\b|\bCIP\b|\binfrastructure (projects?|plans?)\b|\bwhat('s| is| are) (being|getting|going to be) built\b|\b(road|park|trail|water|sewer|street|bridge|overpass) projects?\b/i,
  queries: [{ q: 'FY {FYS} Final Budget Slides capital projects', from: '{FY_START}-05-01' }, { q: 'FY {FYS} Budget Amendment capital', from: '{FY_START}-07-01' }],
  note: '{PROJECTS}',
});

/** How to request records, from the city's Records Request page (checked October 1, 2026). */
// Source: https://www.vineyardutah.gov/government/records_request.php, checked October 1, 2026 (the written-request
// contents, robinr@vineyardutah.gov, 125 S Main Street, the Record Request Form, the Utah Open Records Portal,
// police reports from the Sheriff's Office and the 10 business days). Utah Code 63G-2 is the GRAMA statute.
TOPICS.push({
  id: 'grama',
  match: /\b(grama|records? requests?|public records?|request (a |the )?(record|document|copy)|open records)\b/i,
  queries: [{ q: 'GRAMA "records request" recorder written request' }, { q: '"Record Request Form"' }],
  note: 'Records requests (GRAMA, Utah Code 63G-2): a request goes in writing to the City Recorder and must include your name, address, phone number, email and a specific description of the records. Submit it by email to the City Recorder (robinr@vineyardutah.gov), by U.S. mail or in person at City Hall (125 S Main Street), using the city\'s Record Request Form, or through the Utah Open Records Portal. Police reports are requested from the Utah County Sheriff\'s Office. The city responds as soon as reasonably possible and no later than 10 business days. Give these steps plainly, citing the Records Request page.',
});

TOPICS.push({
  id: 'water-quality',
  match: /\b(water quality|consumer confidence|ccr|drinking water (quality )?report|water report)\b/i,
  queries: [{ q: 'Annual Drinking Water Quality Report', from: '2024-01-01' }, { q: '"water quality report" Vineyard', from: '2023-01-01' }],
  // Source: NOT TRACED - verify. "The 2025 report, presented in May 2026" is stated with no record; open the
  // 2025 Annual Drinking Water Quality Report and the May 2026 council agenda that presented it. Report list:
  // https://www.vineyardutah.gov/government/water_quality_reports.php
  note: 'Water quality reports (Consumer Confidence Reports) cover the previous calendar year and are released the following spring, so "this year\'s report" is the one released this year (for example the 2025 report, presented in May 2026). Give the newest report and its date first; every year\'s report is listed for the reader under your answer.',
});

TOPICS.push({
  id: 'noise',
  match: /\b(noise|noisy|loud|music|party|parties|barking|bark|decibels?|quiet hours|nuisance|neighbou?r'?s?\b.*\b(complain|report)|complain(t|ts)? about (my )?neighbou?r)\b/i,
  queries: [{ q: '"Nuisances Generally" noise decibels' }, { q: '"NON-EMERGENCY POLICE" 798-5600' }, { q: '"Report a Concern" code enforcement', from: '2025-01-01' }],
  // Source: Vineyard Municipal Code 8.08.010 (Nuisances Generally), https://vineyard.municipalcodeonline.com/, section
  // given, page not applicable (the 55 dBA 7:00 a.m. to 10:30 p.m. and 50 dBA night limits). Report a Concern form and
  // non-emergency line 801-798-5600: src/console/services.ts LINKS (city contact pages, verified September 30, 2026).
  note: 'Noise and nuisance complaints: Vineyard Municipal Code 8.08.010 (Nuisances Generally) makes it a nuisance for activities to exceed 55 decibels (dBA) between 7:00 a.m. and 10:30 p.m. and 50 decibels between 10:30 p.m. and 7:00 a.m.; quote the limits exactly as the code section states them and cite it. To report: file the city\'s Report a Concern form (it goes to Code Enforcement), and for noise happening right now, especially at night, call the Utah County Sheriff\'s non-emergency line at 801-798-5600 (Vineyard\'s police service); call 911 only for emergencies. Give the rule first, then these steps.',
});

/** The Geneva Urban Renewal Area: who receives what share of the tax increment. */
// Source: the share is quoted, not restated, from two records found by the queries below:
//   RDA Resolution U-2010-05, Draft Geneva Urban Renewal Project Area Budget (April 28, 2010), page 6
//   (doc_6a0c9a6544266140): "The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million."
//   RDA Resolution U-2016-07 (December 21, 2016), 2016 Annual Report, Geneva URA, page 13 (doc_179192efa15bf228):
//   "Participation Rate 75%", "Total Tax Increment Revenue Due to RDA", "Total Pass Through to Taxing Entities (Above Base)".
// The note carries no figure of its own: any percentage in an answer must come from a cited source.
TOPICS.push({
  id: 'geneva-ura',
  match: /\b(urban renewal|ura|tax increment|increment|tif|project area|pass[- ]through|participation rate)\b|\bgeneva\b.*\b(rda|redevelopment|renewal)\b|\b(rda|redevelopment)\b.*\bgeneva\b/i,
  queries: [{ q: '"Agency proposes capturing" "tax increment"' }, { q: '"Participation Rate" "Pass Through to Taxing Entities"' }, { q: 'Geneva Urban Renewal Project Area Budget tax increment' }],
  note: 'Geneva Urban Renewal Area tax increment: the Redevelopment Agency captures (receives) a share of the tax increment from the project area, its participation rate, and the rest of the increment passes through to the taxing entities. State any percentage exactly as the cited record words it and say who it belongs to as the record says (for example the share the Agency captures, or the pass through to taxing entities). Never write that the taxing entities each receive the share the Agency captures.',
});

export function topicsFor(question: string, today = new Date().toISOString().slice(0, 10)): CivicTopic[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const next = y % 2 === 1 && m <= 11 ? y : y % 2 === 1 ? y + 2 : y + 1;
  const fy = m >= 7 ? y + 1 : y;
  const fill = (s: string) =>
    s
      .replace(/\{NEXT_ELECTION\}/g, String(next))
      .replace(/\{FY\}/g, String(fy))
      .replace(/\{FYS\}/g, String(fy % 100))
      .replace(/\{FY_START\}/g, String(fy - 1))
      .replace(/\{PROJECTS\}/g, projectFacts());
  return TOPICS.filter((t) => t.match.test(question)).map((t) => ({ ...t, note: t.id === 'budget' ? `${fill(t.note)} ${budgetFacts()}` : fill(t.note), queries: t.queries.map((x) => ({ ...x, q: fill(x.q), ...(x.from ? { from: fill(x.from) } : {}) })) }));
}
