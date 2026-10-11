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
import { buildIndex, captionDocs, ownTitle, type IndexDoc, type IndexLink, type IndexMotion, type IndexRef } from '../lib/recordIndex';
import { BUDGET_ADOPTION_ORDINANCE } from '../lib/budgetData';
import { isBudgetAdoption } from '../lib/projectMatch';
import { SearchRepository } from '../search/SearchRepository';
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
  const map = await adoptions(env);
  const adoptingIds = [...map.values()].map((x) => x.id).filter((x): x is string => Boolean(x));
  // Motions that can carry a numbered measure: the item or motion names one, the budget, a motion with no wording
  // (a motion brought back), or a motion read as adopting one. With each, its recorded roll call (yes and no),
  // the tally when the minutes print none.
  const motionSql = (roll: boolean) =>
    `SELECT id, body_id, meeting_date, seq, item, motion, result, tally, unanimous, document_id, page${
      roll
        ? `, (SELECT count(*) FROM motion_votes v WHERE v.motion_id = motions.id AND v.vote = 'yes') AS yes,
             (SELECT count(*) FROM motion_votes v WHERE v.motion_id = motions.id AND v.vote = 'no') AS no`
        : ''
    } FROM motions WHERE body_id = ?
     AND (lower(coalesce(item, '')) LIKE '%ordinance%' OR lower(coalesce(item, '')) LIKE '%resolution%' OR lower(coalesce(item, '')) LIKE '%budget%'
          OR lower(coalesce(motion, '')) LIKE '%ordinance%' OR lower(coalesce(motion, '')) LIKE '%resolution%' OR lower(coalesce(motion, '')) LIKE '%res %' OR lower(coalesce(motion, '')) LIKE '%ord %'
          OR trim(coalesce(motion, '')) = '' OR id IN (SELECT value FROM json_each(?)))`;
  const readMotions = (roll: boolean) => db.prepare(motionSql(roll)).bind(body, JSON.stringify(adoptingIds)).all<IndexMotion>();
  const [docs, refRows, motionRows] = await Promise.all([
    db
      .prepare('SELECT id, title, description, document_type, document_number, document_date, year, government_body_id, government_body_name, source_id, agenda_item_id FROM documents WHERE document_type = ?')
      .bind(type)
      .all<IndexDoc>(),
    db
      .prepare('SELECT meeting_date, refs, document_id, page FROM motions WHERE body_id = ? AND refs LIKE ?')
      .bind(body, `%"${word} %`)
      .all<{ meeting_date: string | null; refs: string; document_id: string; page: number | null }>()
      .catch(() => ({ results: [] as Array<{ meeting_date: string | null; refs: string; document_id: string; page: number | null }> })),
    // Without the roll call table (a new database), the motions alone.
    readMotions(true)
      .catch(() => readMotions(false))
      .catch(() => ({ results: [] as IndexMotion[] })),
  ]);
  const motions = motionRows.results ?? [];
  // The council's budget vote adopted the budget ordinance, which the minutes do not name (budgetData).
  const links: IndexLink[] = [];
  if (kind === 'ordinance') {
    const budgetVote = motions.find((m) => isBudgetAdoption({ date: m.meeting_date, result: String(m.result ?? ''), item: m.item, motion: m.motion ?? '' }));
    const n = BUDGET_ADOPTION_ORDINANCE.match(/(\d{4}-\d{2})$/)?.[1];
    if (budgetVote && n) links.push({ kind, number: n, motionId: budgetVote.id });
  }
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
  const build = (titles?: Map<string, string>) => buildIndex(kind, year, docs.results ?? [], [...map.values()], refs, motions, links, titles);
  let index = build();
  // The caption each linked copy prints on its first page is its title (worker/lib/recordIndex.ts).
  const ids = captionDocs(index);
  if (ids.length) {
    const titles = await ownTitles(env, ids).catch(() => new Map<string, string>());
    if (titles.size) index = build(titles);
  }
  return json(index, { cache: EDGE });
}

/** The caption printed on each document's first page, read from the search shards (one query per shard). */
async function ownTitles(env: Env, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const repo = new SearchRepository(env);
  if (!repo.available) return out;
  const rows = await env.CATALOG_DB.prepare('SELECT id, search_shard FROM documents WHERE id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids))
    .all<{ id: string; search_shard: number | null }>();
  const byShard = new Map<number, string[]>();
  for (const r of rows.results ?? []) {
    const n = Number(r.search_shard);
    if (r.search_shard == null || !repo.activeShards.includes(n)) continue;
    byShard.set(n, [...(byShard.get(n) ?? []), r.id]);
  }
  await Promise.all(
    [...byShard.entries()].map(async ([n, list]) => {
      const res = await repo
        .shard(n)
        .prepare('SELECT document_id, text FROM chunks WHERE document_id IN (SELECT value FROM json_each(?)) AND coalesce(page_start, 1) <= 1 ORDER BY document_id, page_start, rowid')
        .bind(JSON.stringify(list))
        .all<{ document_id: string; text: string }>()
        .catch(() => ({ results: [] as Array<{ document_id: string; text: string }> }));
      const text = new Map<string, string>();
      for (const c of res.results ?? []) text.set(c.document_id, `${text.get(c.document_id) ?? ''}\n${c.text}`);
      for (const [id, t] of text) {
        const title = ownTitle(t);
        if (title) out.set(id, title);
      }
    }),
  );
  return out;
}
