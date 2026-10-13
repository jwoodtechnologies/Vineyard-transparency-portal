/** GET /api/budget : the city's adopted budget (the built-in one or the version staff saved), plus any newer budget document the city has posted since. */
import type { Env } from '../env';
import { budgetPayload, BUDGET_ADOPTION_ORDINANCE_DOC, BUDGET_AMENDED, BUDGET_DOCS, fiscalShort } from '../lib/budgetData';
import { computeTrail } from './trail';
import type { DocumentSummary } from '../../src/types/models';
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
    // The numbers come from the budget in force; only the "newer document" notice depends on the database.
  }
  return json({ ...budgetPayload(), newer, adoptionBudgetDoc: await adoptionBudgetDoc(env) }, { cache: CACHE.list });
}

/** The budget book among files on the same agenda item (budget type first, then "budget" in the name, most pages). */
export function pickBudgetBook(files: DocumentSummary[]): DocumentSummary | null {
  const score = (d: DocumentSummary) => (d.documentType === 'budget' ? 2 : /\bbudget\b/i.test(d.title) && !/\b(slides?|presentation|ordinance|resolution|notice|hearing)\b/i.test(d.title) && d.documentType !== 'presentation' ? 1 : 0);
  const books = files.filter((d) => score(d) > 0 && !/\b(slides?|presentation)\b/i.test(d.title));
  books.sort((a, b) => score(b) - score(a) || Number(b.pageCount ?? 0) - Number(a.pageCount ?? 0));
  return books[0] ?? null;
}

/**
 * The budget document filed with the ordinance that adopted the budget: the budget book attached to the same
 * agenda item, found from the records (GET /api/documents/:id/trail). The known book is the fallback.
 */
async function adoptionBudgetDoc(env: Env): Promise<{ id: string; title: string }> {
  try {
    const row = await env.CATALOG_DB.prepare('SELECT * FROM documents WHERE id = ?').bind(BUDGET_ADOPTION_ORDINANCE_DOC).first<Row>();
    if (row) {
      const trail = await computeTrail(env, row);
      const book = pickBudgetBook(trail.attachments);
      if (book) return { id: book.id, title: book.displayTitle ?? book.title };
    }
  } catch {
    // The known book below.
  }
  return { id: BUDGET_DOCS.book, title: `${fiscalShort()} Final Budget` };
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
