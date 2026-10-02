/**
 * /budget : the fiscal 2027 budget made readable. Four views:
 *   Where it goes     every $100 of General Fund spending as 100 squares, tap a color to open its departments
 *   Where it comes from  the same for revenue
 *   Capital projects  a treemap of the funds paying for the projects the council listed, then every project
 *   Over time         five years of the biggest lines, and how each department moved from last year
 * The numbers come from GET /api/budget, which is keyed in from the adopted budget book and slides.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, FileText } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { allocate100, money, pct, short, signed, treemap, type Budget, type BudgetLine, type Project } from './budget';

type Tab = 'spend' | 'revenue' | 'projects' | 'time';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'spend', label: 'Spending' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'projects', label: 'Projects' },
  { id: 'time', label: 'Over time' },
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
  items: Array<{ name: string; amount: number; change: number | null }>;
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
        <h3 className="vc-bud-q">Of every $100 the General Fund {noun}</h3>
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
                        {it.change != null && it.change !== 0 && <span className="vc-bud-items-chg">{signed(it.change)} vs FY26</span>}
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
  const [view, setView] = useState<'amended' | 'adopted'>('amended');
  const all: BudgetLine[] = useMemo(() => [...b.departments, ...b.transfersOut], [b]);
  const slices: Slice[] = useMemo(
    () =>
      b.spendGroups.map((g, slot) => {
        const items = all.filter((l) => g.depts?.includes(l.name));
        const isTransfer = items.every((l) => l.prior === 0);
        return {
          key: g.key,
          slot,
          name: g.name,
          amount: items.reduce((s, l) => s + l[view], 0),
          items: items.map((l) => ({ name: l.name, amount: l[view], change: isTransfer ? null : l[view] - l.prior })),
        };
      }),
    [b, all, view],
  );
  const total = b.general[view].total;
  return (
    <>
      <div className="vc-bud-tools">
        <div className="vc-segment" role="tablist" aria-label="Which version of the budget">
          <button type="button" role="tab" aria-selected={view === 'amended'} data-on={view === 'amended'} onClick={() => setView('amended')}>
            After Aug 25
          </button>
          <button type="button" role="tab" aria-selected={view === 'adopted'} data-on={view === 'adopted'} onClick={() => setView('adopted')}>
            Adopted June 23
          </button>
        </div>
        <p className="vc-bud-total">
          General Fund spending, including money sent to other funds: <b>{money(total)}</b>
        </p>
      </div>
      <Squares slices={slices} noun="spends" caption="Tap a color or a row to see which departments are inside." />
      <Numbers summary="See every department as a table">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Adopted June 23</th>
              <th>After Aug 25</th>
              <th>FY26 final</th>
            </tr>
          </thead>
          <tbody>
            {all.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td>{money(l.adopted)}</td>
                <td>{money(l.amended)}</td>
                <td>{l.prior ? money(l.prior) : 'not a department'}</td>
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
        return { key: g.key, slot, name: g.name, amount: items.reduce((s, l) => s + l.amount, 0), items: items.map((l) => ({ name: l.name, amount: l.amount, change: null })) };
      }),
    [b, lines],
  );
  return (
    <>
      <div className="vc-bud-tools">
        <p className="vc-bud-total">
          General Fund money coming in, FY2027: <b>{money(b.general.revenueTotal)}</b>. The August 25 amendment did not change revenue.
        </p>
      </div>
      <Squares slices={slices} noun="takes in" caption="Tap a color or a row to see the individual sources." />
      <Numbers summary="See every revenue line as a table">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>FY2027 adopted</th>
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

function ProjectsTab({ b }: { b: Budget }) {
  const narrow = useNarrow();
  const [fund, setFund] = useState<string | null>(null);
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

  return (
    <>
      <p className="vc-bud-lede">
        The projects the council listed when it adopted the budget, grouped by the fund paying for each. Bigger tile, more money. Tap a tile to see just that fund&apos;s projects.
      </p>
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
        {fund ? ` from ${nameOf(fund)}` : ' in all'}
      </p>
      <ul className="vc-bud-projects">
        {shown.map((p) => (
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
              <Link to={`/documents/${encodeURIComponent(b.docs.slides)}?page=${p.page}`}>
                Budget slide {p.page} <ArrowUpRight size={11} />
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <p className="vc-bud-fine">
        Amounts are the figures printed on the council&apos;s budget slides. Some projects are paid in part by grants, and a few carry over from earlier years.{' '}
        <Link to="/map">See the ones with a location on the map.</Link>
      </p>
    </>
  );
}

/* ---------- over time ---------- */

