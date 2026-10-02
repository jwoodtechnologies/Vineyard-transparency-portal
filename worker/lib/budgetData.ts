/**
 * Vineyard City fiscal year 2027 budget (July 1, 2026 to June 30, 2027), keyed in from the
 * council-adopted budget book and slides. This is the single source for the /budget page, GET
 * /api/budget and the chat's budget answers, so all three always agree.
 *
 * Sources (all in the document archive):
 *   book   doc_2c248c52cbadfa22  "FY 27 Final Budget", adopted June 23, 2026
 *   slides doc_4d69a97b95e87bea  "FY 27 Final Budget Slides" (capital project lists, pages 4 to 6)
 *   amend  doc_3931ec08b88d5fbf  "FY 27 First Budget Amendment", August 25, 2026
 * Where the slides and the book disagree (Planning is 592,442 on the slides, 529,442 in the book),
 * the book wins.
 */

export const BUDGET_FISCAL_YEAR = 2027;
export const BUDGET_ADOPTED = '2026-06-23';
export const BUDGET_AMENDED = '2026-08-25';

export const BUDGET_DOCS = {
  book: 'doc_2c248c52cbadfa22',
  slides: 'doc_4d69a97b95e87bea',
  amendment: 'doc_3931ec08b88d5fbf',
  amendmentSummary: 'doc_9570af43463830a8',
} as const;

export interface BudgetFund {
  key: string;
  name: string;
  /** What the fund pays for, in plain words. */
  about: string;
  /** Total budgeted revenue and sources, including fund balance used. */
  total: number;
}

/** All nine funds, FY2027 budget book page 3. */
export const FUNDS: BudgetFund[] = [
  { key: 'rda', name: 'Redevelopment Agency', about: 'Rebuilding the former Geneva Steel site: roads, rail, utilities and the downtown core.', total: 29_786_656 },
  { key: 'general', name: 'General Fund', about: 'Everyday city government: police, fire, parks, planning, the library and staff.', total: 17_774_808 },
  { key: 'water', name: 'Water', about: 'Culinary and secondary water service, paid for by water bills.', total: 7_575_979 },
  { key: 'capital', name: 'Capital Projects', about: 'Money set aside for buildings, parks and other long-lived improvements.', total: 5_004_018 },
  { key: 'wastewater', name: 'Wastewater', about: 'Sewer lines and lift stations, paid for by sewer bills.', total: 4_265_184 },
  { key: 'impact', name: 'Impact Fees', about: 'Fees on new development, spent only on growth-related facilities.', total: 2_218_000 },
  { key: 'internal', name: 'Internal Service', about: 'Shared costs such as vehicles and equipment, charged back to departments.', total: 1_754_011 },
  { key: 'transport', name: 'Transportation', about: 'Street maintenance and improvements.', total: 1_743_994 },
  { key: 'storm', name: 'Stormwater', about: 'Storm drains and flood control.', total: 821_707 },
];
export const ALL_FUNDS_TOTAL = 70_944_358;

export interface BudgetLine {
  name: string;
  /** Adopted June 23, 2026. */
  adopted: number;
  /** After the August 25, 2026 amendment. */
  amended: number;
  /** FY2026, final amendment. */
  prior: number;
}

export interface SpendGroup {
  key: string;
  name: string;
  depts: string[];
}

