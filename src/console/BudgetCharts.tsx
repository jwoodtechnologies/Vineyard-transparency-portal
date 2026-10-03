/**
 * Chart pieces for the Budget page: the "every $100" squares and the donut that share one list of rows, a bar chart
 * for a few years of one number, and the table wrapper. Colors are the page's seven fixed slots (--b1 to --b7).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { allocate100, money, share, short, swatch } from './budget';

export interface Slice {
  key: string;
  /** Which of the seven colors. Follows the thing, not its rank. */
  slot: number;
  name: string;
  amount: number;
  items: Array<{ name: string; amount: number }>;
  /** A sentence shown when the row is opened. */
  note?: string;
}

/* ---------- donut ---------- */

interface DonutProps {
  slices: Slice[];
  total: number;
  active: string | null;
  format: (n: number) => string;
  /** Under the total in the middle when nothing is picked. */
  caption: string;
  label: string;
  digits: 0 | 1;
  onHover: (key: string | null) => void;
  onPick: (key: string) => void;
}

const R = 76;
const STROKE = 30;
const GAP = 2.4;

export function Donut({ slices, total, active, format, caption, label, digits, onHover, onPick }: DonutProps) {
  const C = 2 * Math.PI * R;
  const arcs = useMemo(() => {
    const before = slices.reduce<number[]>((a, s) => [...a, (a.length ? a[a.length - 1] : 0) + s.amount], [0]);
    return slices.map((s, i) => {
      const f = total > 0 ? s.amount / total : 0;
      return { s, len: Math.max(f * C - GAP, 1), start: (total > 0 ? before[i] / total : 0) * C + GAP / 2 };
    });
  }, [slices, total, C]);
  const cur = slices.find((s) => s.key === active) ?? null;

  return (
    <div className="vc-bud-donut" role="group" aria-label={label} onPointerLeave={() => onHover(null)}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <g transform="rotate(-90 100 100)">
          {arcs.map(({ s, len, start }) => (
            <circle
              key={s.key}
              className="vc-bud-arc"
              cx="100"
              cy="100"
              r={R}
              fill="none"
              strokeWidth={STROKE}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-start}
              data-dim={active != null && active !== s.key}
              style={swatch(s.slot)}
              onPointerEnter={() => onHover(s.key)}
              onClick={() => onPick(s.key)}
            />
          ))}
        </g>
      </svg>
      <div className="vc-bud-donut-mid" aria-hidden="true">
        <b>{cur ? share(cur.amount, total, digits) : format(total)}</b>
        <span>{cur ? format(cur.amount) : caption}</span>
      </div>
    </div>
  );
}

/* ---------- squares and donut over one list ---------- */

interface SplitProps {
  slices: Slice[];
  /** "spending" in "Every $100 of spending". */
  noun: string;
  /** Under the chart when nothing is picked. */
  caption: string;
  /** squares: the $100 grid. donut: the ring. switch: both, with a toggle (squares first). */
  kind: 'squares' | 'donut' | 'switch';
  /** Heading above a donut. */
  title?: string;
  /** Under the total in the middle of the donut. */
  centerCaption?: string;
  /** How an amount reads: $4.7M by default. */
  format?: (n: number) => string;
  /** How a line inside a slice reads: $4,705,075 by default. */
  itemFormat?: (n: number) => string;
  digits?: 0 | 1;
}

