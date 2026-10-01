import type { Env } from '../env';
import type { AgendaItem, ArchiveStatistics, BrowseFacets, Category, FacetBucket, IssueReportReceipt, Meeting, MeetingSummary, Paginated, SuggestedQuery } from '../../src/types/models';
import { CACHE, HttpError, json, jsonWithEtag, notFound, badRequest, readJson } from '../lib/http';
import { toGovernmentBody, toMeetingSummary, toSource, parseMedia, type Row } from '../lib/mappers';
import { CATEGORY_DEFS, DOCUMENT_TYPE_LABELS, normalizeType } from '../lib/taxonomy';
import { clampInt, nowIso, randomId } from '../lib/util';
import { SearchRepository } from '../search/SearchRepository';
import { aiBreakerOpen, aiConfigured } from '../ai/rag';

export async function handleHealth(env: Env): Promise<Response> {
  const checkedAt = nowIso();
  let database: boolean;
  let indexed: number | null = null;
  let lastCrawl: Record<string, unknown> | null = null;
  try {
    const r = await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM documents').first<{ n: number }>();
    indexed = Number(r?.n ?? 0);
    lastCrawl = await env.CATALOG_DB.prepare("SELECT id, status, started_at, finished_at FROM crawl_runs ORDER BY started_at DESC LIMIT 1").first<Record<string, unknown>>();
    database = true;
  } catch {
    database = false;
  }
  const repo = new SearchRepository(env);
  let search = false;
  try {
    if (repo.available) {
      await Promise.all(repo.activeShards.map((n) => repo.shard(n).prepare('SELECT 1 FROM shard_documents LIMIT 1').all()));
      search = true;
    }
  } catch {
    search = false;
  }
  const ai = aiConfigured(env) && !aiBreakerOpen();
  const archive = Boolean(env.ARCHIVE);
  const status = database && search ? 'ok' : 'degraded';
  return json(
    {
      status,
      search,
      ai,
      checkedAt,
      message: ai ? undefined : 'AI answers unavailable; search-only mode.',
      application: 'healthy',
      database: database ? 'healthy' : 'unavailable',
      archive: archive ? 'available' : 'unavailable',
      aiMode: ai ? 'available' : 'search-only',
      searchShards: repo.activeShards.length,
      indexedDocuments: indexed,
      lastCrawl: lastCrawl ? { status: lastCrawl.status, startedAt: lastCrawl.started_at, finishedAt: lastCrawl.finished_at } : null,
    },
    { cache: CACHE.none },
  );
}

export async function handleStats(env: Env): Promise<Response> {
  const db = env.CATALOG_DB;
  const [docs, meetings, sources, crawl] = await Promise.all([
    db
      .prepare(
        `SELECT count(*) AS n, sum(coalesce(page_count, 0)) AS pages, min(document_date) AS earliest, max(document_date) AS latest,
                sum(CASE WHEN ocr_status = 'needed' THEN 1 ELSE 0 END) AS ocr, sum(CASE WHEN archive_status = 'archived' THEN 1 ELSE 0 END) AS archived,
                sum(CASE WHEN archive_status = 'quota_deferred' THEN 1 ELSE 0 END) AS deferred, max(updated_at) AS updated
         FROM documents`,
      )
      .first<Record<string, number | string | null>>(),
    db.prepare('SELECT count(*) AS n FROM meetings').first<{ n: number }>(),
    db.prepare("SELECT count(*) AS n, sum(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS healthy FROM sources WHERE crawl_enabled = 1").first<{ n: number; healthy: number }>(),
    db.prepare("SELECT max(finished_at) AS at FROM crawl_runs WHERE status IN ('completed', 'budget_reached')").first<{ at: string | null }>(),
  ]);
  const stats: ArchiveStatistics & Record<string, unknown> = {
    documentsIndexed: Number(docs?.n ?? 0),
    pagesIndexed: docs?.pages == null ? null : Number(docs.pages),
    meetingsIndexed: Number(meetings?.n ?? 0),
    earliestRecordDate: (docs?.earliest as string | null) ?? null,
    latestRecordDate: (docs?.latest as string | null) ?? null,
    archiveLastUpdatedAt: (docs?.updated as string | null) ?? null,
    sourcesMonitored: Number(sources?.n ?? 0),
    sourcesHealthy: sources?.healthy == null ? null : Number(sources.healthy),
    ocrPendingCount: Number(docs?.ocr ?? 0),
    isDemo: false,
    documentsArchived: Number(docs?.archived ?? 0),
    documentsQuotaDeferred: Number(docs?.deferred ?? 0),
    lastSuccessfulCrawlAt: crawl?.at ?? null,
  };
  return json(stats, { cache: CACHE.stats });
}

