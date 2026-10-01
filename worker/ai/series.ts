/**
 * Recurring reports (water quality reports, annual financial reports and audits, budgets,
 * newsletters): when a question asks for one, every year's edition in the archive is listed with
 * the answer, newest first, so the resident can open this year's or any earlier year's.
 */
import type { Env } from '../env';
import { fiscalYearOf } from './timeframe';

export { fiscalYearOf };

export interface SeriesItem {
  id: string;
  title: string;
  date: string | null;
  year: number | null;
  /** Shown instead of the year when set, for example "FY2027". */
  tag?: string;
}
export interface ReportSeries {
  label: string;
  items: SeriesItem[];
}

const SERIES: Array<{ match: RegExp; label: string; like: string[]; types?: string[] }> = [
  { match: /\b(water quality|consumer confidence|ccr|drinking water (quality )?report|water report)\b/i, label: 'Water quality reports, every year', like: ['%water quality%', '%consumer confidence%', '%ccr%'] },
  { match: /\b(annual (comprehensive )?financial report|acfr|cafr|financial statements?|audit(ed|s)?|auditor'?s report)\b/i, label: 'Annual financial reports and audits, every year', like: ['%annual%financial%report%', '%acfr%', '%cafr%', '%audit%', '%financial statement%'], types: ['audit', 'financial_report'] },
  { match: /\b(budget (book|document|report)s?|final budget|tentative budget|adopted budget|budget for (fiscal|fy|the year)|fy ?\d{2,4} budget|annual budget)\b/i, label: 'Budgets, every year', like: ['%final budget%', '%tentative budget%', '%adopted budget%', '%budget book%'], types: ['budget'] },
  { match: /\bnewsletters?\b/i, label: 'City newsletters', like: ['%newsletter%'] },
  { match: /\b(fee schedule|consolidated fee)\b/i, label: 'Fee schedules and amendments', like: ['%fee schedule%'] },
];

const rank = (title: string) =>
  /notice|slides?|presentation|\bpp\b|power ?point|hearing|agenda|minutes/i.test(title) ? 0 : /final|adopted|budget book/i.test(title) ? 4 : /amend/i.test(title) ? 1 : /tentative/i.test(title) ? 3 : /draft/i.test(title) ? 2 : 1;

/** Budgets: one entry per fiscal year, the final (adopted) budget where the archive has it. */
async function budgetSeries(env: Env): Promise<ReportSeries | null> {
  const res = await env.CATALOG_DB.prepare(
    `SELECT id, title, document_date, year FROM documents WHERE document_type = 'budget' OR (lower(title) LIKE '%budget%' AND document_type NOT IN ('agenda', 'minutes', 'public_notice'))
     ORDER BY coalesce(document_date, CAST(year AS TEXT) || '-12-31') DESC LIMIT 400`,
  )
    .all<{ id: string; title: string; document_date: string | null; year: number | null }>()
    .catch(() => null);
  const best = new Map<number, { r: { id: string; title: string; document_date: string | null }; score: number }>();
  for (const r of res?.results ?? []) {
    if (/\bRDA\b|redevelopment/i.test(r.title)) continue;
    const fy = fiscalYearOf(r.title, r.document_date);
    if (!fy || fy < 1990 || fy > 2100) continue;
    const score = rank(r.title);
    if (!score) continue;
    const cur = best.get(fy);
    if (!cur || score > cur.score) best.set(fy, { r, score });
  }
  const items = [...best.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([fy, { r }]) => ({ id: r.id, title: r.title.replace(/\s*\((?:Special )?City Council[^)]*\)\s*$/i, ''), date: r.document_date, year: fy, tag: `FY${fy}` }));
  return items.length ? { label: 'City budgets by fiscal year (July to June)', items: items.slice(0, 40) } : null;
}

export async function seriesFor(env: Env, question: string): Promise<ReportSeries | null> {
  if (/\bbudgets?\b/i.test(question) && !/\bRDA\b|redevelopment/i.test(question)) return budgetSeries(env);
  const s = SERIES.find((x) => x.match.test(question));
  if (!s) return null;
  const likes = s.like.map(() => 'lower(title) LIKE ?').join(' OR ');
  const types = s.types?.length ? ` OR document_type IN (${s.types.map(() => '?').join(',')})` : '';
  const res = await env.CATALOG_DB.prepare(
    `SELECT id, title, document_date, year FROM documents WHERE (${likes}${types}) AND document_type NOT IN ('agenda', 'minutes')
     ORDER BY coalesce(document_date, CAST(year AS TEXT) || '-12-31') DESC LIMIT 60`,
  )
    .bind(...s.like, ...(s.types ?? []))
    .all<{ id: string; title: string; document_date: string | null; year: number | null }>()
    .catch(() => null);
  const seen = new Set<string>();
  const items = (res?.results ?? [])
    .filter((r) => {
      const k = r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const named = r.title.match(/\b(19[89]\d|20[0-4]\d)\b/);
      return { id: r.id, title: r.title, date: r.document_date, year: r.year ?? (r.document_date ? Number(r.document_date.slice(0, 4)) : named ? Number(named[1]) : null) };
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return items.length ? { label: s.label, items: items.slice(0, 40) } : null;
}
