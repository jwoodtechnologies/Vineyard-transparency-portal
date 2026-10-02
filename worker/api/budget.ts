/** GET /api/budget : the adopted fiscal 2027 budget, plus any newer budget document the city has posted since. */
import type { Env } from '../env';
import { budgetPayload, BUDGET_AMENDED } from '../lib/budgetData';
import { CACHE, json } from '../lib/http';

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