export async function listSources(env: Env, request: Request, id?: string): Promise<Response> {
  const sql = `SELECT s.*, (SELECT count(*) FROM documents d WHERE d.source_id = s.id) AS document_count FROM sources s${id ? ' WHERE s.id = ?' : ''} ORDER BY s.name`;
  const stmt = env.CATALOG_DB.prepare(sql);
  const res = await (id ? stmt.bind(id) : stmt).all<Row>();
  const list = (res.results ?? []).map(toSource);
  if (id) {
    if (!list[0]) throw notFound('Unknown source.');
    return jsonWithEtag(request, list[0], CACHE.detail);
  }
  return jsonWithEtag(request, list, CACHE.detail);
}

const BODY_SQL = `SELECT b.*,
  (SELECT count(*) FROM meetings m WHERE m.government_body_id = b.id) AS meeting_count,
  (SELECT count(*) FROM documents d WHERE d.government_body_id = b.id) AS document_count,
  (SELECT min(meeting_date) FROM meetings m WHERE m.government_body_id = b.id) AS first_record_date,
  (SELECT max(meeting_date) FROM meetings m WHERE m.government_body_id = b.id AND m.meeting_date <= date('now')) AS last_record_date
  FROM government_bodies b`;

export async function listBodies(env: Env, request: Request, id?: string): Promise<Response> {
  if (id) {
    const row = await env.CATALOG_DB.prepare(`${BODY_SQL} WHERE b.id = ? OR b.slug = ?`).bind(id, id).first<Row>();
    if (!row) throw notFound('Unknown government body.');
    return jsonWithEtag(request, toGovernmentBody(row), CACHE.detail);
  }
  const res = await env.CATALOG_DB.prepare(`${BODY_SQL} ORDER BY b.name`).all<Row>();
  return jsonWithEtag(request, (res.results ?? []).map(toGovernmentBody), CACHE.detail);
}

