/**
 * Vineyard's certified property tax rate by fiscal year, keyed in from city records. The chat's tax
 * rate answers are written from this table by code (worker/ai/taxRateAnswer.ts), so the rate is never
 * the model's wording and never comes from an unrelated record such as a project fiscal analysis.
 *
 * A fiscal year runs July 1 to June 30 and is named by the year it ends: the rate adopted in June 2025
 * is the fiscal 2026 rate. Newer records (a Utah County tax rate record, or a city resolution adopting
 * the certified tax rate) are looked up at answer time and win over this table when they are for a
 * later fiscal year, so a new entry here is only needed to give that record's rate a traced home.
 *
 * Every entry carries a `// Source:` comment: document title, page, document id. A document id opens in
 * the portal at /documents/<id>?page=<n>.
 */

export interface CertifiedTaxRate {
  /** Fiscal year the rate applies to (fiscal 2026 is July 1, 2025 to June 30, 2026). */
  fiscalYear: number;
  /** The rate exactly as the record prints it. */
  rate: string;
  /** Date the City Council adopted it (ISO). */
  adopted: string;
  /** The record that states the rate and the adoption, and the page it is on. */
  docId: string;
  docTitle: string;
  docKind: 'minutes' | 'resolution';
  page: number;
  /** The resolution that adopted it, when that record also states the rate. */
  resolution?: { number: string; docId: string; docTitle: string; page: number };
}

export const CERTIFIED_TAX_RATES: CertifiedTaxRate[] = [
  // Source: 06/25/2025 CC Meeting Minutes (June 25, 2025), page 9 (doc_1ef855677abe2a0b): "MOVED TO ADOPT
  // RESOLUTION 2025-32, THE VINEYARD CITY FISCAL YEAR 2025-2026 BUDGET AS PRESENTED BY STAFF AND THE
  // CERTIFIED TAX RATE OF .003796" (printed .003796; written 0.003796 here). The staff report in the
  // 06/25/2025 City Council Meeting Agenda Packet, page 112 (doc_7dd8a9cfbd03d1d8), gives the same
  // rate: "The certified tax rate for Vineyard City is proposed at 0.003796". Resolution 2025-32
  // (doc_2bfbc5979a6f8db9) is titled "... ADOPTING THE CERTIFIED TAX RATE" but its text does not print
  // the rate, so it is not cited for the figure (no `resolution` entry).
  {
    fiscalYear: 2026,
    rate: '0.003796',
    adopted: '2025-06-25',
    docId: 'doc_1ef855677abe2a0b',
    docTitle: '06/25/2025 CC Meeting Minutes',
    docKind: 'minutes',
    page: 9,
  },
];

const BUILT_IN = [...CERTIFIED_TAX_RATES];

/**
 * Rates staff entered in the staff portal (Budget area, site_content key "taxRates"), laid over the built-in ones by fiscal
 * year, so the chat's answers use them with the record staff named as the source. Called by refreshCityFacts.
 */
export function setStaffRates(list: CertifiedTaxRate[]): void {
  const byYear = new Map(BUILT_IN.map((e) => [e.fiscalYear, e]));
  for (const e of list) byYear.set(e.fiscalYear, e);
  CERTIFIED_TAX_RATES.splice(0, CERTIFIED_TAX_RATES.length, ...[...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear));
}

/** The newest entry in the table. */
export function newestCertifiedRate(): CertifiedTaxRate {
  return [...CERTIFIED_TAX_RATES].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
}

/** The fiscal year a date falls in: July 1, 2026 starts fiscal 2027. */
export function fiscalYearOf(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 7 ? y + 1 : y;
}

/**
 * The fiscal year a tax rate record dated `iso` sets the rate for. Cities adopt the next fiscal year's
 * rate from May to August (the June 25, 2025 adoption is the fiscal 2026 rate, and Utah County's tax
 * year 2026 rates are the ones in force for fiscal 2027), so a record dated May or later in a year is
 * for the fiscal year that ends the following June.
 */
export function rateFiscalYear(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 5 ? y + 1 : y;
}