/** General Fund departments, FY2027 budget book pages 5 to 21 and the Aug 25 amendment. */
export const DEPARTMENTS: BudgetLine[] = [
  { name: 'Police', adopted: 4_705_075, amended: 4_705_075, prior: 4_103_125 },
  { name: 'Fire', adopted: 2_873_462, amended: 2_873_462, prior: 2_585_600 },
  { name: 'Parks', adopted: 956_369, amended: 952_369, prior: 1_117_111 },
  { name: 'Public Works', adopted: 881_227, amended: 881_227, prior: 1_001_344 },
  { name: 'Sanitation', adopted: 741_837, amended: 741_837, prior: 675_675 },
  { name: 'Building', adopted: 652_426, amended: 652_426, prior: 701_240 },
  { name: 'Recreation', adopted: 590_877, amended: 574_477, prior: 559_475 },
  { name: 'Planning', adopted: 529_442, amended: 529_442, prior: 815_046 },
  { name: 'Finance', adopted: 385_391, amended: 380_021, prior: 410_473 },
  { name: 'Mayor and Council', adopted: 252_170, amended: 242_195, prior: 289_444 },
  { name: 'Special Events', adopted: 241_111, amended: 226_111, prior: 275_148 },
  { name: 'Communications', adopted: 236_383, amended: 236_383, prior: 245_368 },
  { name: 'Recorder', adopted: 223_033, amended: 181_383, prior: 249_427 },
  { name: 'Non-departmental', adopted: 222_180, amended: 122_180, prior: 222_180 },
  { name: 'Engineering', adopted: 220_350, amended: 220_350, prior: 210_169 },
  { name: 'City Manager', adopted: 216_961, amended: 211_461, prior: 306_678 },
  { name: 'Library', adopted: 157_397, amended: 134_910, prior: 121_518 },
];

/** Money the General Fund sends to other funds. */
export const TRANSFERS_OUT: BudgetLine[] = [
  { name: 'Transportation Fund', adopted: 1_470_999, amended: 1_470_999, prior: 0 },
  { name: 'Capital Projects Fund', adopted: 1_033_762, amended: 1_033_762, prior: 0 },
  { name: 'Internal Service Fund', adopted: 605_534, amended: 580_534, prior: 0 },
  { name: 'Stormwater Fund', adopted: 308_167, amended: 308_167, prior: 0 },
];

/** The seven groups the budget bar uses; every department and transfer belongs to exactly one. */
export const SPEND_GROUPS: SpendGroup[] = [
  { key: 'safety', name: 'Police and fire', depts: ['Police', 'Fire'] },
  { key: 'transfers', name: 'Sent to other funds', depts: ['Transportation Fund', 'Capital Projects Fund', 'Internal Service Fund', 'Stormwater Fund'] },
  { key: 'streets', name: 'Streets, public works and trash', depts: ['Public Works', 'Engineering', 'Sanitation'] },
  { key: 'parks', name: 'Parks, recreation and events', depts: ['Parks', 'Recreation', 'Special Events'] },
  { key: 'admin', name: 'City administration', depts: ['Mayor and Council', 'City Manager', 'Recorder', 'Finance', 'Communications', 'Non-departmental'] },
  { key: 'planning', name: 'Planning and building', depts: ['Planning', 'Building'] },
  { key: 'library', name: 'Library', depts: ['Library'] },
];

export interface RevenueLine {
  name: string;
  amount: number;
}

/** General Fund revenue lines, FY2027 adopted (unchanged by the amendment). */
export const REVENUE: RevenueLine[] = [
  { name: 'Property tax', amount: 5_395_500 },
  { name: 'Sales tax', amount: 3_800_000 },
  { name: 'Franchise fees', amount: 950_000 },
  { name: 'Fines', amount: 815_000 },
  { name: 'Sanitation charges', amount: 790_000 },
  { name: 'Building permits', amount: 750_000 },
  { name: 'Grants', amount: 694_500 },
  { name: 'Class B and C road funds', amount: 592_000 },
  { name: 'Transportation tax', amount: 500_000 },
  { name: 'Development fees', amount: 510_000 },
  { name: 'Inspection fees', amount: 340_000 },
  { name: 'Recreation fees', amount: 261_472 },
  { name: 'RAP tax', amount: 250_000 },
  { name: 'Sponsorships', amount: 60_000 },
  { name: 'Fire inspection fees', amount: 35_000 },
  { name: 'Rents', amount: 21_200 },
  { name: 'Donations', amount: 20_000 },
  { name: 'Business licenses', amount: 19_000 },
  { name: 'Library fees', amount: 13_620 },
  { name: 'Miscellaneous', amount: 10_000 },
  { name: 'Credit card fees', amount: 7_000 },
  { name: 'Interest', amount: 500 },
];

