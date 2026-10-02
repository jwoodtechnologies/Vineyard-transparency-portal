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
    note: 'New City Hall / city center: residents filed a referendum petition against the 2025 bond parameters resolution for the proposed city center (Resolution 2025-15), and the City Council repealed that resolution in May 2025. There are no current plans to build a new City Hall. For any City Hall or city center question, say that first and cite the record that shows the repeal or the referendum; older planning records (such as Resolution 2024-34) are history, never current plans.',
  },
  {
    id: 'form-of-government',
    match: /\b(mayor|vot(e|es|ed|ing)|form of government|six-member|five-member|tie|council members?|who decides)\b/i,
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
    note: 'Elections: Utah cities hold municipal general elections in November of odd-numbered years, so the next Vineyard municipal election is in November {NEXT_ELECTION}. Council seats (and the mayor when that term ends) are on that ballot. Use the newest canvass, candidate and election records, give their dates, and never present an old election as the current one.',
  },
];

/** How to request records, from the city's Records Request page (checked October 1, 2026). */
TOPICS.push({
  id: 'budget',
  match: /\bbudgets?\b|\bfiscal year\b|\bappropriat|\bgeneral fund\b|\bcity spending\b|\btax revenue\b|\bhow much (does|is|will) (the city|vineyard) (spend|make|collect|take in)\b/i,
  queries: [{ q: 'FY {FYS} Final Budget', from: '{FY_START}-05-01' }, { q: 'FY {FYS} Budget Amendment', from: '{FY_START}-07-01' }, { q: 'FY {FYS} budget general fund total', from: '{FY_START}-04-01' }],
  note: 'Budgets: the city budget runs on a fiscal year from July 1 to June 30. The budget in effect now is the fiscal year {FY} budget (July {FY_START} to June {FY}), adopted by the City Council in June {FY_START}; its records are titled "FY {FYS} Final Budget", with amendments titled "FY {FYS} Budget Amendment". When the question says this year, current, now, or names no year, answer from the FY {FYS} final budget and its amendments: say it is fiscal year {FY} (July {FY_START} to June {FY}), give the totals from the record titled "FY {FYS} Final Budget" (never a draft or tentative version when the final is among the sources) with the adoption date, and never present an older fiscal year\'s budget as this year\'s. When the question names another year, use that fiscal year\'s budget. Every year\'s budget is listed for the reader under your answer, so do not list them yourself.',
});

/** The projects in the adopted budget; the city's own project map still lists earlier years' work. */
TOPICS.push({
  id: 'capital-projects',
  match: /\bcapital (improvement )?(projects?|plans?|improvements?)\b|\bCIP\b|\binfrastructure (projects?|plans?)\b|\bwhat('s| is| are) (being|getting|going to be) built\b|\b(road|park|trail|water|sewer|street|bridge|overpass) projects?\b/i,
  queries: [{ q: 'FY {FYS} Final Budget Slides capital projects', from: '{FY_START}-05-01' }, { q: 'FY {FYS} Budget Amendment capital', from: '{FY_START}-07-01' }],
  note: '{PROJECTS}',
});

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
  note: 'Water quality reports (Consumer Confidence Reports) cover the previous calendar year and are released the following spring, so "this year\'s report" is the one released this year (for example the 2025 report, presented in May 2026). Give the newest report and its date first; every year\'s report is listed for the reader under your answer.',
});

TOPICS.push({
  id: 'noise',
  match: /\b(noise|noisy|loud|music|party|parties|barking|bark|decibels?|quiet hours|nuisance|neighbou?r'?s?\b.*\b(complain|report)|complain(t|ts)? about (my )?neighbou?r)\b/i,
  queries: [{ q: '"Nuisances Generally" noise decibels' }, { q: '"NON-EMERGENCY POLICE" 798-5600' }, { q: '"Report a Concern" code enforcement', from: '2025-01-01' }],
  note: 'Noise and nuisance complaints: Vineyard Municipal Code 8.08.010 (Nuisances Generally) makes it a nuisance for activities to exceed 55 decibels (dBA) between 7:00 a.m. and 10:30 p.m. and 50 decibels between 10:30 p.m. and 7:00 a.m.; quote the limits exactly as the code section states them and cite it. To report: file the city\'s Report a Concern form (it goes to Code Enforcement), and for noise happening right now, especially at night, call the Utah County Sheriff\'s non-emergency line at 801-798-5600 (Vineyard\'s police service); call 911 only for emergencies. Give the rule first, then these steps.',
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
