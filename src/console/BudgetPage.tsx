/**
 * /budget : the city's current budget made readable. Five views:
 *   Spending       every $100 of General Fund spending as 100 squares or a donut, tap a color to open its departments;
 *                  then each fund's own budget as a table (never summed into an all-funds total)
 *   Revenue        the same for revenue, with taxes shown apart from fees, grants and money moved between funds
 *   Sales tax      what the city budgets from sales tax, the rate in Vineyard and where each part goes, by year
 *   Projects       the funds paying for the capital projects the council listed, then every project
 *   Past budgets   every budget, audit and budget resolution in the archive, by fiscal year, with search
 * The numbers come from GET /api/budget, which is keyed in from the adopted budget book and slides.
 */
import './styles';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, FileText } from 'lucide-react';
import { docHref } from './files';
import BudgetArchive from './BudgetArchive';
import { Donut, Numbers, Split, type Slice } from './BudgetCharts';
import SalesTaxTab, { SalesTaxSources } from './SalesTaxTab';
import { Frame } from './Chrome';
import { useJson } from './api';
import { CsvButton } from './CsvButton';
import { csvName } from './csv';
import { ProjectDetail } from './ProjectDetail';
import { fyShort, fySpan, isAmended, money, pct, short, swatch, treemap, type Budget, type BudgetLine, type Project } from './budget';
import { formatDate } from '@/lib/dates';
import { setHead } from '@/lib/head';
import { ErrorNote } from './ErrorNote';

/** "2026-08-25" as "Aug 25, 2026". */
const longDay = (iso: string) => formatDate(iso);

type Tab = 'spend' | 'revenue' | 'sales' | 'projects' | 'past';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'spend', label: 'Spending' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'sales', label: 'Sales tax' },
  { id: 'projects', label: 'Projects' },
  { id: 'past', label: 'Past budgets' },
];

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/* ---------- each fund ---------- */