export function Split({ slices, noun, caption, kind, title, centerCaption = 'total', format = short, itemFormat = money, digits = 0 }: SplitProps) {
  const [view, setView] = useState<'squares' | 'donut'>(kind === 'donut' ? 'donut' : 'squares');
  const mode = kind === 'switch' ? view : kind;
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  const ranked = useMemo(() => [...slices].sort((a, b) => b.amount - a.amount), [slices]);
  const total = ranked.reduce((s, x) => s + x.amount, 0);
  const counts = useMemo(() => allocate100(ranked.map((s) => s.amount)), [ranked]);
  const cells = useMemo(() => ranked.flatMap((s, i) => Array.from({ length: counts[i] }, () => s.key)), [ranked, counts]);
  const active = hov ?? sel;
  const cur = ranked.find((s) => s.key === active) ?? null;
  const curCount = cur ? counts[ranked.indexOf(cur)] : 0;
  const pick = (key: string) => setSel((c) => (c === key ? null : key));

  return (
    <div className="vc-bud-split">
      <div className="vc-bud-squares-wrap">
        <div className="vc-bud-chart-head">
          <h3 className="vc-bud-q">{mode === 'squares' ? `Every $100 of ${noun}` : (title ?? `Share of ${noun}`)}</h3>
          {kind === 'switch' && (
            <div className="vc-segment vc-bud-view" role="group" aria-label="Chart style">
              {(['squares', 'donut'] as const).map((v) => (
                <button key={v} type="button" data-on={view === v} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === 'squares' ? 'Squares' : 'Donut'}
                </button>
              ))}
            </div>
          )}
        </div>
        {mode === 'squares' ? (
          <div
            className="vc-bud-squares"
            aria-hidden="true"
            onPointerLeave={() => setHov(null)}
            onClick={(e) => {
              const key = (e.target as HTMLElement).dataset.key;
              if (key) pick(key);
            }}
          >
            {cells.map((key, i) => {
              const s = ranked.find((r) => r.key === key)!;
              return <i key={i} data-key={key} data-dim={active != null && active !== key} style={swatch(s.slot)} onPointerEnter={() => setHov(key)} />;
            })}
          </div>
        ) : (
          <Donut slices={ranked} total={total} active={active} format={format} caption={centerCaption} label={title ?? `Share of ${noun}`} digits={digits} onHover={setHov} onPick={pick} />
        )}
        <p className="vc-bud-readout" aria-live="polite">
          {cur ? (
            mode === 'squares' ? (
              <>
                <b>{cur.name}</b>: {curCount} of 100 squares, {format(cur.amount)} ({share(cur.amount, total)})
              </>
            ) : (
              <>
                <b>{cur.name}</b>: {format(cur.amount)} ({share(cur.amount, total, digits)})
              </>
            )
          ) : (
            <>{caption}</>
          )}
        </p>
      </div>

      <ul className="vc-bud-rows">
        {ranked.map((s, i) => {
          const open = sel === s.key;
          const listed = s.items.length > 1 || (s.items.length === 1 && s.items[0].name !== s.name);
          const has = listed || Boolean(s.note);
          return (
            <li key={s.key} data-open={open} data-dim={active != null && active !== s.key} onPointerEnter={() => setHov(s.key)} onPointerLeave={() => setHov(null)}>
              <button type="button" className="vc-bud-row" aria-expanded={has ? open : undefined} onClick={() => pick(s.key)}>
                <i className="vc-bud-sw" style={swatch(s.slot)} />
                <span className="vc-bud-row-name">{s.name}</span>
                <span className="vc-bud-row-n">{mode === 'squares' ? (counts[i] > 0 ? `$${counts[i]}` : '<$1') : share(s.amount, total, digits)}</span>
                <span className="vc-bud-row-amt">{format(s.amount)}</span>
                {has ? <ChevronDown size={15} strokeWidth={1.8} className="vc-bud-chev" /> : <span />}
              </button>
              {open && has && (
                <div className="vc-bud-more-in">
                  {s.note && <p>{s.note}</p>}
                  {listed && (
                    <ul className="vc-bud-items">
                      {[...s.items]
                        .sort((a, b) => b.amount - a.amount)
                        .map((it) => (
                          <li key={it.name}>
                            <span>{it.name}</span>
                            <span className="vc-bud-items-amt">{itemFormat(it.amount)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- a few years of one number ---------- */

export interface YearBar {
  label: string;
  value: number;
  kind: 'actual' | 'budget';
}

export function YearBars({ bars, slot, title, actualWord, budgetWord }: { bars: YearBar[]; slot: number; title: string; actualWord: string; budgetWord: string }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 1);
  const cur = sel != null ? bars[sel] : null;
  const before = sel != null && sel > 0 ? bars[sel - 1] : null;
  const change = cur && before ? ((cur.value - before.value) / before.value) * 100 : null;
  return (
    <div className="vc-bud-bars-wrap" style={swatch(slot)}>
      <div className="vc-bud-bars" role="group" aria-label={title}>
        {bars.map((b, i) => (
          <button
            key={b.label}
            type="button"
            className="vc-bud-bar-col"
            data-kind={b.kind}
            data-dim={sel != null && sel !== i}
            aria-pressed={sel === i}
            aria-label={`${b.label}: ${money(b.value)}, ${b.kind === 'actual' ? actualWord : budgetWord}`}
            onClick={() => setSel((c) => (c === i ? null : i))}
          >
            <span className="vc-bud-bar-track">
              <span className="vc-bud-bar-val">{short(b.value)}</span>
              <span className="vc-bud-bar-fill" style={{ height: `${(b.value / max) * 82}%` }} />
            </span>
            <span className="vc-bud-bar-lab">{b.label}</span>
          </button>
        ))}
      </div>
      <div className="vc-bud-key" aria-hidden="true">
        <span>
          <i data-kind="actual" /> {actualWord}
        </span>
        <span>
          <i data-kind="budget" /> {budgetWord}
        </span>
      </div>
      <p className="vc-bud-readout" aria-live="polite">
        {cur ? (
          <>
            <b>{cur.label}</b>: {money(cur.value)} {cur.kind === 'actual' ? actualWord : budgetWord}
            {change != null && Math.abs(change) >= 0.05 ? `, ${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}% from ${before!.label}` : ''}
          </>
        ) : (
          <>Tap a bar for the exact amount.</>
        )}
      </p>
    </div>
  );
}

/* ---------- table view ---------- */

export function Numbers({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="vc-bud-table">
      <summary>{summary}</summary>
      <div className="vc-bud-scroll">{children}</div>
    </details>
  );
}
