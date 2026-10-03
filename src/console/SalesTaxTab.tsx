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
    return { key: g.key, slot, name: g.name, amount: rateTotal(parts), items: parts.map((p) => ({ name: p.name, amount: p.rate })) };
  });

  const taxLines: Array<[string, string, string]> = [
    ['property', 'Property tax', 'Property tax'],
    ['sales', 'Sales tax', 'Sales tax'],
    ['transport', 'Transportation tax', 'Transportation tax'],
    ['rap', 'RAP tax (recreation, arts and parks)', 'RAP tax'],
  ];
  const taxSlices: Slice[] = taxLines.map(([key, name, line], slot) => ({ key, slot, name, amount: amountOf(b, line), items: [] }));
  const taxTotal = taxSlices.reduce((t, s) => t + s.amount, 0);

  // FY23 to FY25 are actual; the budget year before this one and this one are budgets.
  const bars: YearBar[] = history
    ? b.historyYears.map((label, i) => ({ label, value: history.values[i], kind: 2000 + Number(label.slice(2)) <= b.fiscalYear - 2 ? 'actual' : 'budget' }))
    : [];
  const first = bars[0];
  const grew = first && first.value > 0 ? Math.round(((sales - first.value) / first.value) * 100) : null;
  const ofGeneral = Math.round((sales / b.general.revenueTotal) * 100);

  return (
    <>
      <div className="vc-bud-hero">
        <div data-k="spend">
          <span>Budgeted</span>
          <b>{short(sales)}</b>
          <em>sales tax, FY27</em>
        </div>
        <div data-k="cut">
          <span>Rate in Vineyard</span>
          <b>{ratePct(COMBINED_RATE)}</b>
          <em>on most purchases</em>
        </div>
        <div data-k="left">
          <span>Of General Fund</span>
          <b>{ofGeneral}%</b>
          <em>of its revenue</em>
        </div>
      </div>
      <p className="vc-bud-lede">
        Sales tax is the city&apos;s second-largest source of money, after property tax. The fiscal 2027 budget counts on {money(sales)} from it.
      </p>

      <section className="vc-bud-sec">
        <h2>What you pay at the register</h2>
        <p className="vc-bud-lede">
          A purchase in Vineyard is taxed at {ratePct(COMBINED_RATE)}. Most of it goes to the State of Utah. The city&apos;s own part is the {ratePct(1)} local sales tax.
        </p>
        <Split
          kind="donut"
          slices={rateSlices}
          noun="the rate"
          title="Where each part of the rate goes"
          centerCaption="at the register"
          caption="Tap a color to see what is inside."
          format={ratePct}
          itemFormat={ratePct}
          digits={1}
        />
        <p className="vc-bud-fine">
          Rates in effect {RATE_AS_OF}. Groceries (food and food ingredients) are taxed at a lower {ratePct(FOOD_RATE)} across Utah.
        </p>
      </section>

      <section className="vc-bud-sec">
        <h2>How the city&apos;s 1% is shared</h2>
        <p className="vc-bud-lede">The State Tax Commission collects the local sales tax and sends it back to cities. Half goes to the city where the sale happened. The other half goes into a statewide pool that is divided among Utah&apos;s cities by population.</p>
        <div className="vc-bud-half" style={swatch(1)} role="img" aria-label="Half of the local sales tax goes to the city where the sale happened, half is divided by population">
          <i data-k="sale">
            <b>50%</b>
            <span>Where the sale happens</span>
          </i>
          <i data-k="pool">
            <b>50%</b>
            <span>By population</span>
          </i>
        </div>
        <p className="vc-bud-fine">The city&apos;s own description, from its Citizens Budget.</p>
      </section>

      {bars.length > 0 && (
        <section className="vc-bud-sec">
          <h2>Sales tax by year</h2>
          <p className="vc-bud-lede">
            {grew != null && grew > 0 ? `The fiscal 2027 budget is ${grew}% above what the city collected in ${first.label}. ` : ''}
            Years through {bars.filter((x) => x.kind === 'actual').slice(-1)[0]?.label} are what the city actually collected; the rest are budgets.
          </p>
          <YearBars bars={bars} slot={1} title="Sales tax by fiscal year" actualWord="collected" budgetWord="budgeted" />
        </section>
      )}

      <section className="vc-bud-sec">
        <h2>Where the city&apos;s tax money comes from</h2>
        <p className="vc-bud-lede">
          The General Fund budget lists four taxes, {money(taxTotal)} in all. Sales tax is {share(sales, taxTotal)} of that.
        </p>
        <Split kind="donut" slices={taxSlices} noun="tax money" title="The four taxes in the General Fund" centerCaption="in taxes" caption="Tap a color to see its share." digits={1} />
        <p className="vc-bud-fine">Franchise fees ({short(amountOf(b, 'Franchise fees'))}) are listed apart from these taxes in the budget.</p>
      </section>

      <section className="vc-bud-sec">
        <h2>Groceries and restaurants</h2>
        <dl className="vc-bud-facts">
          <div>
            <dt>Groceries</dt>
            <dd>
              Food and food ingredients are taxed at {ratePct(FOOD_RATE)}, not {ratePct(COMBINED_RATE)}, across Utah.
            </dd>
          </div>
          <div>
            <dt>Restaurants</dt>
            <dd>A restaurant meal pays the full rate. Restaurants also collect a separate 1% restaurant tax on food and drink. It is a county tax collected with the sales tax, and Vineyard&apos;s budget has no line for it.</dd>
          </div>
          <div>
            <dt>By kind of business</dt>
            <dd>The adopted budget does not split sales tax by type of business, so restaurant and grocery sales are not shown on their own here.</dd>
          </div>
        </dl>
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