function kindOf(i: number): string {
  return i < 3 ? 'actual' : i === 3 ? 'final budget' : 'adopted budget';
}

function Multiple({ s, years, slot }: { s: Budget['history'][number]; years: string[]; slot: number }) {
  const [hov, setHov] = useState<number | null>(null);
  const i = hov ?? s.values.length - 1;
  const max = Math.max(...s.values);
  const first = s.values[0];
  const last = s.values[s.values.length - 1];
  return (
    <figure className="vc-bud-multi" style={swatch(slot)}>
      <figcaption>
        <span>{s.name}</span>
        <small>{s.kind === 'revenue' ? 'money in' : 'money spent'}</small>
      </figcaption>
      <div className="vc-bud-cols" onPointerLeave={() => setHov(null)}>
        {s.values.map((v, k) => (
          <button
            key={years[k]}
            type="button"
            className="vc-bud-col"
            data-plan={k >= 3}
            data-on={i === k}
            aria-label={`${s.name}, ${years[k]} ${kindOf(k)}: ${money(v)}`}
            onPointerEnter={() => setHov(k)}
            onFocus={() => setHov(k)}
            onBlur={() => setHov(null)}
            onClick={() => setHov(k)}
          >
            <span className="vc-bud-colbar" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
            <small>{years[k].replace('FY', '')}</small>
          </button>
        ))}
      </div>
      <p className="vc-bud-readout" aria-live="polite">
        <b>{years[i]}</b> {kindOf(i)}: {money(s.values[i])}
      </p>
      <p className="vc-bud-delta">
        {pct(last - first, first, 0).replace(/^/, last >= first ? '+' : '')} since {years[0]}
      </p>
    </figure>
  );
}

