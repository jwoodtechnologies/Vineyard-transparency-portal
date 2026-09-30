/** The few record categories shown on the home screen and the records page. */
export interface RecordCategory {
  id: string;
  label: string;
  short: string;
  /** API category ids (worker/lib/taxonomy.ts) this tile covers. */
  api: string[];
  blurb: string;
  /** Words that find this subject inside meeting packets and other records. */
  topics?: string;
}

export const RECORD_CATEGORIES: RecordCategory[] = [
  { id: 'meetings', label: 'Agendas & minutes', short: 'Agendas & minutes', api: ['meetings'], blurb: 'Agendas, agenda packets and minutes from every public meeting.' },
  { id: 'finance', label: 'Budget & finance', short: 'Budget & finance', api: ['budgets_finance', 'audits'], blurb: 'Budgets, amendments, financial reports and audits.', topics: 'budget audit fiscal revenue expenditures appropriation fund' },
  { id: 'laws', label: 'Ordinances & resolutions', short: 'Ordinances', api: ['ordinances', 'resolutions'], blurb: 'Ordinances and resolutions adopted by the city.', topics: 'ordinance resolution' },
  { id: 'plans', label: 'Plans & development', short: 'Plans', api: ['planning_land_use', 'development_agreements', 'contracts'], blurb: 'Plans, staff reports, development agreements and contracts.', topics: 'general plan zoning site plan subdivision development agreement' },
];

export const categoryById = (id: string | null) => RECORD_CATEGORIES.find((c) => c.id === id) ?? null;
