/**
 * The records home and the numbered indexes, each one aggregated, edge-cached response:
 *   GET /api/records/topics                    every topic tile: count and newest date
 *   GET /api/records/ordinances?year=2026      numbered index (also resolutions, rda-resolutions)
 * plus the adoption labels list rows carry (applyAdoptions), from adopting motions in the minutes.
 */
import type { Env } from '../env';
import type { DocumentSummary } from '../../src/types/models';
import { RECORD_TOPICS, topicSql } from '../../src/lib/recordTopics';
import { numberedKindOf, recordNumberOf, recordStatus, type NumberedKind } from '../../src/lib/recordTitle';
import { adoptionKey, adoptionMap, type Adoption, type MotionRow } from '../lib/adoptions';
import { buildIndex, type IndexDoc, type IndexRef } from '../lib/recordIndex';
import { json } from '../lib/http';

const EDGE = 'public, max-age=600, stale-while-revalidate=3600';

// Adopting motions change only when new minutes are read: one read per isolate every ten minutes.
let adoptionCache: { at: number; value: Promise<Map<string, Adoption>> } | null = null;

export function adoptions(env: Env): Promise<Map<string, Adoption>> {
  if (adoptionCache && Date.now() - adoptionCache.at < 600_000) return adoptionCache.value;
  const value = env.CATALOG_DB.prepare(
    `SELECT id, body_id, meeting_date, motion, items, result, tally, unanimous, document_id, page FROM motions
     WHERE result = 'carried' AND body_id IN ('city-council', 'redevelopment-agency')
       AND (lower(motion) LIKE '%ordinance%' OR lower(motion) LIKE '%resolution%' OR lower(motion) LIKE '%res %' OR lower(motion) LIKE '%ord %'
            OR (lower(motion) LIKE '%consent%' AND items IS NOT NULL))`,
  )
    .all<MotionRow>()
    .then((r) => adoptionMap(r.results ?? []))
    .catch(() => new Map<string, Adoption>());
  adoptionCache = { at: Date.now(), value };
  return value;
}

/**
 * Ordinances and resolutions in a list matched to the motion that adopted them: status Adopted and
 * the adopting meeting (a Draft by name stays Draft). Mutates and returns the summaries.
 */
export async function applyAdoptions<T extends DocumentSummary>(env: Env, items: T[], agendaItemIds?: Map<string, string | null>): Promise<T[]> {
  if (!items.some((d) => d.documentType === 'ordinance' || d.documentType === 'resolution')) return items;
  const map = await adoptions(env);
  if (!map.size) return items;
  for (const d of items) {
    const input = { title: d.title, documentType: d.documentType, date: d.date, documentNumber: d.documentNumber, governmentBodyId: d.governmentBodyId, governmentBodyName: d.governmentBodyName, sourceId: d.sourceId, agendaItemId: agendaItemIds?.get(d.id) ?? null };
    const kind = numberedKindOf(input);
    const n = kind ? recordNumberOf(input) : null;
    const a = kind && n ? map.get(adoptionKey(kind, n)) : undefined;
    if (!a) continue;
    const status = recordStatus(input, true);
    d.status = status;
    if (status === 'adopted') d.adoption = { date: a.date, minutesDocumentId: a.documentId, page: a.page };
  }
  return items;
}

export async function recordTopics(env: Env): Promise<Response> {
  const db = env.CATALOG_DB;
  // A date still ahead (an agenda for a meeting not yet held) is not the newest record: newest is no later than today (Vineyard time).
  const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const stmts = RECORD_TOPICS.map((t) => {
    const { sql, params } = topicSql(t, 'doc');
    return db
      .prepare(`SELECT count(*) AS n, max(CASE WHEN doc.document_date <= ? THEN doc.document_date END) AS newest, max(CASE WHEN doc.year <= ? THEN doc.year END) AS newest_year FROM documents doc WHERE ${sql}`)
      .bind(today, Number(today.slice(0, 4)), ...params);
  });
  const res = await db.batch<{ n: number; newest: string | null; newest_year: number | null }>(stmts);
  const topics = RECORD_TOPICS.map((t, i) => {
    const r = res[i]?.results?.[0];
    const newest = r?.newest ?? null;
    return { id: t.id, label: t.label, hint: t.hint, notice: t.notice ?? null, index: t.index ?? null, count: Number(r?.n ?? 0), newest, newestYear: r?.newest_year == null ? null : Number(r.newest_year) };
  });
  // A tile with nothing in it is not shown.
  return json({ topics: topics.filter((t) => t.count > 0) }, { cache: EDGE });
}

const INDEX_KINDS: Record<string, NumberedKind> = { ordinances: 'ordinance', resolutions: 'resolution', 'rda-resolutions': 'rda-resolution' };
export const isIndexKind = (s: string | undefined): s is string => Boolean(s && s in INDEX_KINDS);

export async function recordIndex(env: Env, which: string, url: URL): Promise<Response> {
  const kind = INDEX_KINDS[which];
  const y = Number(url.searchParams.get('year'));
  const year = Number.isInteger(y) && y >= 1989 && y <= 2100 ? y : null;
  const db = env.CATALOG_DB;
  const type = kind === 'ordinance' ? 'ordinance' : 'resolution';
  const word = kind === 'ordinance' ? 'Ordinance' : 'Resolution';
  const body = kind === 'rda-resolution' ? 'redevelopment-agency' : 'city-council';
  const [docs, map, refRows] = await Promise.all([
    db
      .prepare('SELECT id, title, document_type, document_number, document_date, year, government_body_id, government_body_name, source_id, agenda_item_id FROM documents WHERE document_type = ?')
      .bind(type)
      .all<IndexDoc>(),
    adoptions(env),
    db
      .prepare('SELECT meeting_date, refs, document_id, page FROM motions WHERE body_id = ? AND refs LIKE ?')
      .bind(body, `%"${word} %`)
      .all<{ meeting_date: string | null; refs: string; document_id: string; page: number | null }>()
      .catch(() => ({ results: [] as Array<{ meeting_date: string | null; refs: string; document_id: string; page: number | null }> })),
  ]);
  const refs: IndexRef[] = [];
  for (const r of refRows.results ?? []) {
    let list: string[];
    try {
      list = JSON.parse(r.refs) as string[];
    } catch {
      continue;
    }
    for (const ref of list) {
      const m = ref.match(new RegExp(`^${word} ((?:19|20)\\d{2})-(\\d{1,3})([A-Z]?)$`));
      if (!m) continue;
      // A number years from the meeting is a measure only cited, or a misread.
      if (r.meeting_date && Math.abs(Number(m[1]) - Number(r.meeting_date.slice(0, 4))) > 1) continue;
      refs.push({ number: `${m[1]}-${String(Number(m[2])).padStart(2, '0')}${m[3]}`, date: r.meeting_date, documentId: r.document_id, page: r.page });
    }
  }
  refs.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const index = buildIndex(kind, year, docs.results ?? [], [...map.values()], refs);
  return json(index, { cache: EDGE });
}
