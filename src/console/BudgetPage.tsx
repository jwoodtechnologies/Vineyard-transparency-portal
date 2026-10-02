/**
 * /budget : the fiscal 2027 budget made readable. Four views:
 *   Spending       every $100 of General Fund spending as 100 squares, tap a color to open its departments
 *   Revenue        the same for revenue, with taxes shown apart from fees, grants and money moved between funds
 *   Projects       the funds paying for the capital projects the council listed, then every project
 *   Past budgets   every budget, audit and budget resolution in the archive, by fiscal year, with search
 * The numbers come from GET /api/budget, which is keyed in from the adopted budget book and slides.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, FileText } from 'lucide-react';
import { NEW_TAB, pdfHref } from './files';
import BudgetArchive from './BudgetArchive';
import { Frame } from './Chrome';
import { useJson } from './api';
import { allocate100, money, pct, short, treemap, type Budget, type BudgetLine, type Project } from './budget';

type Tab = 'spend' | 'revenue' | 'projects' | 'past';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'spend', label: 'Spending' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'projects', label: 'Projects' },
  { id: 'past', label: 'Past budgets' },
];

const swatch = (slot: number): CSSProperties => ({ '--c': `var(--b${(slot % 7) + 1})` }) as CSSProperties;

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

/* ---------- the "every $100" squares ---------- */

interface Slice {
  key: string;
  slot: number;
  name: string;
  amount: number;
  items: Array<{ name: string; amount: number }>;
}

