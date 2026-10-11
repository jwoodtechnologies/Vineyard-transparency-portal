/**
 * Budget questions answered straight from worker/lib/budgetData.ts: the adoption date, fund totals,
 * General Fund department budgets and revenue lines of the fiscal 2027 budget. Every number and date
 * in these answers is a value from that file, written by code, never by the model, and each sentence
 * cites the budget document the value was keyed from (BUDGET_DOCS). Fiscal 2026 (or a bare "2026")
 * is answered from the prior-year department column. A question this cannot answer exactly (another
 * year, a comparison, a project, salaries) returns null and goes to the records search.
 * Pure: no Worker types.
 */
import { BUDGET_ADOPTED, BUDGET_AMENDED, BUDGET_DOCS, BUDGET_FISCAL_YEAR, DEPARTMENTS, FUNDS, GENERAL, REVENUE, type BudgetFund, type BudgetLine, type RevenueLine } from '../lib/budgetData';
import { topicWords } from './followup';

export type BudgetIntent =
  | { kind: 'adopted' }
  | { kind: 'amended' }
  | { kind: 'total' }
  | { kind: 'lines'; departments: BudgetLine[]; funds: BudgetFund[]; revenue: RevenueLine[] }
  /** Fiscal 2026: only the General Fund department figures (the FY2026 column of the FY 27 book) are in the data. */
  | { kind: 'prior'; departments: BudgetLine[]; other: boolean; calendar: boolean };

/** Which budget document a sentence cites. */
export type BudgetDocKey = 'book' | 'amendment';

export interface BudgetAnswer {
  intent: BudgetIntent['kind'];
  /** Sentences in order; each cites the documents it was keyed from. */
  sentences: Array<{ text: string; docs: BudgetDocKey[] }>;
}

export const BUDGET_DOC_TITLES: Record<BudgetDocKey, { id: string; title: string; date: string }> = {
  // Source: titles and dates as recorded in the header of worker/lib/budgetData.ts.
  book: { id: BUDGET_DOCS.book, title: 'FY 27 Final Budget', date: BUDGET_ADOPTED },
  amendment: { id: BUDGET_DOCS.amendment, title: 'FY 27 First Budget Amendment', date: BUDGET_AMENDED },
};

