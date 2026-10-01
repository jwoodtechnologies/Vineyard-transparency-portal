/**
 * Recurring reports (water quality reports, annual financial reports and audits, budgets,
 * newsletters): when a question asks for one, every year's edition in the archive is listed with
 * the answer, newest first, so the resident can open this year's or any earlier year's.
 */
import type { Env } from '../env';

export interface SeriesItem {
  id: string;
  title: string;
  date: string | null;
  year: number | null;
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

export async function seriesFor(env: Env, question: string): Promise<ReportSeries | null> {
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
    .map((r) => ({ id: r.id, title: r.title, date: r.document_date, year: r.year ?? (r.document_date ? Number(r.document_date.slice(0, 4)) : null) }));
  return items.length ? { label: s.label, items: items.slice(0, 40) } : null;
}