/** Each fund's own budget, as the budget book lists it. Never added together into one total (owner rule). */
function FundList({ b }: { b: Budget }) {
  return (
    <Numbers summary="See each fund's budget">
      <table>
        <thead>
          <tr>
            <th>Fund</th>
            <th>FY{b.fiscalYear}</th>
          </tr>
        </thead>
        <tbody>
          {b.funds.map((f) => (
            <tr key={f.key}>
              <td>{f.name}</td>
              <td>{money(f.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vc-bud-fine">Budgeted revenue with prior-year fund balance. {fyShort(b)} budget book.</p>
    </Numbers>
  );
}

/* What each group is, in plain words (descriptions follow the city's own Citizens Budget). Keyed by the group keys in /api/budget. */
const SPEND_NOTES: Record<string, string> = {
  safety: 'Keeping residents safe: the Police and Fire departments.',
  transfers: 'Money the General Fund sends to the Transportation, Capital Projects, Internal Service and Stormwater funds.',
  streets: 'Managing infrastructure: streets, public works, engineering and sanitation (trash) service.',
  parks: 'Recreation and outdoor opportunities: parks, recreation programs and city events.',
  admin: 'Governance and customer service: elected officials, city manager, recorder, finance and communications.',
  planning: 'Planning and building: development review, permits and inspections.',
  library: 'The Vineyard library.',
};
const REVENUE_NOTES: Record<string, string> = {
  property: 'Property tax paid by owners of homes and businesses in Vineyard.',
  sales: 'The local sales tax, the transportation tax and the RAP (recreation, arts and parks) tax.',
  transfers: 'Money moved in from the Redevelopment Agency and the Capital Projects Fund.',
  fees: 'Fees collected for building permits, plan reviews, inspections and business licenses.',
  fines: 'Sanitation (trash) charges and fines.',
  state: 'Money from other governments: grants and Class B and C road funds.',
  other: 'Franchise fees, interest earnings, recreation fees, rents, donations and smaller items.',
};

function SpendTab({ b }: { b: Budget }) {
  const all: BudgetLine[] = useMemo(() => [...b.departments, ...b.transfersOut], [b]);
  const slices: Slice[] = useMemo(
    () =>
      b.spendGroups.map((g, slot) => {
        const items = all.filter((l) => g.depts?.includes(l.name));
        return {
          key: g.key,
          slot,
          name: g.name,
          amount: items.reduce((s, l) => s + l.amended, 0),
          items: items.map((l) => ({ name: l.name, amount: l.amended })),
          note: SPEND_NOTES[g.key],
        };
      }),
    [b, all],
  );
  return (
    <>
      <Split kind="switch" slices={slices} noun="spending" title="General Fund spending" centerCaption="General Fund" caption="Tap a color to see what is inside." />
      <Numbers summary="See every department as a table">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Budget</th>
              <th>Cut from fiscal 2026</th>
            </tr>
          </thead>
          <tbody>
            {all.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td>{money(l.amended)}</td>
                <td>{l.prior > l.amended ? money(l.prior - l.amended) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Numbers>
      <div className="vc-csv-row">
        <CsvButton
          filename={csvName('vineyard', 'budget', 'departments', `fy${b.fiscalYear}`)}
          rows={() => [['Department', 'Adopted', 'Amended', 'Prior year'], ...all.map((l) => [l.name, l.adopted, l.amended, l.prior])]}
        />
      </div>
      <FundList b={b} />
    </>
  );
}

function RevenueTab({ b }: { b: Budget }) {
  const lines = useMemo(() => [...b.revenue, ...b.transfersIn], [b]);
  const slices: Slice[] = useMemo(
    () =>
      b.revenueGroups.map((g, slot) => {
        const items = lines.filter((l) => g.lines?.includes(l.name));
        return { key: g.key, slot, name: g.name, amount: items.reduce((s, l) => s + l.amount, 0), items: items.map((l) => ({ name: l.name, amount: l.amount })), note: REVENUE_NOTES[g.key] };
      }),
    [b, lines],
  );
  const taxes = slices.filter((s) => s.key === 'property' || s.key === 'sales').reduce((t, s) => t + s.amount, 0);
  const share = Math.round((taxes / b.general.revenueTotal) * 100);
  return (
    <>
      <div className="vc-bud-tools">
        <p className="vc-bud-total">
          Taxes are <b>{share} of every $100</b> ({short(taxes)})
        </p>
      </div>
      <Split kind="switch" slices={slices} noun="revenue" title="General Fund revenue" centerCaption="General Fund" caption="Tap a color to see what is inside." />
      <Numbers summary="See every revenue line as a table">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>FY{b.fiscalYear}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td>{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Numbers>
      <div className="vc-csv-row">
        <CsvButton filename={csvName('vineyard', 'budget', 'revenue', `fy${b.fiscalYear}`)} rows={() => [['Source', `FY${b.fiscalYear}`], ...lines.map((l) => [l.name, l.amount])]} />
      </div>
    </>
  );
}

/* ---------- capital projects ---------- */

const FIRST = 12;

function ProjectsTab({ b }: { b: Budget }) {
  const narrow = useNarrow();
  const [fund, setFund] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const W = 100;
  const H = narrow ? 100 : 46;
  const totals = useMemo(() => {
    const m = new Map<string, { total: number; count: number }>();
    for (const p of b.projects) {
      const c = m.get(p.fund) ?? { total: 0, count: 0 };
      c.total += p.amount;
      c.count += 1;
      m.set(p.fund, c);
    }
    return m;
  }, [b]);
  const slot = (key: string) => Math.max(0, b.projectFunds.findIndex((f) => f.key === key));
  const nameOf = (key: string) => b.projectFunds.find((f) => f.key === key)?.name ?? key;
  const tiles = useMemo(() => treemap(b.projectFunds.map((f) => ({ key: f.key, value: totals.get(f.key)?.total ?? 0 })), W, H), [b, totals, H]);
  const shown: Project[] = useMemo(() => [...b.projects].filter((p) => !fund || p.fund === fund).sort((a, c) => c.amount - a.amount), [b, fund]);
  const max = shown[0]?.amount ?? 1;
  const shownTotal = shown.reduce((s, p) => s + p.amount, 0);
  const allTotal = b.projects.reduce((t, p) => t + p.amount, 0);
  const general = totals.get('general')?.total ?? 0;
  const ring: Slice[] = useMemo(
    () => b.projectFunds.map((f, slot) => ({ key: f.key, slot, name: f.name, amount: totals.get(f.key)?.total ?? 0, items: [] })).filter((x) => x.amount > 0),
    [b, totals],
  );

  return (
    <>
      {narrow && (
        <div className="vc-bud-ring">
          <Donut
            slices={ring}
            total={allTotal}
            active={fund}
            format={short}
            caption="in projects"
            label="Capital project money by fund. Tap a color to list that fund's projects."
            digits={0}
            onHover={() => undefined}
            onPick={(k) => setFund((c) => (c === k ? null : k))}
          />
        </div>
      )}
      {!narrow && (
      <div className="vc-bud-tree" style={{ aspectRatio: `${W} / ${H}` }} role="group" aria-label="Capital project money by fund">
        {tiles.map((t) => {
          const f = totals.get(t.key)!;
          const wp = (t.w / W) * 100;
          const hp = (t.h / H) * 100;
          const label = wp >= (narrow ? 30 : 17) && hp >= (narrow ? 14 : 22);
          const amt = !label && wp >= (narrow ? 20 : 11) && hp >= (narrow ? 9 : 14);
          return (
            <button
              key={t.key}
              type="button"
              className="vc-bud-tile"
              data-on={fund === t.key}
              data-dim={fund != null && fund !== t.key}
              style={{ ...swatch(slot(t.key)), left: `${(t.x / W) * 100}%`, top: `${(t.y / H) * 100}%`, width: `${wp}%`, height: `${hp}%` }}
              aria-pressed={fund === t.key}
              aria-label={`${nameOf(t.key)}: ${money(f.total)} across ${f.count} projects`}
              title={`${nameOf(t.key)}: ${money(f.total)}, ${f.count} projects`}
              onClick={() => setFund((c) => (c === t.key ? null : t.key))}
            >
              <span className="vc-bud-tile-in">
                {(label || amt) && <b>{label ? nameOf(t.key) : short(f.total)}</b>}
                {label && <span>{short(f.total)}</span>}
              </span>
            </button>
          );
        })}
      </div>
      )}

      <div className="vc-bud-chips" role="group" aria-label="Filter by fund">
        <button type="button" className="vc-chip" data-active={fund == null} onClick={() => setFund(null)}>
          All funds
        </button>
        {b.projectFunds.map((f, i) => (
          <button key={f.key} type="button" className="vc-chip" data-active={fund === f.key} onClick={() => setFund((c) => (c === f.key ? null : f.key))}>
            <i className="vc-bud-sw" style={swatch(i)} />
            {f.name}
            <span className="vc-bud-chip-n">{short(totals.get(f.key)?.total ?? 0)}</span>
          </button>
        ))}
      </div>

      <p className="vc-bud-total">
        {shown.length} {shown.length === 1 ? 'project' : 'projects'}, <b>{money(shownTotal)}</b>
        {fund ? ` from ${nameOf(fund)}` : ` in the adopted budget. General Fund share: ${money(general)} (${pct(general, allTotal, 0)})`}
      </p>
      <ul className="vc-bud-projects">
        {(showAll || fund ? shown : shown.slice(0, FIRST)).map((p) => (
          <li key={`${p.fund}-${p.name}`}>
            <div className="vc-bud-proj-top">
              <i className="vc-bud-sw" style={swatch(slot(p.fund))} />
              <span className="vc-bud-proj-name">{p.name}</span>
              <b>{money(p.amount)}</b>
            </div>
            <div className="vc-bud-bar" style={swatch(slot(p.fund))}>
              <i style={{ width: `${Math.max(1.5, (p.amount / max) * 100)}%` }} />
            </div>
            <div className="vc-bud-proj-meta">
              {nameOf(p.fund).startsWith(p.dept) || p.dept.startsWith(nameOf(p.fund)) ? nameOf(p.fund) : `${nameOf(p.fund)}, ${p.dept}`}
              <Link to={docHref(b.docs.slides, p.page)}>
                Budget slide {p.page} (PDF) <ArrowUpRight size={11} />
              </Link>
              <button type="button" className="vc-bud-proj-more" aria-expanded={open.has(`${p.fund}|${p.name}`)} onClick={() => toggle(`${p.fund}|${p.name}`)}>
                {open.has(`${p.fund}|${p.name}`) ? 'Hide votes and records' : 'Votes and records'}
              </button>
            </div>
            {open.has(`${p.fund}|${p.name}`) && <ProjectDetail project={{ fund: p.fund, name: p.name }} budget="none" />}
          </li>
        ))}
      </ul>
      {!showAll && !fund && shown.length > FIRST && (
        <button type="button" className="vc-chip vc-bud-more" onClick={() => setShowAll(true)}>
          Show all {shown.length} projects
        </button>
      )}
      <div className="vc-csv-row">
        <CsvButton
          filename={csvName('vineyard', 'budget', 'projects', `fy${b.fiscalYear}`)}
          rows={() => [['Project', 'Fund', 'Department', 'Amount', 'Budget slide page'], ...[...b.projects].sort((a, c) => c.amount - a.amount).map((p) => [p.name, nameOf(p.fund), p.dept, p.amount, p.page])]}
        />
      </div>
      <p className="vc-bud-fine">
        From the council&apos;s budget slides. <Link to="/map?layers=projects#projects">On the map</Link>
      </p>
    </>
  );
}

/* ---------- page ---------- */

export default function BudgetPage() {
  const load = useJson<Budget>('/api/budget');
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : 'spend';

  useEffect(() => {
    setHead('Budget');
  }, []);

  const b = load.status === 'done' ? load.data : null;
  const lastYear = useMemo(() => (b ? b.departments.filter((d) => d.prior > d.amended) : []), [b]);
  const cutDepts = lastYear.length;
  const cutTotal = lastYear.reduce((t, d) => t + (d.prior - d.amended), 0);
  // The cut cards that apply to this budget: the amendment's, the one since the tentative budget, and the one from last year.
  const cuts: Array<{ label: string; value: string; note: string }> = [];
  if (b) {
    if (isAmended(b) && b.general.cutByAmendment > 0) cuts.push({ label: 'Cut by the amendment', value: short(b.general.cutByAmendment), note: [b.amendmentOrdinance, longDay(b.amended)].filter(Boolean).join(', ') });
    if (b.general.tentativeTotal > b.general.amended.total) {
      cuts.push({
        label: 'Cut since tentative',
        value: short(b.general.tentativeTotal - b.general.amended.total),
        note: `from ${short(b.general.tentativeTotal)}${b.tentativeDate ? ` on ${longDay(b.tentativeDate)}` : ''}`,
      });
    }
    if (cutDepts > 0) cuts.push({ label: `Cut from fiscal ${b.fiscalYear - 1}`, value: short(cutTotal), note: `${cutDepts} department${cutDepts === 1 ? '' : 's'}` });
  }

  return (
    <Frame wide>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Budget</h1>
        {tab !== 'past' && b && (
          <p className="vc-page-sub">
            FY {b.fiscalYear} · July 1, {b.fiscalYear - 1} to June 30, {b.fiscalYear}
          </p>
        )}
        {tab !== 'past' && b?.adoptionOrdinance && (
          <p className="vc-page-sub">
            Adopted {longDay(b.adopted)} by{' '}
            {b.adoptionOrdinanceDoc ? <Link to={docHref(b.adoptionOrdinanceDoc)}>{b.adoptionOrdinance}</Link> : b.adoptionOrdinance}
            {b.adoptionBudgetDoc && (
              <>
                {' · '}
                <Link to={docHref(b.adoptionBudgetDoc.id)}>Budget document</Link>
              </>
            )}
          </p>
        )}
      </header>

      {load.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '92%' }} />
          <span style={{ width: '78%' }} />
          <span style={{ width: '85%' }} />
        </div>
      )}
      {load.status === 'error' && <ErrorNote>The budget could not be loaded.</ErrorNote>}

      {b && (
        <div className="vc-bud">
          {tab !== 'past' && (
            <>
              <div className="vc-bud-hero">
                <div data-k="rev">
                  <span>Revenue</span>
                  <b>{short(b.general.revenueTotal)}</b>
                </div>
                <div data-k="spend">
                  <span>Spending</span>
                  <b>{short(b.general.amended.total)}</b>
                </div>
                <div data-k="left">
                  <span>Surplus</span>
                  <b>{short(b.general.amended.surplus)}</b>
                </div>
              </div>
              <div className="vc-bud-flow" role="img" aria-label={`Of ${money(b.general.revenueTotal)} in revenue, ${money(b.general.amended.total)} is spent and ${money(b.general.amended.surplus)} is left over`}>
                <i data-k="spend" style={{ flexGrow: b.general.amended.total }} />
                <i data-k="left" style={{ flexGrow: Math.max(b.general.amended.surplus, b.general.revenueTotal * 0.015) }} />
              </div>
              <p className="vc-bud-cap">
                {isAmended(b) ? (
                  <>
                    General Fund, as amended {longDay(b.amended)}
                    {b.amendmentOrdinance ? ` by ${b.amendmentOrdinance}` : ''}.
                  </>
                ) : (
                  <>General Fund, as adopted {longDay(b.adopted)}.</>
                )}
              </p>
              {cuts.length > 0 && (
                <div className="vc-bud-hero vc-bud-cuts" style={{ gridTemplateColumns: `repeat(${cuts.length}, minmax(0, 1fr))` }}>
                  {cuts.map((c) => (
                    <div key={c.label} data-k="cut">
                      <span>{c.label}</span>
                      <b>{c.value}</b>
                      <em>{c.note}</em>
                    </div>
                  ))}
                </div>
              )}
              {b.newer.length > 0 && (
                <p className="vc-bud-cap">
                  Newer paper posted, not included yet:{' '}
                  <Link to={docHref(b.newer[0].id)}>
                    {b.newer[0].title} (PDF)
                  </Link>
                </p>
              )}
            </>
          )}

          <div className="vc-segment vc-bud-tabs" role="tablist" aria-label="Budget views">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-on={tab === t.id} onClick={() => setParams(t.id === 'spend' ? {} : { view: t.id }, { replace: true })}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'spend' && <SpendTab b={b} />}
          {tab === 'revenue' && <RevenueTab b={b} />}
          {tab === 'sales' && <SalesTaxTab b={b} />}
          {tab === 'projects' && <ProjectsTab b={b} />}
          {tab === 'past' && <BudgetArchive />}

          {tab !== 'past' && (
            <footer className="vc-bud-sources">
              <h2>Sources</h2>
              <ul>
                {tab === 'sales' && <SalesTaxSources />}
                <li>
                  <Link to={docHref(b.docs.book)}>
                    <FileText size={13} /> {fyShort(b)} Final Budget (PDF)
                  </Link>
                </li>
                {b.adoptionOrdinance && b.adoptionOrdinanceDoc && (
                  <li>
                    <Link to={docHref(b.adoptionOrdinanceDoc)}>
                      <FileText size={13} /> {b.adoptionOrdinance}, Final Budget for {fySpan(b)} (PDF)
                    </Link>
                  </li>
                )}
                <li>
                  <Link to={docHref(b.docs.slides)}>
                    <FileText size={13} /> {fyShort(b)} Budget slides (PDF)
                  </Link>
                </li>
                {b.docs.tentative && (
                  <li>
                    <Link to={docHref(b.docs.tentative)}>
                      <FileText size={13} /> {fyShort(b)} Tentative Budget{b.tentativeDate ? `, ${longDay(b.tentativeDate)}` : ''} (PDF)
                    </Link>
                  </li>
                )}
                {b.docs.amendment && isAmended(b) && (
                  <li>
                    <Link to={docHref(b.docs.amendment)}>
                      <FileText size={13} /> {fyShort(b)} {b.amendmentName ?? 'Budget Amendment'}, {longDay(b.amended)} (PDF)
                    </Link>
                  </li>
                )}
                <li>
                  <Link to="/budget?view=past">Earlier years: past budgets</Link>
                </li>
              </ul>
            </footer>
          )}
        </div>
      )}
    </Frame>
  );
}
