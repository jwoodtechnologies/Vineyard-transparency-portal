/**
 * Sales tax facts for the Budget page's Sales tax tab. Rates come from the Utah State Tax Commission's combined
 * rate chart ("Rates in effect as of October 1, 2026", Vineyard, location code 25-117). The 50/50 split is how the
 * city's own Citizens Budget describes it. Nothing here is estimated: if the state changes a rate, change it here.
 */

/** The city's FY25 Citizens Budget, in the portal's archive: page 5 explains the 50/50 split in the city's words. */
export const CITIZENS_BUDGET_DOC = 'doc_7641f1c7d6958611';

export const RATE_AS_OF = 'October 1, 2026';

export const RATE_SOURCE = {
  label: 'Utah Tax Commission: sales tax rates (PDF)',
  href: 'https://files.tax.utah.gov/tax/salestax/rate/26q4combined.pdf',
} as const;

/** One line of the Tax Commission's chart for Vineyard. `rate` is a percent of the purchase price. */
export interface RatePart {
  code: string;
  name: string;
  rate: number;
  group: 'state' | 'city' | 'transit' | 'roads' | 'county';
}

export const RATE_PARTS: RatePart[] = [
  { code: 'ST', name: 'State sales and use tax', rate: 4.85, group: 'state' },
  { code: 'LS', name: 'Local sales and use tax', rate: 1.0, group: 'city' },
  { code: 'CO', name: 'County option', rate: 0.25, group: 'county' },
  { code: 'MT', name: 'Mass transit', rate: 0.25, group: 'transit' },
  { code: 'MA', name: 'Additional mass transit', rate: 0.3, group: 'transit' },
  { code: 'MF', name: 'Mass transit, fixed guideway', rate: 0.25, group: 'transit' },
  { code: 'CT', name: 'County option transportation', rate: 0.25, group: 'roads' },
  { code: 'HT', name: 'Highways', rate: 0.2, group: 'roads' },
  { code: 'CP', name: 'County public transit', rate: 0.1, group: 'transit' },
];

/** The rate on a purchase in Vineyard, as printed on the chart. */
export const COMBINED_RATE = 7.45;

/** Food and food ingredients are taxed at a lower rate across Utah. */
export const FOOD_RATE = 3.0;

/** The groups the chart colors, in the order they are colored. */
export const RATE_GROUPS: Array<{ key: RatePart['group']; name: string; note: string }> = [
  { key: 'state', name: 'State of Utah', note: 'Applies statewide.' },
  { key: 'city', name: 'Vineyard', note: 'The local sales and use tax. Vineyard levies the maximum 1%.' },
  { key: 'transit', name: 'Public transit', note: 'Four transit taxes that fund public transit service.' },
  { key: 'roads', name: 'Roads and highways', note: 'Funds transportation and highway projects.' },
  { key: 'county', name: 'County option', note: 'The county option sales and use tax.' },
];

/** Hundredths of a percent as an exact number, so the parts add without floating-point drift. */
const hundredths = (n: number) => Math.round(n * 100);

export function rateTotal(parts: RatePart[] = RATE_PARTS): number {
  return parts.reduce((t, p) => t + hundredths(p.rate), 0) / 100;
}

/** "4.85%" */
export function ratePct(n: number): string {
  return `${n.toFixed(2)}%`;
}
