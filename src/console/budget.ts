/** Budget page helpers: types for GET /api/budget, money formatting, the "per $100" split, the treemap layout and fiscal-year labels for past budgets. */
import type { DocumentSummary } from '@/types/models';

export interface BudgetFund {
  key: string;
  name: string;
  about: string;
  total: number;
}
export interface BudgetLine {
  name: string;
  adopted: number;
  amended: number;
  prior: number;
}
export interface Group {
  key: string;
  name: string;
  depts?: string[];
  lines?: string[];
}
export interface RevenueLine {
  name: string;
  amount: number;
}
export interface Project {
  name: string;
  fund: string;
  dept: string;
  amount: number;
  page: number;
}
export interface Budget {
  fiscalYear: number;
  label: string;
  adopted: string;
  amended: string;
  docs: { book: string; slides: string; amendment: string; amendmentSummary: string; tentative: string };
  allFundsTotal: number;
  funds: BudgetFund[];
  general: {
    revenueBeforeTransfers: number;
    transfersIn: number;
    revenueTotal: number;
    adopted: { departments: number; transfersOut: number; total: number; surplus: number };
    amended: { departments: number; transfersOut: number; total: number; surplus: number };
    cutByAmendment: number;
    tentativeTotal: number;
  };
  departments: BudgetLine[];
  transfersOut: BudgetLine[];
  spendGroups: Group[];
  revenue: RevenueLine[];
  transfersIn: RevenueLine[];
  revenueGroups: Group[];
  historyYears: string[];
  history: Array<{ key: string; name: string; kind: 'revenue' | 'spending'; values: number[] }>;
  projectFunds: Array<{ key: string; name: string }>;
  projects: Project[];
  projectsTotal: number;
  notes: string[];
  newer: Array<{ id: string; title: string; date: string | null }>;
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** $4,705,075 */
export function money(n: number): string {
  return USD.format(Math.round(n));
}

/** $4.7M, $529K, $500 */
export function short(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}K`;
  if (a >= 1_000) return `${sign}$${(a / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}

/** "+$602K" or "-$44K". */
export function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${short(Math.abs(n))}`;
}

export function pct(part: number, whole: number, digits = 1): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(digits)}%` : '0%';
}

/**
 * Splits 100 squares across values in proportion (largest remainder), so the squares always
 * add to exactly 100 and a small share still gets one square.
 */
export function allocate100(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const cells = exact.map(Math.floor);
  let left = 100 - cells.reduce((s, c) => s + c, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0 && k < order.length; k++, left--) cells[order[k].i] += 1;
  return cells;
}

export interface Tile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap: tiles fill W by H, each with area proportional to its value. */
export function treemap(items: Array<{ key: string; value: number }>, W: number, H: number): Tile[] {
  const live = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = live.reduce((s, i) => s + i.value, 0);
  if (!live.length || total <= 0) return [];
  const k = (W * H) / total;
  const nodes = live.map((i) => ({ key: i.key, area: i.value * k }));
  const out: Tile[] = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  let row: typeof nodes = [];
  const sum = (r: typeof nodes) => r.reduce((s, n) => s + n.area, 0);
  const worst = (r: typeof nodes, side: number) => {
    const s = sum(r);
    const max = Math.max(...r.map((n) => n.area));
    const min = Math.min(...r.map((n) => n.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const place = (r: typeof nodes) => {
    const s = sum(r);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const n of r) {
        const rh = n.area / cw;
        out.push({ key: n.key, x, y: cy, w: cw, h: rh });
        cy += rh;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const n of r) {
        const rw = n.area / rh;
        out.push({ key: n.key, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
  };
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(w, h);
    const next = [...row, nodes[i]];
    if (row.length === 0 || worst(next, side) <= worst(row, side)) {
      row = next;
      i++;
    } else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return out;
}

/** A record title without the trailing "(City Council, 2026-05-12, item 4)" meeting tag. */
export function cleanTitle(title: string): string {
  return title.replace(/\s*\([^()]*\d{4}-\d{2}-\d{2}[^()]*\)\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * The fiscal year (named for the year it ends, July 1 to June 30) a budget paper belongs to. The title
 * says so when it can ("2017-2018", "FY 27"); otherwise the date does. Audits and financial reports
 * belong to the year they report on.
 */
export function fiscalYearOf(d: Pick<DocumentSummary, 'title' | 'date' | 'year' | 'documentType'>): number | null {
  const ok = (n: number) => (n >= 1989 && n <= 2035 ? n : null);
  const t = d.title;
  for (const m of t.matchAll(/\b(\d{4})\s*[-\u2013/]\s*(\d{4})\b/g)) if (+m[2] === +m[1] + 1) return ok(+m[2]);
  const fy = t.match(/\bFY\s?(\d{4}|\d{2})\b/i);
  if (fy) return ok(fy[1].length === 4 ? +fy[1] : 2000 + +fy[1]);
  for (const m of t.matchAll(/\b(\d{4})\s*[-\u2013/]\s*(\d{2})\b/g)) {
    const a = +m[1];
    if (Math.floor(a / 100) * 100 + +m[2] === a + 1) return ok(a + 1);
  }
  const iso = d.date ?? (d.year ? `${d.year}-06-30` : null);
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) || 6;
  if (d.documentType === 'audit' || d.documentType === 'financial_report') {
    const named = t.match(/\b(?:19|20)\d{2}\b/);
    return ok(named ? Number(named[0]) : month >= 7 ? y : y - 1);
  }
  return ok(month >= 5 ? y + 1 : y);
}
