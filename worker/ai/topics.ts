/**
 * Issues of today in Vineyard that need more than keyword search to get right. Each topic, when a
 * question touches it, pulls the records that settle it (searched by these phrases) to the front
 * and gives the model the plain state of things, which it must still cite from those records.
 * Pure (no Worker types).
 */
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

export function topicsFor(question: string, today = new Date().toISOString().slice(0, 10)): CivicTopic[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const next = y % 2 === 1 && m <= 11 ? y : y % 2 === 1 ? y + 2 : y + 1;
  return TOPICS.filter((t) => t.match.test(question)).map((t) => ({ ...t, note: t.note.replace('{NEXT_ELECTION}', String(next)) }));
}