export const TRANSFERS_IN: RevenueLine[] = [
  { name: 'Redevelopment Agency', amount: 640_016 },
  { name: 'Capital Projects Fund', amount: 1_300_000 },
];

export interface RevenueGroup {
  key: string;
  name: string;
  lines: string[];
}

/** Seven revenue groups for the revenue bar; transfers in from other funds are one of them. */
export const REVENUE_GROUPS: RevenueGroup[] = [
  { key: 'property', name: 'Property tax', lines: ['Property tax'] },
  { key: 'sales', name: 'Sales, transportation and RAP taxes', lines: ['Sales tax', 'Transportation tax', 'RAP tax'] },
  { key: 'transfers', name: 'Moved in from other funds', lines: ['Redevelopment Agency', 'Capital Projects Fund'] },
  { key: 'fees', name: 'Permits, inspections and development fees', lines: ['Building permits', 'Development fees', 'Inspection fees', 'Fire inspection fees', 'Business licenses'] },
  { key: 'fines', name: 'Fines and sanitation charges', lines: ['Fines', 'Sanitation charges'] },
  { key: 'state', name: 'Grants and state road funds', lines: ['Grants', 'Class B and C road funds'] },
  { key: 'other', name: 'Franchise fees, recreation and other', lines: ['Franchise fees', 'Recreation fees', 'Library fees', 'Sponsorships', 'Rents', 'Donations', 'Miscellaneous', 'Credit card fees', 'Interest'] },
];

/** General Fund totals. */
export const GENERAL = {
  revenueBeforeTransfers: 15_834_792,
  transfersIn: 1_940_016,
  revenueTotal: 17_774_808,
  adopted: { departments: 14_085_690, transfersOut: 3_418_464, total: 17_504_153, surplus: 270_654 },
  amended: { departments: 13_865_308, transfersOut: 3_393_464, total: 17_258_772, surplus: 516_036 },
  cutByAmendment: 245_382,
} as const;

/** Five years of the biggest General Fund lines: FY23 to FY25 actual, FY26 final budget, FY27 adopted. */
export const HISTORY_YEARS = ['FY23', 'FY24', 'FY25', 'FY26', 'FY27'] as const;
export const HISTORY: Array<{ key: string; name: string; kind: 'revenue' | 'spending'; values: number[] }> = [
  { key: 'property', name: 'Property tax', kind: 'revenue', values: [3_261_171, 3_683_386, 4_972_219, 4_950_000, 5_395_500] },
  { key: 'sales', name: 'Sales tax', kind: 'revenue', values: [3_150_801, 3_204_125, 3_604_684, 3_588_000, 3_800_000] },
  { key: 'franchise', name: 'Franchise fees', kind: 'revenue', values: [892_696, 824_467, 942_630, 951_600, 950_000] },
  { key: 'permits', name: 'Building permits', kind: 'revenue', values: [265_675, 781_423, 611_971, 900_000, 750_000] },
  { key: 'police', name: 'Police', kind: 'spending', values: [2_328_474, 2_815_769, 3_252_168, 4_103_125, 4_705_075] },
  { key: 'fire', name: 'Fire', kind: 'spending', values: [1_654_069, 1_379_625, 2_250_807, 2_585_600, 2_873_462] },
];

/** Where the money for a capital project comes from, in the fixed order the page colors them. */
export const PROJECT_FUNDS: Array<{ key: string; name: string }> = [
  { key: 'rda', name: 'Redevelopment Agency' },
  { key: 'water', name: 'Water' },
  { key: 'impact', name: 'Impact fees' },
  { key: 'rap', name: 'RAP tax and grant' },
  { key: 'wastewater', name: 'Wastewater' },
  { key: 'general', name: 'General Fund' },
  { key: 'transport', name: 'Transportation' },
];

export interface CapitalProject {
  name: string;
  fund: string;
  /** Department that carries the project, as printed on the slide. */
  dept: string;
  amount: number;
  /** Slide page in the FY27 final budget slides. */
  page: 4 | 5 | 6;
}

