/** GET /api/budget : the adopted fiscal 2027 budget, plus any newer budget document the city has posted since. */
import type { Env } from '../env';
import { budgetPayload, BUDGET_AMENDED } from '../lib/budgetData';
import { CACHE, json } from '../lib/http';
import { toDocumentSummary } from '../lib/mappers';

type Row = Record<string, unknown>;

export async function getBudget(env: Env): Promise<Response> {
  let newer: Array<{ id: string; title: string; date: string | null }> = [];
  try {
    const r = await env.CATALOG_DB.prepare(
      `SELECT id, title, document_date FROM documents
       WHERE document_type = 'budget' AND document_date > ? AND coalesce(currency, '') <> 'current'
       ORDER BY document_date DESC LIMIT 5`,
    )
      .bind(BUDGET_AMENDED)
      .all<Row>();
    newer = (r.results ?? []).map((d) => ({ id: String(d.id), title: String(d.title), date: d.document_date == null ? null : String(d.document_date) }));
  } catch {
    // The numbers below are fixed; only the "newer document" notice depends on the database.
  }
  return json({ ...budgetPayload(), newer }, { cache: CACHE.list });
}

/**
 * GET /api/budget/archive : every budget the archive holds, for any year. Budgets, audits and financial
 * reports, plus the resolutions and ordinances that adopted a budget or set a tax rate (back to 1991).
 */
export async function getBudgetArchive(env: Env): Promise<Response> {
  const res = await env.CATALOG_DB.prepare(
    `SELECT * FROM documents
     WHERE document_type IN ('budget', 'financial_report', 'audit')
        OR (document_type IN ('resolution', 'ordinance', 'public_notice', 'presentation', 'memorandum', 'exhibit', 'study', 'plan', 'other')
            AND (title LIKE '%budget%' OR title LIKE '%tax rate%' OR title LIKE '%financial report%' OR title LIKE '%audit%'))
     ORDER BY coalesce(document_date, CAST(year AS TEXT) || '-12-31') DESC, title
     LIMIT 900`,
  ).all<Row>();
  const items = (res.results ?? []).map((r) => toDocumentSummary(r as never));
  return json({ items, total: items.length }, { cache: CACHE.list });
}
