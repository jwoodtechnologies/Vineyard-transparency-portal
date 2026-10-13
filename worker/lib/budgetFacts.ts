/** Plain-text digests of the adopted budget for the chat's prompt (pure, no Worker types). Every figure, name and date is read from the budget now in force. */
import { longDate } from '../ai/budgetAnswer';
import {
  BUDGET_ADOPTED,
  BUDGET_AMENDED,
  BUDGET_AMENDMENT_NAME,
  BUDGET_AMENDMENT_ORDINANCE,
  BUDGET_FISCAL_YEAR,
  BUDGET_TENTATIVE_DATE,
  budgetAmended,
  DEPARTMENTS,
  fiscalShort,
  FUNDS,
  GENERAL,
  PROJECTS,
  PROJECT_FUNDS,
  REVENUE,
  TRANSFERS_IN,
  TRANSFERS_OUT,
} from './budgetData';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
/** "A, B and C". */
const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

/** Totals, revenue, departments and funds. */
export function budgetFacts(): string {
  const fy = BUDGET_FISCAL_YEAR;
  const amended = budgetAmended();
  const adoptedOn = longDate(BUDGET_ADOPTED);
  const amendedOn = amended ? longDate(BUDGET_AMENDED) : null;
  const ordinance = BUDGET_AMENDMENT_ORDINANCE ? ` (${BUDGET_AMENDMENT_ORDINANCE})` : '';
  const depts = [...DEPARTMENTS].sort((a, b) => b.amended - a.amended).map((d) => `${d.name} ${usd(d.amended)}${d.amended !== d.adopted ? ` (was ${usd(d.adopted)})` : ''}`);
  const revenue = [...REVENUE].slice(0, 9).map((r) => `${r.name} ${usd(r.amount)}`);
  const funds = FUNDS.map((f) => `${f.name} ${usd(f.total)}`);
  const out = TRANSFERS_OUT.map((t) => `${t.name} ${usd(t.amended)}`);
  const inn = TRANSFERS_IN.map((t) => `${t.name} ${usd(t.amount)}`);
  const cutDepts = DEPARTMENTS.map((d) => ({ name: d.name, cut: d.prior - d.amended }))
    .filter((d) => d.cut > 0)
    .sort((a, b) => b.cut - a.cut);
  const cutTotal = cutDepts.reduce((s, d) => s + d.cut, 0);
  const taxes = REVENUE.filter((r) => ['Property tax', 'Sales tax', 'Transportation tax', 'RAP tax'].includes(r.name)).reduce((s, r) => s + r.amount, 0);
  const biggestCuts = [...DEPARTMENTS, ...TRANSFERS_OUT]
    .map((d) => ({ name: d.name, cut: d.adopted - d.amended }))
    .filter((d) => d.cut > 0)
    .sort((a, b) => b.cut - a.cut)
    .slice(0, 3)
    .map((d) => d.name);
  const tentativeOn = longDate(BUDGET_TENTATIVE_DATE);
  const belowTentative = GENERAL.tentativeTotal - GENERAL.amended.total;
  const sentences: string[] = [
    `Verified figures from the adopted fiscal year ${fy} budget (July 1, ${fy - 1} to June 30, ${fy}): the ${fiscalShort()} Final Budget${adoptedOn ? ` adopted ${adoptedOn}` : ''}${amendedOn ? `, and the ${BUDGET_AMENDMENT_NAME} adopted ${amendedOn}` : ''}.`,
    `General Fund revenue ${usd(GENERAL.revenueTotal)} including ${usd(GENERAL.transfersIn)} moved in from other funds (${inn.join('; ')}); the largest sources are ${revenue.join('; ')}.`,
    amended && amendedOn
      ? `General Fund spending was ${usd(GENERAL.adopted.total)} as adopted and ${usd(GENERAL.amended.total)} after the ${amendedOn} amendment${ordinance}, which cut ${usd(GENERAL.cutByAmendment)}${biggestCuts.length ? ` (mostly ${andList(biggestCuts)})` : ''}.`
      : `General Fund spending is ${usd(GENERAL.adopted.total)} as adopted. The budget has not been amended since it was adopted.`,
  ];
  const cuts: string[] = [];
  if (amended && amendedOn && GENERAL.cutByAmendment > 0) cuts.push(`the ${amendedOn} amendment cut ${usd(GENERAL.cutByAmendment)}.`);
  if (GENERAL.tentativeTotal > 0 && belowTentative !== 0) {
    cuts.push(
      `General Fund spending is ${usd(Math.abs(belowTentative))} ${belowTentative > 0 ? 'below' : 'above'} the ${usd(GENERAL.tentativeTotal)} in the tentative budget the council saw${tentativeOn ? ` ${tentativeOn}` : ''}.`,
    );
  }
  if (cutDepts.length)
    cuts.push(
      `${cutDepts.length} departments are budgeted ${usd(cutTotal)} below their fiscal ${fy - 1} budgets (${cutDepts
        .slice(0, 4)
        .map((d) => `${d.name} ${usd(d.cut)}`)
        .join('; ')}).`,
    );
  if (cuts.length) sentences.push(`Spending cuts: ${cuts.join(' ')}`);
  sentences.push(`Departments ${amended ? 'after the amendment' : 'as adopted'}: ${depts.join('; ')}. Money sent from the General Fund to other funds: ${out.join('; ')}.`);
  if (taxes > 0) {
    sentences.push(
      `Taxes (property, sales, transportation and RAP) bring in ${usd(taxes)}, about ${Math.round((taxes / GENERAL.revenueTotal) * 100)} percent of General Fund revenue; the rest is fees, fines, franchise fees, state road money, grants and money moved in from other funds.`,
    );
  }
  sentences.push(
    // Owner rule: no total of all funds added together, in the page or the chat.
    `The city budget is presented by fund. Each fund's fiscal ${fy} revenue and sources, as listed in the ${fiscalShort()} Final Budget: ${funds.join('; ')}. Never add the funds together or state a total of all funds: the budget is presented fund by fund. When asked how big the city budget is or what residents pay, give the General Fund (${usd(GENERAL.amended.total)} of spending${amended ? ' after the amendment' : ''}), the everyday operating budget that taxes mainly pay for, and say the other funds (water, sewer, storm water, the Redevelopment Agency, impact fees, capital projects and others) are separate funds that run on their own charges, grants and fees.`,
    'Full detail, charts and every project: the portal’s Budget page at /budget.',
  );
  return sentences.join(' ');
}