/** Capital projects as listed on the council's budget slides, pages 4 to 6. Amounts are as printed. */
export const PROJECTS: CapitalProject[] = [
  // General Fund
  { fund: 'general', dept: 'Parks and Recreation', name: 'Finish construction of Slide Hill at Grove Park', amount: 64_959, page: 4 },
  { fund: 'general', dept: 'Parks and Recreation', name: 'Master plan design of the Robin’s property', amount: 50_000, page: 4 },
  { fund: 'general', dept: 'Parks and Recreation', name: 'Design and construct shoreline improvement', amount: 15_000, page: 4 },
  { fund: 'general', dept: 'Parks and Recreation', name: 'Design and construct Utah Lake shoreline trail and bike station improvements', amount: 18_000, page: 4 },
  { fund: 'general', dept: 'Parks and Recreation', name: 'Shoreline improvement (Utah Lake Authority grant)', amount: 7_000, page: 4 },
  { fund: 'general', dept: 'Public Safety', name: 'Public safety master plan and impact fee study', amount: 60_000, page: 4 },
  { fund: 'general', dept: 'Public Works', name: 'Dumpster enclosures', amount: 40_000, page: 4 },
  { fund: 'general', dept: 'Public Works', name: '170 North and North Vineyard Road crosswalk', amount: 15_000, page: 4 },
  { fund: 'general', dept: 'Public Works', name: 'Flip the Strip in all detention basins and collector roads', amount: 125_000, page: 4 },
  { fund: 'general', dept: 'Engineering', name: 'Design of the 1200 North overpass bridge', amount: 500_000, page: 4 },
  { fund: 'general', dept: 'Planning', name: 'Holdaway Road bike boulevard study', amount: 25_000, page: 4 },
  // Impact fees
  { fund: 'impact', dept: 'Transportation', name: 'Holdaway Fields 400 South betterment', amount: 500_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'Traffic signal at 600 North and Main Street', amount: 404_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'Public Works building improvements (25%)', amount: 300_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: '1600 North Geneva Road intersection widening', amount: 270_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'Homesteads reimbursement', amount: 130_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'Install street lights along 170 South', amount: 100_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'Holdaway Fields and Main Street betterment', amount: 80_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'Concrete and electrical for two sheds', amount: 66_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'One large shed', amount: 43_000, page: 4 },
  { fund: 'impact', dept: 'Transportation', name: 'One small shed', amount: 20_000, page: 4 },
  // RAP tax and grants (a separate block on the same slide)
  { fund: 'rap', dept: 'Parks and Recreation', name: 'Skate park near Vineyard City Hall (RAP tax and UORG grant)', amount: 1_420_000, page: 4 },
  { fund: 'rap', dept: 'Parks and Recreation', name: 'ARCH Commission RAP tax allocation', amount: 20_000, page: 4 },
  // Transportation fund
  { fund: 'transport', dept: 'Engineering', name: '400 South roadway, additional cost', amount: 100_000, page: 5 },
  { fund: 'transport', dept: 'Public Works', name: 'Pedestrian ramp updates (HBA, Main Street and Center Street)', amount: 75_000, page: 5 },
  { fund: 'transport', dept: 'Public Works', name: 'Parking implementation on 300 West: restriping and design', amount: 50_000, page: 5 },
  // Wastewater
  { fund: 'wastewater', dept: 'Wastewater', name: 'Lift Station 2 upgrade (carried over from FY25)', amount: 600_000, page: 5 },
  { fund: 'wastewater', dept: 'Wastewater', name: 'Public Works building improvements', amount: 250_000, page: 5 },
  { fund: 'wastewater', dept: 'Wastewater', name: 'Sewer system improvements', amount: 150_000, page: 5 },
  { fund: 'wastewater', dept: 'Wastewater', name: 'Storage building at Lift Station 2', amount: 125_000, page: 5 },
  { fund: 'wastewater', dept: 'Wastewater', name: 'Fiber to lift stations (rolled over)', amount: 15_000, page: 5 },
  // Water
  { fund: 'water', dept: 'Water', name: 'Central Utah Water Conservancy District take-down fee', amount: 1_850_000, page: 5 },
  { fund: 'water', dept: 'Water', name: '22 Lake Bottom water shares from Orem', amount: 554_500, page: 5 },
  { fund: 'water', dept: 'Water', name: 'Water shares', amount: 300_000, page: 5 },
  { fund: 'water', dept: 'Water', name: 'Public Works building improvements', amount: 250_000, page: 5 },
  { fund: 'water', dept: 'Water', name: 'Secondary water master plan', amount: 100_000, page: 5 },
  { fund: 'water', dept: 'Water', name: 'Pressurized irrigation pond pump upgrade', amount: 96_000, page: 5 },
  { fund: 'water', dept: 'Water', name: 'Concrete aprons around hydrants', amount: 60_000, page: 5 },
  { fund: 'water', dept: 'Water', name: 'Backflow software', amount: 15_000, page: 5 },
  { fund: 'water', dept: 'Water', name: 'Trailer for backhoe', amount: 10_000, page: 5 },
  // Redevelopment Agency
  { fund: 'rda', dept: 'Redevelopment', name: 'Environmental remediation, Anderson Geneva east and west', amount: 6_000_000, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: 'Rail spur realignment: design and construction', amount: 3_500_000, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: 'Vineyard Beach improvements: design (TRCC grant and Flagship rebate)', amount: 3_372_441, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: 'Vineyard Connector promenade overpass (UDOT)', amount: 2_200_000, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: 'Lift Station 4 (FY27 portion)', amount: 1_300_000, page: 6 },
  { fund: 'rda', dept: 'Engineering', name: 'Traffic signals at 600 North and Main Street and 400 North and Mill Road (carried over)', amount: 625_000, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: '400 North traffic signal: design and construction', amount: 625_000, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: 'Public Works building improvements', amount: 400_000, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: 'Pedestrian enhancements (flashers)', amount: 55_000, page: 6 },
  { fund: 'rda', dept: 'Redevelopment', name: 'City-wide economic development strategic plan', amount: 35_000, page: 6 },
];