export async function listMeetings(env: Env, url: URL): Promise<Response> {
  const p = url.searchParams;
  const page = clampInt(p.get('page'), 1, 1, 10000);
  const pageSize = clampInt(p.get('pageSize'), 20, 1, 100);
  const clauses: string[] = [];
  const params: unknown[] = [];
  const body = p.get('body');
  if (body) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(body)) throw badRequest('Invalid body.');
    clauses.push('m.government_body_id = ?');
    params.push(body);
  }
  const year = p.get('year');
  if (year) {
    if (!/^\d{4}$/.test(year)) throw badRequest('Invalid year.');
    clauses.push("substr(m.meeting_date, 1, 4) = ?");
    params.push(year);
  }
  // ?held=1: meetings already held that have records (the Records page's meeting list).
  if (p.get('held') === '1') {
    clauses.push('substr(m.meeting_date, 1, 10) <= ?');
    params.push(new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10));
    clauses.push('EXISTS (SELECT 1 FROM documents d WHERE d.meeting_id = m.id)');
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const order = p.get('sort') === 'date_asc' ? 'm.meeting_date ASC' : 'm.meeting_date DESC';
  const [rows, count] = await Promise.all([
    env.CATALOG_DB.prepare(`SELECT m.*, (SELECT count(*) FROM agenda_items a WHERE a.meeting_id = m.id) AS agenda_item_count, (SELECT group_concat(DISTINCT d.document_type) FROM documents d WHERE d.meeting_id = m.id) AS doc_types FROM meetings m${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<Row>(),
    env.CATALOG_DB.prepare(`SELECT count(*) AS n FROM meetings m${where}`).bind(...params).first<{ n: number }>(),
  ]);
  const out: Paginated<MeetingSummary> = { items: (rows.results ?? []).map((r) => ({ ...toMeetingSummary(r), docTypes: String(r.doc_types ?? '').split(',').filter(Boolean) }) as MeetingSummary), page, pageSize, total: Number(count?.n ?? 0) };
  return json(out, { cache: CACHE.list });
}

export async function getMeeting(env: Env, request: Request, id: string): Promise<Response> {
  const row = await env.CATALOG_DB.prepare('SELECT m.*, (SELECT count(*) FROM agenda_items a WHERE a.meeting_id = m.id) AS agenda_item_count FROM meetings m WHERE m.id = ? OR m.slug = ?')
    .bind(id, id)
    .first<Row>();
  if (!row) throw notFound('That meeting is not in the archive.');
  const items = await env.CATALOG_DB.prepare('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort').bind(row.id).all<Row>();
  const attachments = await env.CATALOG_DB.prepare('SELECT id, agenda_item_id FROM documents WHERE meeting_id = ? AND agenda_item_id IS NOT NULL').bind(row.id).all<Row>();
  const docsByItem = new Map<string, string[]>();
  for (const a of attachments.results ?? []) docsByItem.set(String(a.agenda_item_id), [...(docsByItem.get(String(a.agenda_item_id)) ?? []), String(a.id)]);
  const all = (items.results ?? []).map(
    (r): AgendaItem & { parentId: string | null } => ({
      id: String(r.id),
      meetingId: String(r.meeting_id),
      number: String(r.number ?? ''),
      title: String(r.title),
      ...(r.description ? { description: String(r.description) } : {}),
      itemType: (r.item_type ?? 'other') as AgendaItem['itemType'],
      documentIds: docsByItem.get(String(r.id)) ?? [],
      motions: [],
      packetPageStart: r.packet_page_start == null ? null : Number(r.packet_page_start),
      packetPageEnd: r.packet_page_end == null ? null : Number(r.packet_page_end),
      parentId: r.parent_id == null ? null : String(r.parent_id),
    }),
  );
  const byId = new Map(all.map((i) => [i.id, i]));
  const roots: AgendaItem[] = [];
  for (const item of all) {
    const { parentId, ...clean } = item;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) (parent.children ??= []).push(clean);
    else roots.push(clean);
  }
  const summary = toMeetingSummary(row);
  const summaryOnly = new Set(['agendaItemCount', 'hasVideo', 'hasAudio', 'hasTranscript']);
  const rest = Object.fromEntries(Object.entries(summary).filter(([k]) => !summaryOnly.has(k))) as Omit<Meeting, 'agendaItems' | 'media'>;
  const meeting: Meeting = { ...rest, media: parseMedia(row), agendaItems: roots };
  return jsonWithEtag(request, meeting, CACHE.detail);
}

export async function listCategories(env: Env, request: Request): Promise<Response> {
  const res = await env.CATALOG_DB.prepare('SELECT document_type, count(*) AS n FROM documents GROUP BY document_type').all<{ document_type: string; n: number }>();
  const counts = new Map((res.results ?? []).map((r) => [r.document_type, Number(r.n)]));
  const cats: Category[] = CATEGORY_DEFS.map((c) => ({ ...c, documentCount: c.documentTypes.reduce((s, t) => s + (counts.get(t) ?? 0), 0) }));
  return jsonWithEtag(request, cats, CACHE.detail);
}

export async function browseFacets(env: Env): Promise<Response> {
  const db = env.CATALOG_DB;
  const [years, types, bodies, sources] = await Promise.all([
    db.prepare('SELECT year AS v, count(*) AS n FROM documents WHERE year IS NOT NULL GROUP BY year ORDER BY year DESC').all<{ v: number; n: number }>(),
    db.prepare('SELECT document_type AS v, count(*) AS n FROM documents GROUP BY document_type ORDER BY n DESC').all<{ v: string; n: number }>(),
    db.prepare('SELECT d.government_body_id AS v, b.name AS label, count(*) AS n FROM documents d LEFT JOIN government_bodies b ON b.id = d.government_body_id WHERE d.government_body_id IS NOT NULL GROUP BY d.government_body_id ORDER BY n DESC').all<{ v: string; label: string | null; n: number }>(),
    db.prepare('SELECT d.source_id AS v, s.name AS label, count(*) AS n FROM documents d LEFT JOIN sources s ON s.id = d.source_id GROUP BY d.source_id ORDER BY n DESC').all<{ v: string; label: string | null; n: number }>(),
  ]);
  const typeCounts = new Map((types.results ?? []).map((r) => [r.v, Number(r.n)]));
  const categories: FacetBucket[] = CATEGORY_DEFS.map((c) => ({ value: c.id, label: c.label, count: c.documentTypes.reduce((s, t) => s + (typeCounts.get(t) ?? 0), 0) })).filter((b) => b.count > 0);
  const facets: BrowseFacets = {
    years: (years.results ?? []).map((r) => ({ value: String(r.v), label: String(r.v), count: Number(r.n) })),
    documentTypes: (types.results ?? []).map((r) => ({ value: r.v, label: DOCUMENT_TYPE_LABELS[normalizeType(r.v)], count: Number(r.n) })),
    governmentBodies: (bodies.results ?? []).map((r) => ({ value: r.v, label: r.label ?? r.v, count: Number(r.n) })),
    categories,
    sources: (sources.results ?? []).map((r) => ({ value: r.v, label: r.label ?? r.v, count: Number(r.n) })),
    subjects: [],
  };
  return json(facets, { cache: CACHE.stats });
}

/** Suggestions are built from what is actually indexed, never from assumptions. */
export async function suggestions(env: Env): Promise<Response> {
  const db = env.CATALOG_DB;
  const [bodies, types] = await Promise.all([
    db.prepare("SELECT b.id, b.name, count(*) AS n FROM documents d JOIN government_bodies b ON b.id = d.government_body_id WHERE d.document_type IN ('agenda','minutes','agenda_packet') GROUP BY b.id ORDER BY n DESC LIMIT 3").all<{ id: string; name: string; n: number }>(),
    db.prepare("SELECT document_type AS t, max(year) AS y, count(*) AS n FROM documents WHERE document_type IN ('budget','audit','financial_report','ordinance','resolution') GROUP BY document_type ORDER BY n DESC LIMIT 3").all<{ t: string; y: number | null; n: number }>(),
  ]);
  const out: SuggestedQuery[] = [];
  for (const b of bodies.results ?? []) out.push({ id: `body-${b.id}`, text: `${b.name} meeting records`, mode: 'search', filters: { governmentBodyIds: [b.id] }, category: 'meetings' });
  for (const t of types.results ?? []) {
    const label = DOCUMENT_TYPE_LABELS[normalizeType(t.t)];
    out.push({ id: `type-${t.t}`, text: t.y ? `${label} records from ${t.y}` : `${label} records`, mode: 'search', filters: { documentTypes: [normalizeType(t.t)], ...(t.y ? { years: [t.y] } : {}) } });
  }
  return json(out, { cache: CACHE.stats });
}

export async function submitReport(env: Env, request: Request): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request, 8 * 1024);
  const types = ['broken_document', 'incorrect_metadata', 'incorrect_citation', 'incorrect_ai_summary', 'missing_document', 'duplicate_record', 'other'];
  const issueType = String(body.issueType ?? '');
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!types.includes(issueType)) throw badRequest('Unknown issueType.');
  if (!description || description.length > 2000) throw badRequest('`description` must be 1 to 2000 characters.');
  const c = (body.context ?? {}) as Record<string, unknown>;
  const context = {
    documentId: typeof c.documentId === 'string' ? c.documentId.slice(0, 128) : null,
    askResponseId: typeof c.askResponseId === 'string' ? c.askResponseId.slice(0, 64) : null,
    citationIndex: Number.isInteger(c.citationIndex) ? c.citationIndex : null,
    pageUrl: typeof c.pageUrl === 'string' ? c.pageUrl.slice(0, 500) : '',
  };
  const receipt: IssueReportReceipt = { id: randomId('rpt'), receivedAt: nowIso(), status: 'received' };
  await env.CATALOG_DB.prepare('INSERT INTO issue_reports (id, issue_type, description, context_json, received_at) VALUES (?, ?, ?, ?, ?)').bind(receipt.id, issueType, description, JSON.stringify(context), receipt.receivedAt).run();
  return json(receipt, { status: 201 });
}

export function notImplementedYet(kind: 'topics' | 'code' | 'topic'): Response {
  if (kind === 'topic') throw new HttpError(404, 'not_found', 'Topics have not been curated from the indexed records yet.');
  return json([], { cache: CACHE.stats });
}