function TimeTab({ b }: { b: Budget }) {
  const rows = useMemo(
    () =>
      b.departments
        .map((d) => ({ name: d.name, delta: d.amended - d.prior, prior: d.prior }))
        .sort((a, c) => c.delta - a.delta),
    [b],
  );
  const span = Math.max(...rows.map((r) => Math.abs(r.delta)));
  return (
    <>
      <p className="vc-bud-lede">
        Five years of the biggest lines in the General Fund. FY23 to FY25 are what actually happened. The striped bars are budgets: the FY26 final budget and the FY27 adopted budget.
      </p>
      <div className="vc-bud-multis">
        {b.history.map((s, i) => (
          <Multiple key={s.key} s={s} years={b.historyYears} slot={i} />
        ))}
      </div>
      <Numbers summary="See the five years as a table">
        <table>
          <thead>
            <tr>
              <th>Line</th>
              {b.historyYears.map((y, i) => (
                <th key={y}>
                  {y} {kindOf(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.history.map((s) => (
              <tr key={s.key}>
                <td>{s.name}</td>
                {s.values.map((v, i) => (
                  <td key={i}>{money(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Numbers>

      <h3 className="vc-bud-q vc-bud-q2">How each department moved from last year</h3>
      <p className="vc-bud-lede">FY27 budget after the August 25 amendment, compared with the FY26 final budget.</p>
      <div className="vc-bud-legend" aria-hidden="true">
        <span>
          <i className="vc-bud-sw" style={swatch(0)} /> Higher than FY26
        </span>
        <span>
          <i className="vc-bud-sw" style={swatch(1)} /> Lower than FY26
        </span>
      </div>
      <ul className="vc-bud-moves">
        {rows.map((r) => (
          <li key={r.name}>
            <span className="vc-bud-move-name">{r.name}</span>
            <span className="vc-bud-move-track" aria-hidden="true">
              <i data-dir={r.delta >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(r.delta) / span) * 50}%`, ...swatch(r.delta >= 0 ? 0 : 1) }} />
            </span>
            <span className="vc-bud-move-n">
              {signed(r.delta)}
              <small>{r.prior ? ` ${r.delta >= 0 ? '+' : ''}${pct(r.delta, r.prior, 0)}` : ''}</small>
            </span>
          </li>
        ))}
      </ul>
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
  const cuts = useMemo(
    () => (b ? [...b.departments].map((d) => ({ name: d.name, cut: d.adopted - d.amended })).filter((d) => d.cut > 0).sort((a, c) => c.cut - a.cut).slice(0, 2) : []),
    [b],
  );

  return (
    <Frame wide>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Budget</h1>
        <p className="vc-page-sub">{b ? `${b.label}. Adopted by the City Council on June 23, 2026 and amended on August 25.` : 'Fiscal year 2027, July 1, 2026 to June 30, 2027.'}</p>
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
          <div className="vc-bud-hero">
            <div>
              <b>{short(b.allFundsTotal)}</b>
              <span>across all nine city funds</span>
            </div>
            <div>
              <b>{short(b.general.amended.total)}</b>
              <span>General Fund: everyday city government</span>
            </div>
            <div>
              <b>{short(b.projectsTotal)}</b>
              <span>in {b.projects.length} capital projects listed in the budget</span>
            </div>
          </div>

          <aside className="vc-bud-note">
            <p>
              <b>Amended August 25.</b> The council trimmed General Fund spending by {money(b.general.cutByAmendment)}
              {cuts.length > 0 && <>. The biggest changes: {cuts.map((c) => `${c.name} (-${money(c.cut)})`).join(' and ')}</>}. Revenue over spending grew from {money(b.general.adopted.surplus)} to {money(b.general.amended.surplus)}.{' '}
              <Link to={`/documents/${encodeURIComponent(b.docs.amendment)}`}>
                Read the amendment <ArrowUpRight size={11} />
              </Link>
            </p>
            {b.newer.length > 0 && (
              <p>
                <b>Newer budget paper posted.</b> {b.newer[0].title}
                {b.newer[0].date ? ` (${b.newer[0].date})` : ''} was added after the figures here were entered, so it is not reflected yet.{' '}
                <Link to={`/documents/${encodeURIComponent(b.newer[0].id)}`}>
                  Open it <ArrowUpRight size={11} />
                </Link>
              </p>
            )}
          </aside>

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
          {tab === 'time' && <TimeTab b={b} />}

          <footer className="vc-bud-sources">
            <h2>Where these numbers come from</h2>
            <ul>
              <li>
                <Link to={`/documents/${encodeURIComponent(b.docs.book)}`}>
                  <FileText size={13} /> FY 27 Final Budget (adopted June 23, 2026)
                </Link>
              </li>
              <li>
                <Link to={`/documents/${encodeURIComponent(b.docs.slides)}`}>
                  <FileText size={13} /> FY 27 Final Budget slides, with the capital project lists
                </Link>
              </li>
              <li>
                <Link to={`/documents/${encodeURIComponent(b.docs.amendment)}`}>
                  <FileText size={13} /> FY 27 First Budget Amendment (August 25, 2026)
                </Link>
              </li>
            </ul>
            <p>
              {b.notes.join(' ')} Totals can differ from the budget book by a few dollars because the book rounds each line.
            </p>
          </footer>
        </div>
      )}
    </Frame>
  );
}