export interface BudgetPayload {
  fiscalYear: number;
  label: string;
  adopted: string;
  amended: string;
  docs: typeof BUDGET_DOCS;
  allFundsTotal: number;
  funds: BudgetFund[];
  general: typeof GENERAL;
  departments: BudgetLine[];
  transfersOut: BudgetLine[];
  spendGroups: SpendGroup[];
  revenue: RevenueLine[];
  transfersIn: RevenueLine[];
  revenueGroups: RevenueGroup[];
  historyYears: readonly string[];
  history: typeof HISTORY;
  projectFunds: typeof PROJECT_FUNDS;
  projects: CapitalProject[];
  projectsTotal: number;
  notes: string[];
}

export function budgetPayload(): BudgetPayload {
  return {
    fiscalYear: BUDGET_FISCAL_YEAR,
    label: 'Fiscal year 2027 (July 1, 2026 to June 30, 2027)',
    adopted: BUDGET_ADOPTED,
    amended: BUDGET_AMENDED,
    docs: BUDGET_DOCS,
    allFundsTotal: ALL_FUNDS_TOTAL,
    funds: FUNDS,
    general: GENERAL,
    departments: DEPARTMENTS,
    transfersOut: TRANSFERS_OUT,
    spendGroups: SPEND_GROUPS,
    revenue: REVENUE,
    transfersIn: TRANSFERS_IN,
    revenueGroups: REVENUE_GROUPS,
    historyYears: HISTORY_YEARS,
    history: HISTORY,
    projectFunds: PROJECT_FUNDS,
    projects: PROJECTS,
    projectsTotal: PROJECTS.reduce((s, p) => s + p.amount, 0),
    notes: [
      'Project amounts are the figures printed on the council’s budget slides. Some projects are paid in part by grants, and a few carry over from earlier years.',
      'FY23 to FY25 are actual results, FY26 is the final budget after its amendments, and FY27 is the adopted budget.',
      'Where the slides and the budget book differ, this page uses the budget book.',
    ],
  };
}