function Squares({ slices, noun, caption }: { slices: Slice[]; noun: string; caption: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const ranked = useMemo(() => [...slices].sort((a, b) => b.amount - a.amount), [slices]);
  const total = ranked.reduce((s, x) => s + x.amount, 0);
  const counts = useMemo(() => allocate100(ranked.map((s) => s.amount)), [ranked]);
  const cells = useMemo(() => ranked.flatMap((s, i) => Array.from({ length: counts[i] }, () => s.key)), [ranked, counts]);
  const active = hov ?? sel;
  const cur = ranked.find((s) => s.key === active) ?? null;
  const curCount = cur ? counts[ranked.indexOf(cur)] : 0;

  return (
    <div className="vc-bud-split">
      <div className="vc-bud-squares-wrap">
        <h3 className="vc-bud-q">Every $100 of {noun}</h3>
        <div
          className="vc-bud-squares"
          aria-hidden="true"
          onPointerLeave={() => setHov(null)}
          onClick={(e) => {
            const key = (e.target as HTMLElement).dataset.key;
            if (key) setSel((c) => (c === key ? null : key));
          }}
        >
          {cells.map((key, i) => {
            const s = ranked.find((r) => r.key === key)!;
            return <i key={i} data-key={key} data-dim={active != null && active !== key} style={swatch(s.slot)} onPointerEnter={() => setHov(key)} />;
          })}
        </div>
        <p className="vc-bud-readout" aria-live="polite">
          {cur ? (
            <>
              <b>{cur.name}</b>: {curCount} of 100 squares, {short(cur.amount)} ({pct(cur.amount, total)})
            </>
          ) : (
            <>{caption}</>
          )}
        </p>
      </div>

      <ul className="vc-bud-rows">
        {ranked.map((s, i) => {
          const open = sel === s.key;
          return (
            <li key={s.key} data-open={open} data-dim={active != null && active !== s.key} onPointerEnter={() => setHov(s.key)} onPointerLeave={() => setHov(null)}>
              <button type="button" className="vc-bud-row" aria-expanded={open} onClick={() => setSel(open ? null : s.key)}>
                <i className="vc-bud-sw" style={swatch(s.slot)} />
                <span className="vc-bud-row-name">{s.name}</span>
                <span className="vc-bud-row-n">{counts[i] > 0 ? `$${counts[i]}` : '<$1'}</span>
                <span className="vc-bud-row-amt">{short(s.amount)}</span>
                <ChevronDown size={15} strokeWidth={1.8} className="vc-bud-chev" />
              </button>
              {open && (
                <ul className="vc-bud-items">
                  {[...s.items]
                    .sort((a, b) => b.amount - a.amount)
                    .map((it) => (
                      <li key={it.name}>
                        <span>{it.name}</span>
                        <span className="vc-bud-items-amt">{money(it.amount)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Numbers({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="vc-bud-table">
      <summary>{summary}</summary>
      <div className="vc-bud-scroll">{children}</div>
    </details>
  );
}

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
        };
      }),
    [b, all],
  );
  return (
    <>
      <Squares slices={slices} noun="spending" caption="Tap a color to see what is inside." />
      <Numbers summary="See every department as a table">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Budget</th>
              <th>Cut from last year</th>
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
    </>
  );
}

function RevenueTab({ b }: { b: Budget }) {
  const lines = useMemo(() => [...b.revenue, ...b.transfersIn], [b]);
  const slices: Slice[] = useMemo(
    () =>
      b.revenueGroups.map((g, slot) => {
        const items = lines.filter((l) => g.lines?.includes(l.name));
        return { key: g.key, slot, name: g.name, amount: items.reduce((s, l) => s + l.amount, 0), items: items.map((l) => ({ name: l.name, amount: l.amount })) };
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
      <Squares slices={slices} noun="revenue" caption="Tap a color to see what is inside." />
      <Numbers summary="See every revenue line as a table">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>FY2027</th>
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
    </>
  );
}

/* ---------- capital projects ---------- */

const FIRST = 12;

function ProjectsTab({ b }: { b: Budget }) {
  const narrow = useNarrow();
  const [fund, setFund] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
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

  return (
    <>
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
        {fund ? ` from ${nameOf(fund)}` : ` in all. General Fund share: ${money(general)} (${pct(general, allTotal, 0)})`}
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
              <a href={pdfHref(b.docs.slides, p.page)} {...NEW_TAB}>
                Budget slide {p.page} (PDF) <ArrowUpRight size={11} />
              </a>
            </div>
          </li>
        ))}
      </ul>
      {!showAll && !fund && shown.length > FIRST && (
        <button type="button" className="vc-chip vc-bud-more" onClick={() => setShowAll(true)}>
          Show all {shown.length} projects
        </button>
      )}
      <p className="vc-bud-fine">
        From the council&apos;s budget slides. <Link to="/map">See them on the map.</Link>
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
    document.title = 'Budget | Vineyard Transparency Portal';
  }, []);

  const b = load.status === 'done' ? load.data : null;
  const lastYear = useMemo(() => (b ? b.departments.filter((d) => d.prior > d.amended) : []), [b]);
  const cutDepts = lastYear.length;
  const cutTotal = lastYear.reduce((t, d) => t + (d.prior - d.amended), 0);

  return (
    <Frame wide>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Budget</h1>
        {tab !== 'past' && <p className="vc-page-sub">Fiscal year 2026-2027 (FY27) · July 1, 2026 to June 30, 2027</p>}
      </header>

      {load.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '92%' }} />
          <span style={{ width: '78%' }} />
          <span style={{ width: '85%' }} />
        </div>
      )}
      {load.status === 'error' && <div className="vc-empty">The budget could not be loaded right now. Try again in a moment.</div>}

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
              <p className="vc-bud-cap">General Fund only, with the amendment just passed on August 25. Revenue minus spending is the surplus.</p>
              <div className="vc-bud-hero vc-bud-cuts">
                <div data-k="cut">
                  <span>Cut by the amendment</span>
                  <b>{short(b.general.cutByAmendment)}</b>
                  <em>just passed</em>
                </div>
                <div data-k="cut">
                  <span>Cut since tentative</span>
                  <b>{short(b.general.tentativeTotal - b.general.amended.total)}</b>
                  <em>from {short(b.general.tentativeTotal)} in May</em>
                </div>
                <div data-k="cut">
                  <span>Cut from last year</span>
                  <b>{short(cutTotal)}</b>
                  <em>{cutDepts} departments</em>
                </div>
              </div>
              {b.newer.length > 0 && (
                <p className="vc-bud-cap">
                  Newer paper posted, not included yet:{' '}
                  <a href={pdfHref(b.newer[0].id)} {...NEW_TAB}>
                    {b.newer[0].title} (PDF)
                  </a>
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
          {tab === 'projects' && <ProjectsTab b={b} />}
          {tab === 'past' && <BudgetArchive />}

          {tab !== 'past' && (
            <footer className="vc-bud-sources">
              <h2>Sources</h2>
              <ul>
                <li>
                  <a href={pdfHref(b.docs.book)} {...NEW_TAB}>
                    <FileText size={13} /> FY 27 Final Budget (PDF)
                  </a>
                </li>
                <li>
                  <a href={pdfHref(b.docs.slides)} {...NEW_TAB}>
                    <FileText size={13} /> FY 27 Budget slides (PDF)
                  </a>
                </li>
                <li>
                  <a href={pdfHref(b.docs.tentative)} {...NEW_TAB}>
                    <FileText size={13} /> FY 27 Tentative Budget, May 2026 (PDF)
                  </a>
                </li>
                <li>
                  <a href={pdfHref(b.docs.amendment)} {...NEW_TAB}>
                    <FileText size={13} /> FY 27 First Budget Amendment, Aug 25 (PDF)
                  </a>
                </li>
                <li>
                  <Link to="/budget?view=past">Earlier years: past budgets</Link>
                </li>
              </ul>
              <p>Where the slides and the book differ, the book is used.</p>
            </footer>
          )}
        </div>
      )}
    </Frame>
  );
}
