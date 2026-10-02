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
  return [
    'Verified figures from the adopted fiscal year 2027 budget (July 1, 2026 to June 30, 2027): the FY 27 Final Budget adopted June 23, 2026, and the First Budget Amendment adopted August 25, 2026.',
    `General Fund revenue ${usd(GENERAL.revenueTotal)} including ${usd(GENERAL.transfersIn)} moved in from other funds (${inn.join('; ')}); the largest sources are ${revenue.join('; ')}.`,
    `General Fund spending was ${usd(GENERAL.adopted.total)} as adopted and ${usd(GENERAL.amended.total)} after the August 25 amendment, which cut ${usd(GENERAL.cutByAmendment)} (mostly Non-departmental, the Recorder and the Library).`,
    `Departments after the amendment: ${depts.join('; ')}. Money sent from the General Fund to other funds: ${out.join('; ')}.`,
    `All funds budgeted for fiscal 2027: ${funds.join('; ')}; together ${usd(70_944_358)}.`,
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
