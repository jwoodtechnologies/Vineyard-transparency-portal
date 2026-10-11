/** Page title and meta description for every route (docs/DESIGN.md). Applied by src/lib/head.ts. */
export const SITE = 'Vineyard Transparency Portal';
const HOME_DESCRIPTION = 'Search Vineyard, Utah public records. Ask a question, search the archive, and see the records behind every answer. An independent public-records project.';

export interface Head {
  title: string | null;
  description: string;
}

/** Defaults by path. The first matching pattern wins. */
const TABLE: Array<[RegExp, Head]> = [
  [/^\/$/, { title: null, description: HOME_DESCRIPTION }],
  [/^\/(meetings|calendar)\/?$/, { title: 'Calendar', description: 'Upcoming and past Vineyard city meetings and events, with agendas, minutes and packets.' }],
  [/^\/meetings\/[^/]+/, { title: 'Meeting', description: 'A Vineyard city meeting: its agenda, minutes, packet and votes.' }],
  [/^\/documents\/[^/]+/, { title: 'Record', description: 'A Vineyard public record, with its source document and full text.' }],
  [/^\/map\/?$/, { title: 'Map', description: 'Vineyard, Utah on a map: city boundary, parcels, parks, schools and funded projects.' }],
  [/^\/records\/ordinances\/?$/, { title: 'Ordinances by number', description: 'Every Vineyard ordinance number for the year, with its title, vote and source document.' }],
  [/^\/records\/resolutions\/?$/, { title: 'Resolutions by number', description: 'Every Vineyard City Council resolution number for the year, with its title, vote and source document.' }],
  [/^\/records\/rda-resolutions\/?$/, { title: 'RDA resolutions by number', description: 'Every Vineyard Redevelopment Agency resolution number for the year, with its title, vote and source document.' }],
  [/^\/records\/?$/, { title: 'Records', description: 'All Vineyard public records by type and topic: agendas, minutes, ordinances, resolutions, contracts and reports.' }],
  [/^\/people/, { title: 'People', description: 'Vineyard elected officials, commissioners and staff, with their votes and records.' }],
  [/^\/votes\/?$/, { title: 'City Council Voting Recap', description: 'How each Vineyard City Council member voted on every motion this year, from the posted minutes.' }],
  [/^\/planning\/?$/, { title: 'Planning Commission Voting Recap', description: 'How each Vineyard Planning Commission member voted on every motion this year, with attendance.' }],
  [/^\/boards\/?$/, { title: 'Boards and commissions', description: 'Vineyard boards and commissions: members, meetings and records.' }],
  [/^\/latest\/?$/, { title: 'Latest', description: 'The newest Vineyard records, meetings and city announcements.' }],
  [/^\/budget\/?$/, { title: 'Budget', description: 'The Vineyard city budget: spending, revenue, sales tax and funded projects, from the adopted budget.' }],
  [/^\/construction\/?$/, { title: 'Construction projects', description: 'Vineyard construction projects: the city construction page and the funded projects on a map.' }],
  [/^\/add\/?$/, { title: 'Submit a public record', description: 'Submit a public record about Vineyard. It appears on the portal after review.' }],
  [/^\/sources\/?$/, { title: 'Sources', description: 'Where the Vineyard Transparency Portal gets its records, and when each source was last read.' }],
  [/^\/services\/[^/]+/, { title: 'City service', description: 'A Vineyard city service: how to reach it and what it covers.' }],
  [/^\/services\/?$/, { title: 'City services', description: 'Vineyard city services: utilities, permits, recreation and how to reach each one.' }],
];

/** The defaults for a path. */
export function headFor(path: string): Head {
  return TABLE.find(([re]) => re.test(path))?.[1] ?? { title: null, description: HOME_DESCRIPTION };
}