/** Projects the city's older plan and earlier budgets list, named so the chat does not call them current; each is dropped when the budget lists it. */
const NOT_CURRENT: Array<[RegExp, string]> = [
  [/fire station 35/i, 'Fire Station 35'],
  [/water tank|booster station/i, 'a water tank and booster station'],
  [/\borem\b|wastewater plant/i, 'Orem wastewater plant upgrades'],
];

/** Every capital project in the adopted budget, grouped by funding source. */
export function projectFacts(): string {
  const groups = PROJECT_FUNDS.map((f) => {
    const list = PROJECTS.filter((p) => p.fund === f.key).sort((a, b) => b.amount - a.amount);
    const total = list.reduce((s, p) => s + p.amount, 0);
    return `${f.name} (${usd(total)}): ${list.map((p) => `${p.name} ${usd(p.amount)}`).join('; ')}`;
  });
  const total = PROJECTS.reduce((s, p) => s + p.amount, 0);
  // Source: Fire Station 35 is feature 650/32 and New City Hall is feature 650/43 on the city's Capital Improvement
  // Plan layer (see worker/lib/capitalPlan.ts); the water tank and booster station and the Orem wastewater plant
  // upgrades are NOT TRACED - verify (no feature id or document recorded).
  const others = NOT_CURRENT.filter(([re]) => !PROJECTS.some((p) => re.test(p.name))).map(([, label]) => label);
  const noCityHall = !PROJECTS.some((p) => /city hall|city center/i.test(p.name));
  return [
    `Capital projects in the adopted fiscal year ${BUDGET_FISCAL_YEAR} budget, as listed on the City Council's budget slides (${PROJECTS.length} projects, ${usd(total)} in all; each amount is the fiscal ${BUDGET_FISCAL_YEAR} line item, some projects cost more over several years and some are paid partly by grants):`,
    groups.join('. ') + '.',
    `Only these projects are in the fiscal ${BUDGET_FISCAL_YEAR} budget. The city’s older Capital Improvement Plan map and earlier budgets list other projects${others.length ? ` (for example ${andList(others)})` : ''} that are finished, rolled over or not funded this year; do not present them as current unless a record says so.${noCityHall ? ' A new City Hall is not planned.' : ''}`,
  ].join(' ');
}
