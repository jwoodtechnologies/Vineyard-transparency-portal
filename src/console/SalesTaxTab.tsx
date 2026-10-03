/**
 * The Budget page's Sales tax tab: what the city budgets from sales tax, the rate a shopper pays in Vineyard and
 * where each part of it goes, how the city's 1% is shared, and a few years of the total. Rates are in salesTax.ts;
 * the dollar figures come from the same /api/budget payload as every other tab.
 */
import { Link } from 'react-router-dom';
import { ArrowUpRight, FileText } from 'lucide-react';
import { docHref } from './files';
import type { Budget } from './budget';
import { money, share, short, swatch } from './budget';
import { Numbers, Split, YearBars, type Slice, type YearBar } from './BudgetCharts';
import { CITIZENS_BUDGET_DOC, COMBINED_RATE, FOOD_RATE, RATE_AS_OF, RATE_GROUPS, RATE_PARTS, RATE_SOURCE, ratePct, rateTotal } from './salesTax';

const amountOf = (b: Budget, name: string) => b.revenue.find((l) => l.name === name)?.amount ?? 0;

export default function SalesTaxTab({ b }: { b: Budget }) {
  const sales = amountOf(b, 'Sales tax');
  const history = b.history.find((h) => h.key === 'sales');

  const rateSlices: Slice[] = RATE_GROUPS.map((g, slot) => {
    const parts = RATE_PARTS.filter((p) => p.group === g.key);
    return { key: g.key, slot, name: g.name, note: g.note, amount: rateTotal(parts), items: parts.map((p) => ({ name: p.name, amount: p.rate })) };
  });

  const taxLines: Array<[string, string, string]> = [
    ['property', 'Property tax', 'Property tax'],
    ['sales', 'Sales tax', 'Sales tax'],
    ['transport', 'Transportation tax', 'Transportation tax'],
    ['rap', 'RAP tax (recreation, arts and parks)', 'RAP tax'],
  ];
  const taxSlices: Slice[] = taxLines.map(([key, name, line], slot) => ({ key, slot, name, amount: amountOf(b, line), items: [] }));

  // FY23 to FY25 are actual; the budget year before this one and this one are budgets.
  const bars: YearBar[] = history
    ? b.historyYears.map((label, i) => ({ label, value: history.values[i], kind: 2000 + Number(label.slice(2)) <= b.fiscalYear - 2 ? 'actual' : 'budget' }))
    : [];
  const growth = bars.length > 1 && bars[0].value > 0 ? Math.round(((bars[bars.length - 1].value - bars[0].value) / bars[0].value) * 100) : null;
  const ofGeneral = Math.round((sales / b.general.revenueTotal) * 100);

  return (
    <>
      <div className="vc-bud-hero">
        <div data-k="spend">
          <span>Sales tax revenue</span>
          <b>{short(sales)}</b>
          <em>FY27 budget</em>
        </div>
        <div data-k="cut">
          <span>Sales tax rate</span>
          <b>{ratePct(COMBINED_RATE)}</b>
          <em>Vineyard</em>
        </div>
        <div data-k="left">
          <span>Share of revenue</span>
          <b>{ofGeneral}%</b>
          <em>General Fund</em>
        </div>
      </div>

      <p className="vc-bud-lede">
        Sales tax is the city&apos;s second-largest source of money after property tax: {short(sales)} budgeted for fiscal 2027.
      </p>

      <section className="vc-bud-sec">
        <h2>Sales tax rate</h2>
        <p className="vc-bud-lede">
          A purchase in Vineyard is taxed at {ratePct(COMBINED_RATE)}. The state&apos;s share is {ratePct(RATE_PARTS[0].rate)} and the city&apos;s local sales tax is {ratePct(1)}.
        </p>
        <div className="vc-bud-hero vc-bud-cuts">
          <div data-k="spend">
            <span>Local rate</span>
            <b>{ratePct(1)}</b>
            <em>City</em>
          </div>
          <div data-k="cut">
            <span>Food rate</span>
            <b>{ratePct(FOOD_RATE)}</b>
            <em>Food and ingredients</em>
          </div>
          <div data-k="left">
            <span>Restaurant tax</span>
            <b>{ratePct(1)}</b>
            <em>Added to the rate</em>
          </div>
        </div>
        <Split
          kind="donut"
          slices={rateSlices}
          noun="the rate"
          title="Rate by part"
          centerCaption="Rate"
          caption="Tap a color for details."
          format={ratePct}
          itemFormat={ratePct}
          digits={1}
        />
        <p className="vc-bud-fine">Rates in effect {RATE_AS_OF}. The budget does not split sales tax by type of business.</p>
      </section>

      <section className="vc-bud-sec">
        <h2>Local sales tax distribution</h2>
        <p className="vc-bud-lede">The State Tax Commission sends the local {ratePct(1)} to cities each month: half by where the sale happens, half by population.</p>
        <div className="vc-bud-half" style={swatch(1)} role="img" aria-label="Fifty percent point of sale, fifty percent population">
          <i data-k="sale">
            <b>50%</b>
            <span>Point of sale</span>
          </i>
          <i data-k="pool">
            <b>50%</b>
            <span>Population</span>
          </i>
        </div>
      </section>

      {bars.length > 0 && (
        <section className="vc-bud-sec">
          <h2>Sales tax by year</h2>
          <p className="vc-bud-lede">
            Actual through {bars.filter((x) => x.kind === 'actual').slice(-1)[0]?.label}, final budget for {bars.filter((x) => x.kind === 'budget')[0]?.label}, adopted budget for {bars.slice(-1)[0].label}.
            {growth != null && growth > 0 ? ` The ${bars.slice(-1)[0].label} budget is ${growth}% above ${bars[0].label}.` : ''}
          </p>
          <YearBars bars={bars} slot={1} title="Sales tax by fiscal year" actualWord="Actual" budgetWord="Budget" />
        </section>
      )}

      <section className="vc-bud-sec">
        <h2>General Fund taxes</h2>
        <p className="vc-bud-lede">
          The General Fund budget lists four taxes, {short(taxSlices.reduce((t, x) => t + x.amount, 0))} in all. Sales tax is {share(sales, taxSlices.reduce((t, x) => t + x.amount, 0))} of that. Franchise fees ({short(amountOf(b, 'Franchise fees'))}) are listed separately.
        </p>
        <Split kind="donut" slices={taxSlices} noun="tax money" title="Tax revenue by type" centerCaption="Total" caption="Tap a color for details." digits={1} />
      </section>

      <Numbers summary="See the rate as a table">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>Code</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody>
            {RATE_PARTS.map((p) => (
              <tr key={p.code}>
                <td>{p.name}</td>
                <td>{p.code}</td>
                <td>{ratePct(p.rate)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <b>Total in Vineyard</b>
              </td>
              <td />
              <td>
                <b>{ratePct(rateTotal())}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </Numbers>
      {bars.length > 0 && (
        <Numbers summary="See the years as a table">
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th>Sales tax</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((x) => (
                <tr key={x.label}>
                  <td>{x.label}</td>
                  <td>{money(x.value)}</td>
                  <td>{x.kind === 'actual' ? 'Collected' : 'Budget'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Numbers>
      )}
    </>
  );
}

/** Extra source links for this tab, shown in the page footer. */
export function SalesTaxSources() {
  return (
    <>
      <li>
        <a href={RATE_SOURCE.href} target="_blank" rel="noopener noreferrer">
          <FileText size={13} /> {RATE_SOURCE.label} <ArrowUpRight size={11} />
        </a>
      </li>
      <li>
        <Link to={docHref(CITIZENS_BUDGET_DOC)}>
          <FileText size={13} /> Citizens Budget, fiscal year 2024-2025 (PDF)
        </Link>
      </li>
    </>
  );
}
