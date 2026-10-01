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
  /** One line under the tile on phones. */
  hint: string;
  /** Record types inside this category, offered as filter chips. */
  types: Array<{ id: string; label: string }>;
}

export const RECORD_CATEGORIES: RecordCategory[] = [
  { id: 'meetings', hint: 'Agendas, minutes', label: 'Agendas & minutes', short: 'Meetings', types: [{ id: 'agenda', label: 'Agendas' }, { id: 'agenda_packet', label: 'Agenda packets' }, { id: 'minutes', label: 'Minutes' }], api: ['meetings'], blurb: 'Agendas, agenda packets and minutes from every public meeting.' },
  { id: 'finance', hint: 'Budgets, audits', label: 'Budget & finance', short: 'Budget', types: [{ id: 'budget', label: 'Budgets' }, { id: 'financial_report', label: 'Financial reports' }, { id: 'audit', label: 'Audits' }], api: ['budgets_finance', 'audits'], blurb: 'Budgets, amendments, financial reports and audits.', topics: 'budget audit fiscal revenue expenditures appropriation fund' },
  { id: 'laws', hint: 'And resolutions', label: 'Ordinances & resolutions', short: 'Ordinances', types: [{ id: 'ordinance', label: 'Ordinances' }, { id: 'resolution', label: 'Resolutions' }], api: ['ordinances', 'resolutions'], blurb: 'Ordinances and resolutions adopted by the city.', topics: 'ordinance resolution' },
  { id: 'code', hint: 'Municipal and zoning code', label: 'City code', short: 'City code', types: [{ id: 'municipal_code', label: 'Code sections' }], api: ['other'], blurb: 'The Municipal Code, Zoning Code, Subdivision Code, special districts and the tree and landscape manual, section by section.' },
  { id: 'plans', hint: 'Plans, agreements, contracts', label: 'Plans & development', short: 'Plans', types: [{ id: 'plan', label: 'Plans' }, { id: 'staff_report', label: 'Staff reports' }, { id: 'development_agreement', label: 'Development agreements' }, { id: 'contract', label: 'Contracts' }], api: ['planning_land_use', 'development_agreements', 'contracts'], blurb: 'Plans, staff reports, development agreements and contracts.', topics: 'general plan zoning site plan subdivision development agreement' },
];

export const categoryById = (id: string | null) => RECORD_CATEGORIES.find((c) => c.id === id) ?? null;
