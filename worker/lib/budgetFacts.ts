/** Plain-text digests of the adopted fiscal 2027 budget for the chat's prompt (pure, no Worker types). */
import { DEPARTMENTS, FUNDS, GENERAL, PROJECTS, PROJECT_FUNDS, REVENUE, TRANSFERS_IN, TRANSFERS_OUT } from './budgetData';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Totals, revenue, departments and funds. */
export function budgetFacts(): string {
  const depts = [...DEPARTMENTS].sort((a, b) => b.amended - a.amended).map((d) => `${d.name} ${usd(d.amended)}${d.amended !== d.adopted ? ` (was ${usd(d.adopted)})` : ''}`);
  const revenue = [...REVENUE].slice(0, 9).map((r) => `${r.name} ${usd(r.amount)}`);
  const funds = FUNDS.map((f) => `${f.name} ${usd(f.total)}`);
  const out = TRANSFERS_OUT.map((t) => `${t.name} ${usd(t.amended)}`);
  const inn = TRANSFERS_IN.map((t) => `${t.name} ${usd(t.amount)}`);
  const cutDepts = DEPARTMENTS.map((d) => ({ name: d.name, cut: d.prior - d.amended })).filter((d) => d.cut > 0).sort((a, b) => b.cut - a.cut);
  const cutTotal = cutDepts.reduce((s, d) => s + d.cut, 0);
  const taxes = REVENUE.filter((r) => ['Property tax', 'Sales tax', 'Transportation tax', 'RAP tax'].includes(r.name)).reduce((s, r) => s + r.amount, 0);
  return [
    'Verified figures from the adopted fiscal year 2027 budget (July 1, 2026 to June 30, 2027): the FY 27 Final Budget adopted June 23, 2026, and the First Budget Amendment adopted August 25, 2026.',
    `General Fund revenue ${usd(GENERAL.revenueTotal)} including ${usd(GENERAL.transfersIn)} moved in from other funds (${inn.join('; ')}); the largest sources are ${revenue.join('; ')}.`,
    `General Fund spending was ${usd(GENERAL.adopted.total)} as adopted and ${usd(GENERAL.amended.total)} after the August 25 amendment, which cut ${usd(GENERAL.cutByAmendment)} (mostly Non-departmental, the Recorder and the Library).`,
    `Spending cuts: the August 25 amendment cut ${usd(GENERAL.cutByAmendment)}. General Fund spending is ${usd(GENERAL.tentativeTotal - GENERAL.amended.total)} below the ${usd(GENERAL.tentativeTotal)} in the tentative budget the council saw May 12, 2026. ${cutDepts.length} departments are budgeted ${usd(cutTotal)} below their fiscal 2026 budgets (${cutDepts.slice(0, 4).map((d) => `${d.name} ${usd(d.cut)}`).join('; ')}).`,
    `Departments after the amendment: ${depts.join('; ')}. Money sent from the General Fund to other funds: ${out.join('; ')}.`,
    `Taxes (property, sales, transportation and RAP) bring in ${usd(taxes)}, about ${Math.round((taxes / GENERAL.revenueTotal) * 100)} percent of General Fund revenue; the rest is fees, fines, franchise fees, state road money, grants and money moved in from other funds.`,
    `The nine city funds budgeted for fiscal 2027 are ${funds.join('; ')}; together ${usd(70_944_358)}. That total is not tax revenue: it adds up separate funds (water, sewer, storm water, the Redevelopment Agency, impact fees, capital projects and others) that run on their own charges, grants and fees, and it counts money moved between funds. When asked how big the city budget is or what residents pay, lead with the General Fund (${usd(GENERAL.amended.total)} of spending after the amendment), the everyday operating budget that taxes mainly pay for, and say the all-funds total is a different, larger figure that includes those separate funds.`,
    'Full detail, charts and every project: the portal’s Budget page at /budget.',
  ].join(' ');
}

/** Every capital project in the adopted budget, grouped by funding source. */
export function projectFacts(): string {
  const groups = PROJECT_FUNDS.map((f) => {
    const list = PROJECTS.filter((p) => p.fund === f.key).sort((a, b) => b.amount - a.amount);
    const total = list.reduce((s, p) => s + p.amount, 0);
    return `${f.name} (${usd(total)}): ${list.map((p) => `${p.name} ${usd(p.amount)}`).join('; ')}`;
  });
  const total = PROJECTS.reduce((s, p) => s + p.amount, 0);
  return [
    `Capital projects in the adopted fiscal year 2027 budget, as listed on the City Council's budget slides (${PROJECTS.length} projects, ${usd(total)} in all; each amount is the fiscal 2027 line item, some projects cost more over several years and some are paid partly by grants):`,
    groups.join('. ') + '.',
    'Only these projects are in the fiscal 2027 budget. The city’s older Capital Improvement Plan map and earlier budgets list other projects (for example Fire Station 35, a water tank and booster station, and Orem wastewater plant upgrades) that are finished, rolled over or not funded this year; do not present them as current unless a record says so. A new City Hall is not planned.',
  ].join(' ');
}