const BUDGETISH = /\b(budget|budgets|budgeted|spend|spends|spending|spent|cost|costs|allocat\w*|funding|funded|appropriat\w*|revenues?|how much|fiscal|fy\s?'?\d{2}(?:\d{2})?|money|dollars)\b/i;
/** Things the data cannot settle exactly: other years, comparisons, reasons, actual spending, people's pay. */
const OUT_OF_SCOPE = /\b(last year|prior year|previous|next year|actuals?|tentative|proposed|draft|change[ds]?|increase[ds]?|decrease[ds]?|compare[ds]?|comparison|versus|vs|per capita|percent(age)?|share|why|reason|salar(y|ies)|wages?|pay(roll)?|employees?|positions?|staffing|projects?|overtime|history|historical|trend|grow|grew|growth|cut|cuts|deficit|surplus|reserves?|balance|debt|bonds?|transfers?|sent to|moved)\b/i;

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-06-23" as "June 23, 2026"; null when the value is not a full date. */
export function longDate(iso: string | null | undefined): string | null {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Revenue lines first (so "fire inspection fees" is not the Fire department), then funds, then departments. */
const REVENUE_ALIASES: Array<[RegExp, string]> = [...REVENUE].sort((a, b) => b.name.length - a.name.length).map((r) => [new RegExp(`\\b${r.name.toLowerCase().replace(/ /g, '\\s+')}(e?s)?\\b`, 'i'), r.name]);
const FUND_ALIASES: Array<[RegExp, string]> = [
  [/\bgeneral\s+fund\b/i, 'general'],
  [/\b(storm\s?water|storm\s+drains?)(\s+fund)?\b/i, 'storm'],
  [/\b(waste\s?water|sewer)(\s+fund)?\b/i, 'wastewater'],
  [/\bwater(\s+fund)?\b/i, 'water'],
  [/\b(redevelopment(\s+agency)?|rda)(\s+fund)?\b/i, 'rda'],
  [/\bcapital\s+projects?\s+fund\b/i, 'capital'],
  [/\bimpact\s+fees?(\s+fund)?\b/i, 'impact'],
  [/\binternal\s+service(\s+fund)?\b/i, 'internal'],
  [/\btransportation(\s+fund)?\b/i, 'transport'],
];
const DEPT_ALIASES: Array<[RegExp, string[]]> = [
  [/\bpublic\s+safety\b/i, ['Police', 'Fire']],
  [/\bparks?\s+(and|&)\s+rec(reation)?\b/i, ['Parks', 'Recreation']],
  [/\b(police|law\s+enforcement|sheriff)(\s+department)?\b/i, ['Police']],
  [/\bfire(\s+department|\s+services?|\s+protection)?\b/i, ['Fire']],
  [/\bparks?(\s+department)?\b/i, ['Parks']],
  [/\bpublic\s+works\b/i, ['Public Works']],
  [/\b(sanitation|garbage|trash)\b/i, ['Sanitation']],
  [/\bbuilding(\s+department|\s+division)?\b/i, ['Building']],
  [/\brecreation\b/i, ['Recreation']],
  [/\bplanning(\s+department)?\b/i, ['Planning']],
  [/\bfinance(\s+department)?\b/i, ['Finance']],
  [/\bmayor\s+and\s+(city\s+)?council\b/i, ['Mayor and Council']],
  [/\b(special\s+)?events\b/i, ['Special Events']],
  [/\bcommunications?\b/i, ['Communications']],
  [/\b(city\s+)?recorder('s\s+office)?\b/i, ['Recorder']],
  [/\bnon-?departmental\b/i, ['Non-departmental']],
  [/\bengineering\b/i, ['Engineering']],
  [/\bcity\s+manager('s\s+office)?\b/i, ['City Manager']],
  [/\blibrar(y|ies)\b/i, ['Library']],
];
const TOTAL = /\b(all\s+(city\s+)?funds|total\s+(city\s+)?budget|whole\s+(city\s+)?budget|entire\s+(city\s+)?budget|overall\s+budget|city'?s\s+(total\s+)?budget|how\s+big\s+is\s+the\s+(city\s+)?budget|size\s+of\s+the\s+(city\s+)?budget)\b/i;

/** Words a budget question may use around its subject without asking anything the data cannot answer. */
const ALLOWED = new Set(
  (
    'budget budgets budgeted spend spends spending spent cost costs allocated allocation allocate funding funded fund funds appropriated appropriation ' +
    'revenue revenues money dollars total much fiscal final adopted adoption amended amendment approved department departments division office ' +
    'line item operating operations current currently get gets receive receives set aside brings bring collect collects expected combined ' +
    'together both each city vineyard year this the services service general first fy'
  ).split(/\s+/),
);

/** A span of two years ("2026-2027", "2026-27", "2026/27"): the fiscal year it names is the later one. */
const SPAN = /\b((?:19|20)\d{2})\s*[-/]\s*((?:19|20)?\d{2})\b/g;
/** Every year expression in a question: spans, "FY27", "fiscal year 2026", a bare year. */
const YEAR_WORDS = /\b(?:19|20)\d{2}\s*[-/]\s*(?:19|20)?\d{2}\b|\bfy\s?'?\d{2,4}\b|\bfiscal\s+(?:year\s+)?\d{2,4}\b|\b(?:19|20)\d{2}\b/gi;

/**
 * The fiscal year a question names: the budget year (2027), the year before it (2026, the data's
 * prior-year column), another year, or none. A bare calendar year is read as the fiscal year ending
 * in it ("2026" is fiscal 2026, July 2025 to June 2026), and `calendar` says it was a bare year.
 */
export function fiscalYearIn(q: string): { year: number | null; other: boolean; calendar: boolean } {
  const years = new Set<number>();
  let calendar = false;
  const full = (x: string) => Number(x.length === 2 ? `20${x}` : x);
  let rest = q.replace(SPAN, (_, a: string, b: string) => {
    const end = full(b.length === 2 ? `${a.slice(0, 2)}${b}` : b);
    if (end - Number(a) === 1) years.add(end);
    else years.add(-1);
    return ' ';
  });
  rest = rest.replace(/\bfy\s?'?(\d{2}(?:\d{2})?)\b/gi, (_, y: string) => (years.add(full(y)), ' '));
  rest = rest.replace(/\bfiscal\s+(?:year\s+)?(\d{2,4})\b/gi, (_, y: string) => (years.add(full(y)), ' '));
  for (const m of rest.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    years.add(Number(m[0]));
    calendar = true;
  }
  const list = [...years];
  const prior = BUDGET_FISCAL_YEAR - 1;
  if (!list.length) return { year: null, other: false, calendar: false };
  if (list.every((y) => y === BUDGET_FISCAL_YEAR)) return { year: BUDGET_FISCAL_YEAR, other: false, calendar: false };
  if (list.every((y) => y === prior)) return { year: prior, other: false, calendar };
  return { year: null, other: true, calendar };
}

/** The budget question a message asks, or null when the data cannot answer it exactly. */
export function budgetIntent(question: string): BudgetIntent | null {
  const q = question.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const fy = fiscalYearIn(q);
  if (!BUDGETISH.test(q) || fy.other || OUT_OF_SCOPE.test(q)) return null;
  const prior = fy.year === BUDGET_FISCAL_YEAR - 1;
  const asksDate = /\b(when|what\s+date|which\s+date|what\s+day|date)\b/i.test(q);
  if (asksDate && /\bbudget\b/i.test(q)) {
    if (/\bamend(ed|ment)\b/i.test(q) && !/\b(adopt\w*|pass\w*|final)\b/i.test(q)) return { kind: 'amended' };
    if (/\b(adopt\w*|pass\w*|approv\w*|final\w*)\b/i.test(q)) return { kind: 'adopted' };
    return null;
  }
  if (asksDate) return null;
  let rest = q.replace(YEAR_WORDS, ' ');
  const take = (re: RegExp) => {
    const hit = re.test(rest);
    if (hit) rest = rest.replace(new RegExp(re.source, 'gi'), ' ');
    return hit;
  };
  const revenue = REVENUE_ALIASES.filter(([re]) => take(re)).map(([, n]) => REVENUE.find((r) => r.name === n)!);
  const funds = FUND_ALIASES.filter(([re]) => take(re)).map(([, k]) => FUNDS.find((f) => f.key === k)!);
  const names = DEPT_ALIASES.filter(([re]) => take(re)).flatMap(([, n]) => n);
  const departments = DEPARTMENTS.filter((d) => names.includes(d.name));
  const total = take(TOTAL);
  // Anything left that names a subject ("the parks master plan", "Holdaway Fields") is not a budget line.
  const left = topicWords(rest).filter((w) => !ALLOWED.has(w.toLowerCase()));
  if (left.length) return null;
  if (prior) return revenue.length || funds.length || departments.length || total ? { kind: 'prior', departments, other: Boolean(revenue.length || funds.length || total), calendar: fy.calendar } : null;
  if (revenue.length || funds.length || departments.length) return { kind: 'lines', departments, funds, revenue };
  if (total) return { kind: 'total' };
  return null;
}

/** The answer, every figure and date taken from budgetData.ts. */
export function budgetAnswer(intent: BudgetIntent): BudgetAnswer {
  const adopted = longDate(BUDGET_ADOPTED);
  const amended = longDate(BUDGET_AMENDED);
  const fy = `fiscal year ${BUDGET_FISCAL_YEAR} (July 1, ${BUDGET_FISCAL_YEAR - 1} to June 30, ${BUDGET_FISCAL_YEAR})`;
  const book = adopted ? `the FY 27 Final Budget adopted ${adopted}` : 'the FY 27 Final Budget';
  const amend = amended ? `the First Budget Amendment of ${amended}` : 'the First Budget Amendment';
  const s: BudgetAnswer['sentences'] = [];
  if (intent.kind === 'prior') {
    const py = BUDGET_FISCAL_YEAR - 1;
    const pfy = `fiscal year ${py} (July 1, ${py - 1} to June 30, ${py})`;
    if (intent.calendar) {
      s.push({ text: `The city budget runs July 1 to June 30, so ${py} here means ${pfy}.`, docs: [] });
      s.push({ text: `Fiscal year ${BUDGET_FISCAL_YEAR} began July 1, ${py}.`, docs: [] });
    }
    if (intent.departments.length) {
      s.push({ text: `General Fund department budgets for ${pfy}, final amended, as printed in ${book}:`, docs: ['book'] });
      for (const d of intent.departments) s.push({ text: `${d.name}: ${usd(d.prior)}.`, docs: ['book'] });
    }
    if (intent.other || !intent.departments.length)
      s.push({ text: `The portal's budget data has ${pfy} figures for General Fund departments only; its fund and revenue figures are for ${fy}.`, docs: [] });
    s.push({ text: 'Every line is on the portal’s Budget page.', docs: [] });
    return { intent: intent.kind, sentences: s };
  }
  if (intent.kind === 'adopted') {
    s.push(adopted ? { text: `The City Council adopted the FY 27 Final Budget, for ${fy}, on ${adopted}.`, docs: ['book'] } : { text: 'The adoption date of the FY 27 Final Budget is not recorded in the portal’s budget data.', docs: [] });
    if (amended) s.push({ text: `The First Budget Amendment to it is dated ${amended}.`, docs: ['amendment'] });
  } else if (intent.kind === 'amended') {
    s.push(amended ? { text: `The First Budget Amendment to the FY 27 budget, for ${fy}, is dated ${amended}.`, docs: ['amendment'] } : { text: 'The date of the budget amendment is not recorded in the portal’s budget data.', docs: [] });
  } else if (intent.kind === 'total') {
    // Owner rule: never a total of all funds added together. The General Fund total, then each fund's
    // own total as page 3 of the budget book lists it, never summed.
    s.push({ text: `The General Fund, the city's everyday operating budget, is ${usd(GENERAL.amended.total)} of spending for ${fy}, after ${amend}.`, docs: ['amendment'] });
    s.push({ text: `The city budget is presented by fund, and ${book} lists each fund's revenue and sources on page 3:`, docs: ['book'] });
    for (const f of FUNDS) s.push({ text: `${f.name}: ${usd(f.total)}.`, docs: ['book'] });
  } else {
    if (intent.departments.length) {
      s.push({ text: `General Fund department budgets for ${fy}:`, docs: [] });
      for (const d of intent.departments) {
        s.push(
          d.amended === d.adopted
            ? { text: `${d.name}: ${usd(d.adopted)} in ${book}, unchanged by ${amend}.`, docs: ['book', 'amendment'] }
            : { text: `${d.name}: ${usd(d.adopted)} in ${book}, and ${usd(d.amended)} after ${amend}.`, docs: ['book', 'amendment'] },
        );
      }
    }
    for (const f of intent.funds) {
      if (f.key === 'general') {
        s.push({ text: `The General Fund has ${usd(GENERAL.revenueTotal)} in revenue and sources in ${book}, for ${fy}.`, docs: ['book'] });
        s.push({ text: `General Fund spending is ${usd(GENERAL.adopted.total)} as adopted.`, docs: ['book'] });
        s.push({ text: `It is ${usd(GENERAL.amended.total)} after ${amend}.`, docs: ['amendment'] });
      } else {
        s.push({ text: `${f.name} fund: ${usd(f.total)} in total revenue and sources, including fund balance used, in ${book}, for ${fy}.`, docs: ['book'] });
      }
    }
    for (const r of intent.revenue) s.push({ text: `${r.name}: ${usd(r.amount)} of General Fund revenue in ${book}, for ${fy}.`, docs: ['book'] });
  }
  s.push({ text: 'Every line is on the portal’s Budget page.', docs: [] });
  return { intent: intent.kind, sentences: s };
}
