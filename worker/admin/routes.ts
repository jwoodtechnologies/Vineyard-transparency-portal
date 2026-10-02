/**
 * /api/admin/*: the write side used only by the ingestion pipeline (ingest/ in this repo).
 *
 * Free-tier protection lives here, server-side, so no client can bypass it:
 *  - D1: every mutating call checks today's recorded rows_written (quota_usage, UTC day) against
 *    MAX_D1_INGEST_ROWS_PER_DAY and returns 429 quota_exhausted when the budget is reached. The
 *    recorded number is D1's own meta.rows_written for the statements we ran.
 *  - R2: uploads are refused (archive_status = quota_deferred) when stored bytes + the new object
 *    would exceed ARCHIVE_STORAGE_HARD_STOP_BYTES, or when one object exceeds ARCHIVE_MAX_OBJECT_BYTES.
 */
import catalogSql from '../../migrations/catalog/0001_catalog.sql';
import searchSql from '../../migrations/search/0001_search.sql';
import type { Env } from '../env';
import { intVar } from '../env';
import { HttpError, json, badRequest, notFound, readJson } from '../lib/http';
import { nowIso, utcDay, chunked } from '../lib/util';
import { categoriesForType, normalizeType } from '../lib/taxonomy';
import { adoptionDate, titleDate } from '../lib/adoptionDate';
import { processVotes } from '../api/votes';
import { SearchRepository, type ChunkInput } from '../search/SearchRepository';
import { upsertPeople, type PersonInput } from '../api/people';
import { archiveKey, storageFor } from '../storage/StorageProvider';
import { ensureActivityTables } from '../panel/store';
import { newSetupCode } from '../panel/auth';
import { requireIngestAuth } from './auth';
import { splitSql } from '../lib/sql';
import { exportPage, exportTables, pruneBackups, putBackup } from './backup';

export const BUDGET_MESSAGE = 'Daily free-tier ingestion budget reached. Resume next UTC quota period.';

type Json = Record<string, unknown>;

const s = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'record';
}

const sum = (results: D1Result[]): number => results.reduce((t, r) => t + Number(r.meta?.rows_written ?? 0), 0);

export class Budget {
  constructor(private readonly env: Env) {}
  get limit(): number {
    return intVar(this.env.MAX_D1_INGEST_ROWS_PER_DAY, 75000);
  }
  async used(): Promise<number> {
    const r = await this.env.CATALOG_DB.prepare('SELECT d1_rows_written FROM quota_usage WHERE day = ?').bind(utcDay()).first<{ d1_rows_written: number }>();
    return Number(r?.d1_rows_written ?? 0);
  }
  async check(estimate = 0): Promise<void> {
    const used = await this.used();
    if (used + estimate >= this.limit) throw new HttpError(429, 'quota_exhausted', BUDGET_MESSAGE, secondsToUtcMidnight());
  }
  async record(rows: number, extra: { r2Bytes?: number; r2Ops?: number } = {}): Promise<void> {
    await this.env.CATALOG_DB.prepare(
      `INSERT INTO quota_usage (day, d1_rows_written, r2_bytes_uploaded, r2_class_a_ops, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET d1_rows_written = d1_rows_written + excluded.d1_rows_written,
         r2_bytes_uploaded = r2_bytes_uploaded + excluded.r2_bytes_uploaded, r2_class_a_ops = r2_class_a_ops + excluded.r2_class_a_ops, updated_at = excluded.updated_at`,
    )
      .bind(utcDay(), rows + 1, extra.r2Bytes ?? 0, extra.r2Ops ?? 0, nowIso())
      .run();
  }
}

function secondsToUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.ceil((next - now.getTime()) / 1000);
}

// ---------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A meeting date in a title: "May 11, 1989", "Sept. 4, 2003", "12/10/2025", "6.23.26". */
export function dateInTitle(title: string): string | null {
  const iso = (y: number, m: number, d: number) => (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
  const w = title.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (w) return iso(Number(w[3]), MONTHS[w[1].slice(0, 3).toLowerCase()], Number(w[2]));
  const n = title.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
  if (n) return iso(n[3].length === 2 ? 2000 + Number(n[3]) : Number(n[3]), Number(n[1]), Number(n[2]));
  return null;
}

/**
 * One record per meeting: fills missing meeting dates from titles, then folds any second copy of
 * the same minutes or agenda (same body, date and special/regular) into the first, keeping the
 * CivicClerk copy when there is one. Sources move to the kept record; the copy's search text goes.
 */
async function mergeDuplicateMeetings(env: Env): Promise<{ dated: number; merged: number }> {
  const db = env.CATALOG_DB;
  const repo = new SearchRepository(env);
  let dated = 0;
  const undated = await db.prepare("SELECT id, title, search_shard FROM documents WHERE document_type IN ('minutes','agenda','agenda_packet') AND document_date IS NULL LIMIT 5000").all<{ id: string; title: string; search_shard: number | null }>();
  for (const d of undated.results ?? []) {
    const date = dateInTitle(d.title);
    if (!date) continue;
    await db.prepare('UPDATE documents SET document_date = ?, year = ? WHERE id = ?').bind(date, Number(date.slice(0, 4)), d.id).run();
    if (d.search_shard != null && repo.activeShards.includes(d.search_shard)) await repo.shard(d.search_shard).prepare('UPDATE shard_documents SET document_date = ?, year = ? WHERE document_id = ?').bind(date, Number(date.slice(0, 4)), d.id).run().catch(() => undefined);
    dated++;
  }
  const groups = await db
    .prepare(
      `SELECT document_type AS t, document_date AS dt, government_body_id AS b, (CASE WHEN lower(title) LIKE '%special%' THEN 1 ELSE 0 END) AS sp,
              json_group_array(json_object('id', id, 'src', source_id, 'seen', first_seen_at, 'shard', search_shard)) AS docs
       FROM documents WHERE document_type IN ('minutes','agenda','agenda_packet') AND document_date IS NOT NULL AND government_body_id IS NOT NULL
       GROUP BY t, dt, b, sp HAVING count(*) > 1 LIMIT 2000`,
    )
    .all<{ docs: string }>();
  let merged = 0;
  // Code site entries that were only a title (no minutes text, no file) are not records.
  const empties = await db
    .prepare("SELECT id, search_shard FROM documents WHERE source_id = 'vineyard-municipal-code' AND mime_type LIKE 'text/html%' AND document_type IN ('minutes','resolution','ordinance') AND coalesce(file_size, 0) < 200 LIMIT 2000")
    .all<{ id: string; search_shard: number | null }>();
  for (const e of empties.results ?? []) {
    await db.batch([db.prepare('DELETE FROM document_sources WHERE document_id = ?').bind(e.id), db.prepare('DELETE FROM document_versions WHERE document_id = ?').bind(e.id), db.prepare('DELETE FROM documents WHERE id = ?').bind(e.id)]);
    if (e.search_shard != null && repo.activeShards.includes(e.search_shard)) await repo.removeDocument(e.search_shard, e.id).catch(() => 0);
    merged++;
  }
  for (const g of groups.results ?? []) {
    const docs = (JSON.parse(g.docs) as Array<{ id: string; src: string; seen: string; shard: number | null }>).sort(
      (a, b) => (a.src === 'vineyard-civicclerk-meetings' ? 0 : 1) - (b.src === 'vineyard-civicclerk-meetings' ? 0 : 1) || String(a.seen).localeCompare(String(b.seen)),
    );
    const keep = docs[0];
    for (const dup of docs.slice(1)) {
      await db.batch([
        db.prepare('UPDATE OR IGNORE document_sources SET document_id = ? WHERE document_id = ?').bind(keep.id, dup.id),
        db.prepare('DELETE FROM document_sources WHERE document_id = ?').bind(dup.id),
        db.prepare('DELETE FROM document_versions WHERE document_id = ?').bind(dup.id),
        db.prepare('DELETE FROM document_relationships WHERE from_document_id = ? OR to_id = ?').bind(dup.id, dup.id),
        db.prepare('DELETE FROM documents WHERE id = ?').bind(dup.id),
      ]);
      if (dup.shard != null && repo.activeShards.includes(dup.shard)) await repo.removeDocument(dup.shard, dup.id).catch(() => 0);
      merged++;
    }
  }
  return { dated, merged };
}

/**
 * Resolutions and ordinances from the code site are numbered by year. They once took January 1 of
 * that year as a placeholder date; drop it, then take the adoption date from the record's own text
 * (signature block), or leave the year alone. A slice per run, so repeated migrates finish the job.
 */
async function fixRecordDates(env: Env): Promise<{ cleared: number; dated: number }> {
  const db = env.CATALOG_DB;
  const repo = new SearchRepository(env);
  const scope = "source_id = 'vineyard-municipal-code' AND document_type IN ('resolution','ordinance')";
  const c = await db.prepare(`UPDATE documents SET document_date = NULL WHERE ${scope} AND document_date LIKE '%-01-01'`).run();
  for (const [, sdb] of SearchRepository.boundShards(env)) await sdb.prepare(`UPDATE shard_documents SET document_date = NULL WHERE ${scope} AND document_date LIKE '%-01-01'`).run().catch(() => undefined);
  const rows = await db.prepare(`SELECT id, year, search_shard FROM documents WHERE ${scope} AND document_date IS NULL AND year IS NOT NULL AND search_shard IS NOT NULL ORDER BY random() LIMIT 300`).all<{ id: string; year: number; search_shard: number }>();
  let dated = 0;
  for (const d of rows.results ?? []) {
    if (!repo.activeShards.includes(d.search_shard)) continue;
    const t = await repo.shard(d.search_shard).prepare('SELECT group_concat(text, \' \') AS t FROM chunks WHERE document_id = ?').bind(d.id).first<{ t: string | null }>().catch(() => null);
    const date = adoptionDate(t?.t, Number(d.year));
    if (!date) continue;
    await db.prepare('UPDATE documents SET document_date = ? WHERE id = ?').bind(date, d.id).run();
    await repo.shard(d.search_shard).prepare('UPDATE shard_documents SET document_date = ? WHERE document_id = ?').bind(date, d.id).run().catch(() => undefined);
    dated++;
  }
  // City website files filed without a date get the one their title prints (newsletters, email
  // updates, notices), so "this year" questions find them.
  const undated = await db
    .prepare("SELECT id, title, search_shard FROM documents WHERE source_id = 'vineyard-city-website' AND document_date IS NULL AND title IS NOT NULL LIMIT 1500")
    .all<{ id: string; title: string; search_shard: number | null }>();
  let titled = 0;
  for (const d of undated.results ?? []) {
    const date = titleDate(d.title);
    if (!date || date > new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10)) continue;
    const year = Number(date.slice(0, 4));
    await db.prepare('UPDATE documents SET document_date = ?, year = ? WHERE id = ?').bind(date, year, d.id).run();
    if (d.search_shard != null && repo.activeShards.includes(d.search_shard))
      await repo.shard(d.search_shard).prepare('UPDATE shard_documents SET document_date = ?, year = ? WHERE document_id = ?').bind(date, year, d.id).run().catch(() => undefined);
    titled++;
  }
  // RDA audits, financial reports, budgets and plans filed without a body belong to the RDA.
  const rdaWhere = "government_body_id IS NULL AND document_type IN ('audit', 'financial_report', 'budget', 'plan', 'resolution', 'other') AND (title LIKE '%RDA%' OR lower(title) LIKE '%redevelopment%')";
  await db.prepare(`UPDATE documents SET government_body_id = 'redevelopment-agency' WHERE ${rdaWhere}`).run().catch(() => undefined);
  for (const [, sdb] of SearchRepository.boundShards(env)) await sdb.prepare(`UPDATE shard_documents SET government_body_id = 'redevelopment-agency' WHERE ${rdaWhere}`).run().catch(() => undefined);
  return { cleared: Number(c.meta?.changes ?? 0), dated: dated + titled };
}

async function migrate(env: Env): Promise<Response> {
  const catalog = splitSql(catalogSql);
  const search = splitSql(searchSql);
  const r1 = await env.CATALOG_DB.batch(catalog.map((q) => env.CATALOG_DB.prepare(q)));
  const shards: Record<string, number> = {};
  for (const [shard, db] of SearchRepository.boundShards(env)) {
    const r = await db.batch(search.map((q) => db.prepare(q)));
    shards[shard] = sum(r);
    // GIS summaries are current map data, not dated events (they once took the day they were read).
    await db.prepare("UPDATE shard_documents SET document_date = NULL, year = NULL WHERE source_id = 'vineyard-gis' AND document_date IS NOT NULL").run().catch(() => undefined);
  }
  await env.CATALOG_DB.prepare("UPDATE documents SET document_date = NULL, year = NULL, currency = 'current' WHERE source_id = 'vineyard-gis' AND document_date IS NOT NULL").run();
  const meetings = await mergeDuplicateMeetings(env).catch((e) => ({ error: String(e).slice(0, 200) }));
  const recordDates = await fixRecordDates(env).catch((e) => ({ error: String(e).slice(0, 200) }));
  // Voting records: the next sets of minutes are read (each migrate run continues the backfill).
  const votes = await processVotes(env, 55_000, 1000).catch((e) => ({ error: String(e).slice(0, 200) }));
  // Scanned files still waiting on text recognition (OCR) go back in the queue, fetched fresh, so
  // the next run with OCR on reads them (minutes first).
  const ocrDocs = "SELECT id FROM documents WHERE ocr_status = 'needed'";
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, etag = NULL, last_modified = NULL,
         priority = CASE WHEN url_key IN (SELECT ds.canonical_key FROM document_sources ds JOIN documents d ON d.id = ds.document_id WHERE d.document_type = 'minutes') THEN 1 ELSE priority END
       WHERE url_key IN (SELECT canonical_key FROM document_sources WHERE document_id IN (${ocrDocs})) AND status IN ('done', 'unchanged', 'error', 'skipped')`,
    ),
    env.CATALOG_DB.prepare(`UPDATE document_sources SET etag = NULL, last_modified = NULL WHERE document_id IN (${ocrDocs})`),
  ]).catch(() => undefined);
  // A meeting's own minutes or agenda that was once filed under an agenda-item attachment dated the same day
  // (see upsertDocument) is unlinked from it and read again as its own record.
  const strayDocs = "SELECT id FROM documents WHERE title LIKE '%, 20__-__-__)' OR title LIKE '%, 20__-__-__, item %)'";
  const strayKeys = `SELECT ds.canonical_key FROM document_sources ds JOIN crawl_queue q ON q.url_key = ds.canonical_key
    WHERE ds.document_id IN (${strayDocs}) AND q.source_id = 'vineyard-civicclerk-meetings' AND json_extract(q.metadata_json, '$.dedupeMeeting') = 1`;
  const strayOwn = `SELECT ds2.canonical_key FROM document_sources ds2 WHERE ds2.document_id IN (SELECT ds.document_id FROM document_sources ds WHERE ds.canonical_key IN (${strayKeys}))
    AND ds2.canonical_key NOT IN (${strayKeys})`;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, etag = NULL, last_modified = NULL
       WHERE url_key IN (${strayOwn}) AND status IN ('done', 'unchanged', 'error', 'skipped')`,
    ),
    env.CATALOG_DB.prepare(
      `UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, etag = NULL, last_modified = NULL, priority = 1
       WHERE url_key IN (${strayKeys}) AND status IN ('done', 'unchanged', 'error', 'skipped')`,
    ),
    env.CATALOG_DB.prepare(`DELETE FROM document_sources WHERE canonical_key IN (${strayKeys}) AND document_id IN (${strayDocs})`),
  ]).catch(() => undefined);
  // Files skipped only because a robots.txt answered 403 (ArcGIS, Amazon S3) go back in the queue.
  await env.CATALOG_DB.prepare("UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL WHERE status = 'skipped' AND last_error LIKE 'RobotsDisallowed%'").run().catch(() => undefined);
  await ensureActivityTables(env);
  // While no panel owner exists, each migrate run prints a fresh one-time setup code (24 hours).
  const panelSetupCode = await newSetupCode(env);
  return json({ ok: true, catalogStatements: catalog.length, searchStatements: search.length, rowsWritten: { catalog: sum(r1), shards }, meetings, recordDates, votes, ...(panelSetupCode ? { panelSetupCode } : {}) });
}

async function quota(env: Env): Promise<Response> {
  const budget = new Budget(env);
  const [usage, archive] = await Promise.all([
    env.CATALOG_DB.prepare('SELECT * FROM quota_usage WHERE day = ?').bind(utcDay()).first<Json>(),
    env.CATALOG_DB.prepare('SELECT * FROM archive_stats WHERE id = 1').first<Json>(),
  ]);
  return json({
    day: utcDay(),
    d1RowsWritten: Number(usage?.d1_rows_written ?? 0),
    d1RowBudget: budget.limit,
    archive: {
      available: Boolean(env.ARCHIVE),
      storedBytes: Number(archive?.stored_bytes ?? 0),
      storedObjects: Number(archive?.stored_objects ?? 0),
      deferred: Number(archive?.deferred_count ?? 0),
      hardStopBytes: intVar(env.ARCHIVE_STORAGE_HARD_STOP_BYTES, 6_000_000_000),
      maxObjectBytes: intVar(env.ARCHIVE_MAX_OBJECT_BYTES, 25 * 1024 * 1024),
    },
    aiRequests: Number(usage?.ai_requests ?? 0),
    searchShards: new SearchRepository(env).activeShards,
  });
}

async function upsertSources(env: Env, body: Json, budget: Budget): Promise<Response> {
  const list = Array.isArray(body.sources) ? (body.sources as Json[]) : [];
  if (!list.length || list.length > 200) throw badRequest('Provide 1-200 sources.');
  const now = nowIso();
  const stmts = list
    .filter((x) => idOk(x.id) && s(x.name) && s(x.baseUrl))
    .map((x) =>
      env.CATALOG_DB.prepare(
        `INSERT INTO sources (id, name, base_url, source_type, authority, discovered_from, crawl_enabled, archive_enabled, document_discovery_enabled, description, notes, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, base_url = excluded.base_url, source_type = excluded.source_type, authority = excluded.authority,
           discovered_from = excluded.discovered_from, crawl_enabled = excluded.crawl_enabled, archive_enabled = excluded.archive_enabled,
           document_discovery_enabled = excluded.document_discovery_enabled, description = excluded.description, notes = excluded.notes, updated_at = excluded.updated_at
         WHERE sources.name IS NOT excluded.name OR sources.base_url IS NOT excluded.base_url OR sources.notes IS NOT excluded.notes OR sources.crawl_enabled IS NOT excluded.crawl_enabled
           OR sources.description IS NOT excluded.description OR sources.source_type IS NOT excluded.source_type`,
      ).bind(
        x.id,
        s(x.name, 200),
        s(x.baseUrl, 500),
        s(x.sourceType, 40) ?? 'other',
        s(x.authority, 200) ?? 'Vineyard City',
        s(x.discoveredFrom, 500),
        x.crawlEnabled === false ? 0 : 1,
        x.archiveEnabled === false ? 0 : 1,
        x.documentDiscoveryEnabled === false ? 0 : 1,
        s(x.description, 1000),
        s(x.notes, 2000) ?? '',
        now,
        now,
      ),
    );
  const retire = (Array.isArray(body.retire) ? body.retire : []).filter(idOk).slice(0, 50);
  for (const id of retire) stmts.push(env.CATALOG_DB.prepare('DELETE FROM sources WHERE id = ? AND NOT EXISTS (SELECT 1 FROM documents WHERE source_id = ?)').bind(id, id));
  const rows = sum(await env.CATALOG_DB.batch(stmts));
  await budget.record(rows);
  return json({ ok: true, upserted: stmts.length - retire.length, retired: retire, rowsWritten: rows });
}

async function sourceStatus(env: Env, body: Json, budget: Budget): Promise<Response> {
  const list = Array.isArray(body.statuses) ? (body.statuses as Json[]) : [];
  const now = nowIso();
  const stmts = list
    .filter((x) => idOk(x.id))
    .slice(0, 200)
    .map((x) =>
      env.CATALOG_DB.prepare(
        `UPDATE sources SET status = ?, status_message = ?, last_checked_at = ?, last_success_at = CASE WHEN ? = 'active' THEN ? ELSE last_success_at END WHERE id = ?`,
      ).bind(s(x.status, 40) ?? 'unknown', s(x.message, 500), now, s(x.status, 40) ?? 'unknown', now, x.id),
    );
  const rows = stmts.length ? sum(await env.CATALOG_DB.batch(stmts)) : 0;
  await budget.record(rows);
  return json({ ok: true, rowsWritten: rows });
}

export async function upsertBodies(env: Env, body: Json, budget: Budget): Promise<Response> {
  const list = (Array.isArray(body.bodies) ? (body.bodies as Json[]) : []).filter((x) => idOk(x.id) && s(x.name)).slice(0, 200);
  const stmts = list.map((x) =>
    env.CATALOG_DB.prepare(
      `INSERT INTO government_bodies (id, slug, name, short_name, kind, description) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind WHERE government_bodies.name IS NOT excluded.name OR government_bodies.kind IS NOT excluded.kind`,
    ).bind(x.id, x.id, s(x.name, 200), s(x.shortName, 60), s(x.kind, 20) ?? 'other', s(x.description, 1000) ?? ''),
  );
  const rows = stmts.length ? sum(await env.CATALOG_DB.batch(stmts)) : 0;
  await budget.record(rows);
  return json({ ok: true, rowsWritten: rows });
}

export async function upsertMeetings(env: Env, body: Json, budget: Budget): Promise<Response> {
  const list = (Array.isArray(body.meetings) ? (body.meetings as Json[]) : []).filter((x) => idOk(x.id) && s(x.title) && idOk(x.sourceId)).slice(0, 100);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const m of list) {
    const media = JSON.stringify(Array.isArray(m.media) ? (m.media as Json[]).slice(0, 10) : []);
    stmts.push(
      env.CATALOG_DB.prepare(
        `INSERT INTO meetings (id, slug, title, government_body_id, government_body_name, meeting_type, meeting_date, start_time, location, status,
           agenda_document_id, packet_document_id, minutes_document_id, minutes_status, source_id, source_url, external_id, media_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'not_available', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, government_body_id = excluded.government_body_id, government_body_name = excluded.government_body_name,
           meeting_type = excluded.meeting_type, meeting_date = excluded.meeting_date, start_time = excluded.start_time, location = excluded.location, status = excluded.status,
           media_json = excluded.media_json, source_url = excluded.source_url, updated_at = excluded.updated_at
         WHERE meetings.title IS NOT excluded.title OR meetings.meeting_date IS NOT excluded.meeting_date OR meetings.start_time IS NOT excluded.start_time
           OR meetings.location IS NOT excluded.location OR meetings.status IS NOT excluded.status OR meetings.media_json IS NOT excluded.media_json
           OR meetings.government_body_id IS NOT excluded.government_body_id`,
      ).bind(
        m.id,
        s(m.slug, 150) ?? m.id,
        s(m.title, 300),
        s(m.governmentBodyId, 128),
        s(m.governmentBodyName, 200),
        s(m.meetingType, 20) ?? 'other',
        s(m.date, 10),
        s(m.startTime, 10),
        s(m.location, 300),
        s(m.status, 20) ?? 'unknown',
        m.sourceId,
        s(m.sourceUrl, 800),
        s(m.externalId, 100),
        media,
        now,
        now,
      ),
    );
  }
  const rows = stmts.length ? sum(await env.CATALOG_DB.batch(stmts)) : 0;
  await budget.record(rows);
  return json({ ok: true, upserted: list.length, rowsWritten: rows });
}

export async function upsertQueue(env: Env, body: Json, budget: Budget): Promise<Response> {
  const items = (Array.isArray(body.items) ? (body.items as Json[]) : []).filter((x) => typeof x.urlKey === 'string' && /^[0-9a-f]{64}$/.test(x.urlKey) && s(x.url) && idOk(x.sourceId));
  if (items.length > 500) throw badRequest('At most 500 queue items per request.');
  const now = nowIso();
  const payload = JSON.stringify(
    items.map((x) => ({ k: x.urlKey, s: x.sourceId, u: s(x.url, 1500), kind: s(x.kind, 20) ?? 'document', p: n(x.priority) ?? 100, parent: s(x.parentUrl, 1500), m: JSON.stringify(x.metadata ?? {}).slice(0, 8000), run: s(x.runId, 64) })),
  );
  // New URLs are inserted; known URLs only get metadata refreshed when it actually changed, which keeps daily re-discovery nearly free.
  const r = await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `INSERT INTO crawl_queue (url_key, source_id, url, kind, status, priority, parent_url, metadata_json, run_id, discovered_at, updated_at)
       SELECT json_extract(value,'$.k'), json_extract(value,'$.s'), json_extract(value,'$.u'), json_extract(value,'$.kind'), 'pending', json_extract(value,'$.p'),
              json_extract(value,'$.parent'), json_extract(value,'$.m'), json_extract(value,'$.run'), ?, ?
       FROM json_each(?) WHERE true
       ON CONFLICT(url_key) DO UPDATE SET url = excluded.url, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at,
         priority = CASE WHEN crawl_queue.run_id = 'hourly' THEN min(crawl_queue.priority, excluded.priority) ELSE excluded.priority END,
         status = CASE WHEN (crawl_queue.url IS NOT excluded.url
                              OR json_extract(crawl_queue.metadata_json, '$.refreshToken') IS NOT json_extract(excluded.metadata_json, '$.refreshToken'))
                             AND crawl_queue.status IN ('done','unchanged','skipped') THEN 'pending' ELSE crawl_queue.status END
       WHERE crawl_queue.metadata_json IS NOT excluded.metadata_json OR crawl_queue.url IS NOT excluded.url`,
    ).bind(now, now, payload),
  ]);
  const rows = sum(r);
  await budget.record(rows);
  return json({ ok: true, received: items.length, rowsWritten: rows });
}

async function listQueue(env: Env, url: URL): Promise<Response> {
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'error', 'deferred', 'done', 'unchanged', 'skipped'].includes(status)) throw badRequest('Bad status.');
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  const source = url.searchParams.get('source');
  const maxAttempts = Number(url.searchParams.get('maxAttempts') ?? 5);
  // Parallel runners each take a slice of the queue by the first hex digit of the URL key.
  const shards = Math.min(16, Math.max(0, Number(url.searchParams.get('shards') ?? 0) || 0));
  const shard = Math.max(0, Number(url.searchParams.get('shard') ?? 0) || 0);
  const slice = shards > 1 ? ` AND ((instr('0123456789abcdef', substr(q.url_key, 1, 1)) - 1) % ${shards}) = ${shard % shards}` : '';
  const res = await env.CATALOG_DB.prepare(
    `SELECT q.*, (SELECT ds.etag FROM document_sources ds WHERE ds.canonical_key = q.url_key LIMIT 1) AS known_etag,
            (SELECT ds.last_modified FROM document_sources ds WHERE ds.canonical_key = q.url_key LIMIT 1) AS known_last_modified,
            (SELECT ds.document_id FROM document_sources ds WHERE ds.canonical_key = q.url_key LIMIT 1) AS known_document_id
     FROM crawl_queue q WHERE q.status = ? ${source ? 'AND q.source_id = ?' : ''} AND q.attempts < ?${slice}
       AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= ?)
     ORDER BY q.priority, q.discovered_at LIMIT ?`,
  )
    .bind(...(source ? [status, source] : [status]), maxAttempts, nowIso(), limit)
    .all<Json>();
  const counts = await env.CATALOG_DB.prepare('SELECT status, count(*) AS n FROM crawl_queue GROUP BY status').all<{ status: string; n: number }>();
  return json({ items: res.results ?? [], counts: Object.fromEntries((counts.results ?? []).map((c) => [c.status, Number(c.n)])) });
}

async function queueStatus(env: Env, body: Json, budget: Budget): Promise<Response> {
  const updates = (Array.isArray(body.updates) ? (body.updates as Json[]) : []).filter((x) => typeof x.urlKey === 'string' && /^[0-9a-f]{64}$/.test(x.urlKey)).slice(0, 200);
  const now = nowIso();
  const stmts = updates.map((u) =>
    env.CATALOG_DB.prepare(
      `UPDATE crawl_queue SET status = ?, document_id = coalesce(?, document_id), etag = coalesce(?, etag), last_modified = coalesce(?, last_modified),
         sha256 = coalesce(?, sha256), attempts = attempts + ?, last_attempt_at = ?, next_attempt_at = ?, last_error = ?, run_id = coalesce(?, run_id), updated_at = ?
       WHERE url_key = ?`,
    ).bind(
      s(u.status, 20) ?? 'pending',
      s(u.documentId, 64),
      s(u.etag, 200),
      s(u.lastModified, 100),
      s(u.sha256, 64),
      u.countAttempt === false ? 0 : 1,
      now,
      s(u.nextAttemptAt, 40),
      s(u.error, 500),
      s(u.runId, 64),
      now,
      u.urlKey,
    ),
  );
  const rows = stmts.length ? sum(await env.CATALOG_DB.batch(stmts)) : 0;
  await budget.record(rows);
  return json({ ok: true, rowsWritten: rows });
}

async function retryErrors(env: Env, budget: Budget): Promise<Response> {
  const r = await env.CATALOG_DB.prepare("UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, updated_at = ? WHERE status = 'error'").bind(nowIso()).run();
  const rows = Number(r.meta?.rows_written ?? 0);
  await budget.record(rows);
  return json({ ok: true, reset: r.meta?.changes ?? 0 });
}

/**
 * Registers a fetched record. The server decides, from the catalog, whether this is a new
 * document, a new version of a known URL, a duplicate binary found at another URL, or unchanged.
 */
async function upsertDocument(env: Env, body: Json, budget: Budget): Promise<Response> {
  const d = (body.document ?? {}) as Json;
  const src = (body.source ?? {}) as Json;
  const canonicalKey = s(src.canonicalKey, 64);
  const sourceId = src.sourceId;
  const sourceUrl = s(src.url, 1500);
  if (!canonicalKey || !/^[0-9a-f]{64}$/.test(canonicalKey) || !idOk(sourceId) || !sourceUrl) throw badRequest('source.canonicalKey, source.sourceId and source.url are required.');
  const sha = s(d.sha256, 64);
  if (sha && !/^[0-9a-f]{64}$/.test(sha)) throw badRequest('Invalid sha256.');
  const title = s(d.title, 500);
  if (!title) throw badRequest('document.title is required.');
  const now = nowIso();
  const db = env.CATALOG_DB;
  const repo = new SearchRepository(env);
  const retrievedAt = s(src.retrievedAt, 40) ?? now;
  const docType = normalizeType(d.documentType);
  const categories = Array.isArray(d.categories) && d.categories.length ? d.categories : categoriesForType(docType);

  const docIdCache = { id: '' };
  const sourceRow = () =>
    db
      .prepare(
        `INSERT INTO document_sources (id, document_id, source_id, source_url, canonical_key, parent_url, link_text, retrieved_at, last_verified_at, etag, last_modified, http_status, original_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(document_id, canonical_key) DO UPDATE SET source_url = excluded.source_url, last_verified_at = excluded.last_verified_at, etag = excluded.etag,
           last_modified = excluded.last_modified, http_status = excluded.http_status, original_available = 1`,
      )
      .bind(`src_${canonicalKey.slice(0, 16)}_${docIdCache.id.slice(4, 12)}`, docIdCache.id, sourceId, sourceUrl, canonicalKey, s(src.parentUrl, 1500), s(src.linkText, 500), retrievedAt, now, s(src.etag, 200), s(src.lastModified, 100), n(src.httpStatus));

  // An agenda-item attachment ("..., 2026-06-23, item 1)") is never a meeting's own record, however its title reads.
  const ATTACHMENT_TITLE = /, 20\d\d-\d\d-\d\d(, item [^)]*)?\)$/;
  const isAttachment = ATTACHMENT_TITLE.test(title);
  let known = await db.prepare('SELECT d.* FROM document_sources ds JOIN documents d ON d.id = ds.document_id WHERE ds.canonical_key = ? LIMIT 1').bind(canonicalKey).first<Json>();
  if (known && !isAttachment && ATTACHMENT_TITLE.test(String(known.title))) {
    // This meeting file was once filed under an attachment record: unlink it, and read the attachment's own file again.
    await db.batch([
      db.prepare(`UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, etag = NULL, last_modified = NULL WHERE url_key IN (SELECT canonical_key FROM document_sources WHERE document_id = ? AND canonical_key <> ?)`).bind(known.id, canonicalKey),
      db.prepare('DELETE FROM document_sources WHERE canonical_key = ? AND document_id = ?').bind(canonicalKey, known.id),
    ]);
    known = null;
  }
  if (known && isAttachment && !ATTACHMENT_TITLE.test(String(known.title)) && sha && known.sha256 !== sha) {
    // An attachment must not overwrite a meeting's own record it was once filed under: it gets a record of its own.
    await db.prepare('DELETE FROM document_sources WHERE canonical_key = ? AND document_id = ?').bind(canonicalKey, known.id).run();
    known = null;
  }
  const id = `doc_${(await sha256Hex(`vtp:${canonicalKey}`)).slice(0, 16)}`;
  if (!known) {
    // A record already filed under this file's own id (its source link having been lost) is that same record, not a new one;
    // whatever else was filed under it is read again, so the record holds this file's content alone.
    known = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Json>();
    if (known) {
      await db
        .prepare(`UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, etag = NULL, last_modified = NULL WHERE url_key IN (SELECT canonical_key FROM document_sources WHERE document_id = ? AND canonical_key <> ?) AND status IN ('done', 'unchanged', 'error', 'skipped')`)
        .bind(known.id, canonicalKey)
        .run();
    }
  }

  if (known) {
    docIdCache.id = String(known.id);
    if (!sha || known.sha256 === sha) {
      // Unchanged content. Refresh verification + fill metadata gaps only.
      const r = await db.batch([
        sourceRow(),
        db
          .prepare(
            `UPDATE documents SET last_seen_at = ?, original_available = 1, meeting_id = coalesce(meeting_id, ?), government_body_id = coalesce(government_body_id, ?),
               government_body_name = coalesce(government_body_name, ?), document_date = coalesce(document_date, ?), year = coalesce(year, ?) WHERE id = ?`,
          )
          .bind(now, s(d.meetingId, 128), s(d.governmentBodyId, 128), s(d.governmentBodyName, 200), s(d.documentDate, 10), n(d.year), known.id),
      ]);
      const rows = sum(r);
      await budget.record(rows);
      return json({ status: 'unchanged', documentId: known.id, shard: known.search_shard, needsChunks: (Number(known.chunk_count ?? 0) === 0 && known.text_status !== 'empty' && known.text_status !== 'unsupported') || known.ocr_status === 'needed', needsArchive: known.archive_status !== 'archived', rowsWritten: rows });
    }
    // Same URL, different bytes: a new version. The old version row keeps its hash and archive key.
    const version = Number(known.current_version ?? 1) + 1;
    const r = await db.batch([
      db
        .prepare(
          `INSERT INTO document_versions (id, document_id, version_number, sha256, previous_sha256, source_url, file_size, page_count, retrieved_at, archive_key, change_status, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'replaced', 'Content at the source URL changed.') ON CONFLICT DO NOTHING`,
        )
        .bind(`${known.id}:v${version}`, known.id, version, sha, known.sha256, sourceUrl, n(d.fileSize), n(d.pageCount), retrievedAt),
      db
        .prepare(
          `UPDATE documents SET sha256 = ?, file_size = ?, page_count = ?, current_version = ?, archive_key = NULL, archive_status = 'not_archived', archived_at = NULL,
             text_status = ?, ocr_status = ?, updated_at = ?, last_seen_at = ?, mime_type = ?, original_url = ?,
             title = ?, document_date = coalesce(?, document_date), year = coalesce(?, year), currency = coalesce(?, currency) WHERE id = ?`,
        )
        .bind(sha, n(d.fileSize), n(d.pageCount), version, s(d.textStatus, 20) ?? 'pending', s(d.ocrStatus, 20) ?? 'not_required', now, now, s(d.mimeType, 100) ?? known.mime_type, sourceUrl, title, s(d.documentDate, 10), n(d.year), s(d.currency, 20), known.id),
      sourceRow(),
    ]);
    const rows = sum(r);
    await budget.record(rows);
    return json({ status: 'new_version', documentId: known.id, version, shard: known.search_shard, needsChunks: true, needsArchive: true, rowsWritten: rows });
  }

  // One record per meeting: the same minutes or agenda from a second source (CivicClerk and the
  // municipal code site both carry them) attach to the record already indexed for that meeting.
  // A file attached to an agenda item ("..., 2026-06-23, item 1)") is not the meeting's own record: the
  // June 9 draft minutes attached to the June 23 agenda must not swallow the June 23 minutes.
  const meetingDate = s(d.documentDate, 10);
  const meetingBody = s(d.governmentBodyId, 128);
  if (d.dedupeMeeting === true && ['minutes', 'agenda', 'agenda_packet'].includes(docType) && meetingDate && meetingBody) {
    const special = /\bspecial\b/i.test(title) ? 1 : 0;
    const same = await db
      .prepare(
        `SELECT * FROM documents WHERE document_type = ? AND document_date = ? AND government_body_id = ?
           AND (CASE WHEN lower(title) LIKE '%special%' THEN 1 ELSE 0 END) = ?
           AND title NOT LIKE '%, 20__-__-__)' AND title NOT LIKE '%, 20__-__-__, item %)' ORDER BY first_seen_at LIMIT 1`,
      )
      .bind(docType, meetingDate, meetingBody, special)
      .first<Json>();
    if (same) {
      docIdCache.id = String(same.id);
      const r = await db.batch([sourceRow(), db.prepare('UPDATE documents SET last_seen_at = ?, meeting_id = coalesce(meeting_id, ?) WHERE id = ?').bind(now, s(d.meetingId, 128), same.id)]);
      const rows = sum(r);
      await budget.record(rows);
      return json({ status: 'duplicate', documentId: same.id, shard: same.search_shard, needsChunks: false, needsArchive: false, rowsWritten: rows });
    }
  }

  if (sha) {
    const dup = await db
      .prepare(isAttachment ? 'SELECT * FROM documents WHERE sha256 = ? LIMIT 1' : "SELECT * FROM documents WHERE sha256 = ? AND title NOT LIKE '%, 20__-__-__)' AND title NOT LIKE '%, 20__-__-__, item %)' LIMIT 1")
      .bind(sha)
      .first<Json>();
    if (dup) {
      docIdCache.id = String(dup.id);
      const r = await db.batch([
        sourceRow(),
        db.prepare('UPDATE documents SET last_seen_at = ?, meeting_id = coalesce(meeting_id, ?), government_body_id = coalesce(government_body_id, ?), government_body_name = coalesce(government_body_name, ?) WHERE id = ?').bind(now, s(d.meetingId, 128), s(d.governmentBodyId, 128), s(d.governmentBodyName, 200), dup.id),
      ]);
      const rows = sum(r);
      await budget.record(rows);
      return json({ status: 'duplicate', documentId: dup.id, shard: dup.search_shard, needsChunks: Number(dup.chunk_count ?? 0) === 0 && dup.text_status !== 'empty' && dup.text_status !== 'unsupported', needsArchive: dup.archive_status !== 'archived', rowsWritten: rows });
    }
  }

  docIdCache.id = id;
  const shard = repo.available ? repo.assignShard(id) : null;
  // The web address of a record: its title plus a short mark of its id, lengthened if another record already holds it.
  let slug = `${slugify(title)}-${id.slice(4, 10)}`;
  if (await db.prepare('SELECT 1 FROM documents WHERE slug = ? LIMIT 1').bind(slug).first()) slug = `${slugify(title)}-${id.slice(4)}`;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO documents (id, slug, title, description, document_type, document_number, document_date, year, government_body_id, government_body_name, meeting_id, agenda_item_id,
           source_id, mime_type, original_filename, file_size, page_count, sha256, original_url, canonical_key, archive_key, archive_status, text_status, ocr_status, categories_json, tags_json,
           currency, current_version, search_shard, chunk_count, character_count, original_available, created_at, updated_at, first_seen_at, last_seen_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, 1, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        id,
        slug,
        title,
        s(d.description, 2000),
        docType,
        s(d.documentNumber, 100),
        s(d.documentDate, 10),
        n(d.year),
        s(d.governmentBodyId, 128),
        s(d.governmentBodyName, 200),
        s(d.meetingId, 128),
        s(d.agendaItemId, 128),
        sourceId,
        s(d.mimeType, 100) ?? 'application/octet-stream',
        s(d.fileName, 300) ?? '',
        n(d.fileSize),
        n(d.pageCount),
        sha,
        sourceUrl,
        canonicalKey,
        s(d.archiveStatus, 30) ?? 'not_archived',
        s(d.textStatus, 20) ?? 'pending',
        s(d.ocrStatus, 20) ?? 'not_required',
        JSON.stringify(categories),
        JSON.stringify(Array.isArray(d.tags) ? d.tags.slice(0, 20) : []),
        s(d.currency, 20) ?? 'unknown',
        shard,
        now,
        now,
        now,
        now,
      ),
    sourceRow(),
  ];
  if (sha)
    stmts.push(
      db
        .prepare(`INSERT INTO document_versions (id, document_id, version_number, sha256, source_url, file_size, page_count, retrieved_at, change_status) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'original') ON CONFLICT DO NOTHING`)
        .bind(`${id}:v1`, id, sha, sourceUrl, n(d.fileSize), n(d.pageCount), retrievedAt),
    );
  for (const rel of (Array.isArray(body.relationships) ? (body.relationships as Json[]) : []).slice(0, 20)) {
    if (!s(rel.type, 40) || !idOk(rel.toId)) continue;
    stmts.push(
      db
        .prepare(`INSERT INTO document_relationships (id, from_document_id, relationship_type, to_kind, to_id, to_title, basis, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?) ON CONFLICT DO NOTHING`)
        .bind(`rel_${(await sha256Hex(`${id}|${rel.type}|${rel.toId}`)).slice(0, 16)}`, id, s(rel.type, 40), s(rel.toKind, 20) ?? 'meeting', rel.toId, s(rel.toTitle, 300) ?? '', s(rel.basis, 30) ?? 'source_structure', now),
    );
  }
  // Meeting pointers (agenda / packet / minutes) come from source structure, e.g. CivicClerk file types.
  const role = s(body.meetingRole, 20);
  const meetingId = s(d.meetingId, 128);
  if (meetingId && role && ['agenda', 'packet', 'minutes'].includes(role)) {
    const col = role === 'agenda' ? 'agenda_document_id' : role === 'packet' ? 'packet_document_id' : 'minutes_document_id';
    stmts.push(db.prepare(`UPDATE meetings SET ${col} = ?, minutes_status = CASE WHEN ? = 'minutes' THEN 'approved' ELSE minutes_status END WHERE id = ?`).bind(id, role, meetingId));
  }
  const r = await db.batch(stmts);
  const rows = sum(r);
  await budget.record(rows);
  return json({ status: 'new', documentId: id, shard, needsChunks: true, needsArchive: true, rowsWritten: rows }, { status: 201 });
}

async function putChunks(env: Env, id: string, body: Json, budget: Budget): Promise<Response> {
  const doc = await env.CATALOG_DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Json>();
  if (!doc) throw notFound('Unknown document.');
  const repo = new SearchRepository(env);
  if (doc.search_shard == null) {
    if (!repo.available) throw new HttpError(503, 'search_unavailable', 'No search shard configured.');
    const shard = repo.assignShard(id);
    await env.CATALOG_DB.prepare('UPDATE documents SET search_shard = ? WHERE id = ?').bind(shard, id).run();
    doc.search_shard = shard;
  }
  const raw = Array.isArray(body.chunks) ? (body.chunks as Json[]) : [];
  if (raw.length > 400) throw badRequest('At most 400 chunks per request.');
  const chunks: ChunkInput[] = raw
    .filter((c) => typeof c.text === 'string' && c.text.trim())
    .map((c, i) => ({
      id: typeof c.id === 'string' && /^doc_[0-9a-f]{16}:c\d{4,6}$/.test(c.id) && c.id.startsWith(`${id}:`) ? c.id : `${id}:c${String(Number(body.offset ?? 0) + i).padStart(5, '0')}`,
      pageStart: n(c.pageStart),
      pageEnd: n(c.pageEnd),
      sectionTitle: s(c.sectionTitle, 300),
      text: String(c.text).slice(0, 12000),
      ocr: c.ocr === true,
    }));
  const append = body.append === true;
  // Rough pre-check: each chunk costs ~4 rows (row, index, FTS docsize, FTS segments).
  await budget.check(chunks.length * 4);
  // D1 Free databases stop at 500 MB. Pause indexing cleanly (the ingest job stops and resumes
  // later) before a search shard gets there; adding the next shard lets it continue.
  if (!append || Number(body.offset ?? 0) === 0) {
    const probe = await repo.shard(Number(doc.search_shard)).prepare('SELECT 1').run();
    const size = Number((probe.meta as { size_after?: number } | undefined)?.size_after ?? 0);
    if (size > intVar(env.SEARCH_SHARD_MAX_BYTES, 460_000_000)) {
      throw new HttpError(429, 'quota_exhausted', `Search shard ${doc.search_shard} is nearly full (${Math.round(size / 1e6)} MB). Add the next search shard to continue indexing.`);
    }
  }
  const categories = (() => {
    try {
      return JSON.parse(String(doc.categories_json ?? '[]')) as string[];
    } catch {
      return [];
    }
  })();
  const rows = await repo.replaceDocument(
    Number(doc.search_shard),
    {
      documentId: id,
      title: String(doc.title),
      documentType: String(doc.document_type),
      documentNumber: (doc.document_number as string | null) ?? null,
      documentDate: (doc.document_date as string | null) ?? null,
      year: n(doc.year),
      governmentBodyId: (doc.government_body_id as string | null) ?? null,
      sourceId: String(doc.source_id),
      meetingId: (doc.meeting_id as string | null) ?? null,
      categories,
      currency: String(doc.currency ?? 'unknown'),
    },
    chunks,
    append,
  );
  const total = await repo.chunkCount(Number(doc.search_shard), id);
  const chars = chunks.reduce((t, c) => t + c.text.length, 0);
  // New text for minutes: the voting records read them again on the next pass.
  if (!append) await env.CATALOG_DB.prepare('DELETE FROM vote_docs WHERE document_id = ?').bind(id).run().catch(() => undefined);
  const u = await env.CATALOG_DB.prepare(
    `UPDATE documents SET chunk_count = ?, character_count = CASE WHEN ? THEN character_count + ? ELSE ? END, text_status = ?, ocr_status = coalesce(?, ocr_status), updated_at = ? WHERE id = ?`,
  )
    .bind(total, append ? 1 : 0, chars, chars, total > 0 ? 'extracted' : 'empty', s(body.ocrStatus, 20), nowIso(), id)
    .run();
  const written = rows + Number(u.meta?.rows_written ?? 0);
  await budget.record(written);
  return json({ ok: true, documentId: id, shard: doc.search_shard, chunks: total, rowsWritten: written });
}

async function patchDocument(env: Env, id: string, body: Json, budget: Budget): Promise<Response> {
  const allowed: Record<string, string> = { archiveStatus: 'archive_status', textStatus: 'text_status', ocrStatus: 'ocr_status', pageCount: 'page_count' };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, col] of Object.entries(allowed)) {
    if (body[k] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(k === 'pageCount' ? n(body[k]) : s(body[k], 30));
  }
  if (!sets.length) throw badRequest('Nothing to update.');
  const r = await env.CATALOG_DB.prepare(`UPDATE documents SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...params, nowIso(), id).run();
  await budget.record(Number(r.meta?.rows_written ?? 0));
  return json({ ok: true, changed: r.meta?.changes ?? 0 });
}

async function sourceAvailability(env: Env, body: Json, budget: Budget): Promise<Response> {
  const list = (Array.isArray(body.items) ? (body.items as Json[]) : []).filter((x) => typeof x.canonicalKey === 'string' && /^[0-9a-f]{64}$/.test(x.canonicalKey)).slice(0, 200);
  const now = nowIso();
  const stmts = list.flatMap((x) => {
    const available = x.available === true ? 1 : 0;
    return [
      env.CATALOG_DB.prepare('UPDATE document_sources SET original_available = ?, http_status = ?, last_verified_at = ? WHERE canonical_key = ?').bind(available, n(x.httpStatus), now, x.canonicalKey),
      env.CATALOG_DB.prepare('UPDATE documents SET original_available = ? WHERE id IN (SELECT document_id FROM document_sources WHERE canonical_key = ?)').bind(available, x.canonicalKey),
    ];
  });
  const rows = stmts.length ? sum(await env.CATALOG_DB.batch(stmts)) : 0;
  await budget.record(rows);
  return json({ ok: true, rowsWritten: rows });
}

async function putArchive(env: Env, request: Request, sha: string, url: URL, budget: Budget): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw badRequest('Invalid sha256.');
  const storage = storageFor(env.ARCHIVE);
  if (!storage.available) return json({ status: 'unavailable', message: 'No archive bucket is bound.' }, { status: 409 });
  const size = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isFinite(size) || size <= 0) throw badRequest('Content-Length is required.');
  const maxObject = intVar(env.ARCHIVE_MAX_OBJECT_BYTES, 25 * 1024 * 1024);
  const ext = (url.searchParams.get('ext') ?? 'bin').toLowerCase();
  const contentType = (request.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].slice(0, 100);
  const key = archiveKey(sha, ext);
  const db = env.CATALOG_DB;

  const markDocs = (status: string, withKey: boolean) =>
    db
      .prepare(`UPDATE documents SET archive_status = ?, archive_key = ${withKey ? '?' : 'archive_key'}, archived_at = ${withKey ? '?' : 'archived_at'} WHERE sha256 = ? AND archive_status != 'archived'`)
      .bind(...(withKey ? [status, key, nowIso(), sha] : [status, sha]));

  if (size > maxObject) {
    const r = await markDocs('remote_only_large_file', false).run();
    await budget.record(Number(r.meta?.rows_written ?? 0));
    return json({ status: 'remote_only_large_file', maxObjectBytes: maxObject }, { status: 413 });
  }

  const existing = await storage.head(key);
  if (existing) {
    const r = await db.batch([markDocs('archived', true), db.prepare('UPDATE document_versions SET archive_key = ? WHERE sha256 = ? AND archive_key IS NULL').bind(key, sha)]);
    await budget.record(sum(r));
    return json({ status: 'exists', key, size: existing.size });
  }

  const stats = await db.prepare('SELECT stored_bytes FROM archive_stats WHERE id = 1').first<{ stored_bytes: number }>();
  const hardStop = intVar(env.ARCHIVE_STORAGE_HARD_STOP_BYTES, 6_000_000_000);
  const projected = Number(stats?.stored_bytes ?? 0) + size;
  if (projected > hardStop) {
    const r = await db.batch([markDocs('quota_deferred', false), db.prepare('UPDATE archive_stats SET deferred_count = deferred_count + 1, updated_at = ? WHERE id = 1').bind(nowIso())]);
    await budget.record(sum(r));
    console.warn(JSON.stringify({ event: 'archive_quota_deferred', sha, size, projected, hardStop }));
    return json({ status: 'quota_deferred', projectedBytes: projected, hardStopBytes: hardStop }, { status: 409 });
  }

  if (!request.body) throw badRequest('Missing body.');
  await budget.check(5);
  const stored = await storage.put(key, request.body, size, contentType, sha);
  const r = await db.batch([
    markDocs('archived', true),
    db.prepare('UPDATE document_versions SET archive_key = ? WHERE sha256 = ? AND archive_key IS NULL').bind(key, sha),
    db.prepare('UPDATE archive_stats SET stored_bytes = stored_bytes + ?, stored_objects = stored_objects + 1, updated_at = ? WHERE id = 1').bind(stored.size, nowIso()),
  ]);
  await budget.record(sum(r), { r2Bytes: stored.size, r2Ops: 1 });
  return json({ status: 'archived', key, size: stored.size }, { status: 201 });
}

async function runs(env: Env, id: string | null, body: Json, budget: Budget): Promise<Response> {
  const now = nowIso();
  if (!id) {
    const runId = s(body.id, 64) ?? `run_${Date.now()}`;
    const r = await env.CATALOG_DB.prepare('INSERT INTO crawl_runs (id, trigger, started_at, status, sources_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(runId, s(body.trigger, 40) ?? 'manual', now, 'running', JSON.stringify(body.sources ?? []))
      .run();
    await budget.record(Number(r.meta?.rows_written ?? 0));
    return json({ ok: true, id: runId });
  }
  const fields = ['discovered', 'fetched', 'ingested', 'unchanged', 'duplicates', 'errors', 'bytes_archived'];
  const c = (body.counts ?? {}) as Json;
  const r = await env.CATALOG_DB.prepare(
    `UPDATE crawl_runs SET status = coalesce(?, status), finished_at = CASE WHEN ? IN ('completed','failed','budget_reached','interrupted') THEN ? ELSE finished_at END,
       ${fields.map((f) => `${f} = coalesce(?, ${f})`).join(', ')}, last_processed_url = coalesce(?, last_processed_url), message = coalesce(?, message) WHERE id = ?`,
  )
    .bind(s(body.status, 30), s(body.status, 30) ?? '', now, ...fields.map((f) => n(c[f])), s(body.lastProcessedUrl, 1500), s(body.message, 1000), id)
    .run();
  await budget.record(Number(r.meta?.rows_written ?? 0));
  return json({ ok: true });
}

async function errors(env: Env, body: Json, budget: Budget): Promise<Response> {
  const list = (Array.isArray(body.errors) ? (body.errors as Json[]) : []).slice(0, 100);
  const now = nowIso();
  const stmts = list
    .filter((e) => s(e.url))
    .map((e) =>
      env.CATALOG_DB.prepare('INSERT INTO ingestion_errors (run_id, source_id, url, occurred_at, http_status, error_type, message, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
        s(e.runId, 64),
        s(e.sourceId, 128),
        s(e.url, 1500),
        now,
        n(e.httpStatus),
        s(e.errorType, 60) ?? 'error',
        s(e.message, 1000),
        n(e.retryCount) ?? 0,
      ),
    );
  const rows = stmts.length ? sum(await env.CATALOG_DB.batch(stmts)) : 0;
  await budget.record(rows);
  return json({ ok: true, rowsWritten: rows });
}

async function optimize(env: Env, budget: Budget): Promise<Response> {
  const repo = new SearchRepository(env);
  const out: Record<number, number> = {};
  for (const shard of repo.activeShards) out[shard] = await repo.optimize(shard);
  await budget.record(Object.values(out).reduce((a, b) => a + b, 0));
  return json({ ok: true, rowsWritten: out });
}

async function verify(env: Env): Promise<Response> {
  const repo = new SearchRepository(env);
  const [docs, withChunks, archived, sources, queue] = await Promise.all([
    env.CATALOG_DB.prepare('SELECT count(*) AS n FROM documents').first<{ n: number }>(),
    env.CATALOG_DB.prepare('SELECT count(*) AS n, sum(chunk_count) AS chunks FROM documents WHERE chunk_count > 0').first<{ n: number; chunks: number }>(),
    env.CATALOG_DB.prepare("SELECT count(*) AS n FROM documents WHERE archive_status = 'archived'").first<{ n: number }>(),
    env.CATALOG_DB.prepare('SELECT count(*) AS n FROM document_sources').first<{ n: number }>(),
    env.CATALOG_DB.prepare('SELECT status, count(*) AS n FROM crawl_queue GROUP BY status').all<{ status: string; n: number }>(),
  ]);
  const shards: Record<number, { documents: number; chunks: number }> = {};
  for (const n2 of repo.activeShards) {
    const db = repo.shard(n2);
    const [d, c] = await Promise.all([db.prepare('SELECT count(*) AS n FROM shard_documents').first<{ n: number }>(), db.prepare('SELECT count(*) AS n FROM chunks').first<{ n: number }>()]);
    shards[n2] = { documents: Number(d?.n ?? 0), chunks: Number(c?.n ?? 0) };
  }
  const shardChunks = Object.values(shards).reduce((t, x) => t + x.chunks, 0);
  return json({
    documents: Number(docs?.n ?? 0),
    documentsWithText: Number(withChunks?.n ?? 0),
    catalogChunkCount: Number(withChunks?.chunks ?? 0),
    shardChunkCount: shardChunks,
    chunkCountsConsistent: Number(withChunks?.chunks ?? 0) === shardChunks,
    archived: Number(archived?.n ?? 0),
    provenanceRecords: Number(sources?.n ?? 0),
    queue: Object.fromEntries((queue.results ?? []).map((q) => [q.status, Number(q.n)])),
    shards,
  });
}

/**
 * Removes city-map project records that the latest read of the map no longer includes (for
 * example projects dropped from the budget). Needs the full list of records to keep, so a failed
 * or empty read can never wipe the set.
 */
async function pruneGis(env: Env, body: Json): Promise<Response> {
  const keep = new Set((Array.isArray(body.keep) ? body.keep : []).map(String));
  const prefix = typeof body.titlePrefix === 'string' ? body.titlePrefix : '';
  if (keep.size < 10 || prefix !== 'Capital project:') throw new HttpError(400, 'bad_request', 'Pruning needs the list of project records to keep.');
  const db = env.CATALOG_DB;
  const repo = new SearchRepository(env);
  const rows = await db.prepare("SELECT id, search_shard FROM documents WHERE source_id = 'vineyard-gis' AND title LIKE ?").bind(`${prefix}%`).all<{ id: string; search_shard: number | null }>();
  const stale = (rows.results ?? []).filter((r) => !keep.has(r.id));
  if (stale.length > 150) throw new HttpError(400, 'bad_request', 'Too many records would be removed; refusing.');
  for (const e of stale) {
    await db.batch([db.prepare('DELETE FROM document_sources WHERE document_id = ?').bind(e.id), db.prepare('DELETE FROM document_versions WHERE document_id = ?').bind(e.id), db.prepare('DELETE FROM documents WHERE id = ?').bind(e.id)]);
    if (e.search_shard != null && repo.activeShards.includes(e.search_shard)) await repo.removeDocument(e.search_shard, e.id).catch(() => 0);
  }
  return json({ ok: true, removed: stale.length });
}

export async function handleAdmin(env: Env, request: Request, url: URL): Promise<Response> {
  await requireIngestAuth(request, env);
  const path = url.pathname.replace(/^\/api\/admin/, '');
  const method = request.method;
  const budget = new Budget(env);

  if (path === '/migrate' && method === 'POST') return migrate(env);
  if (path === '/votes' && method === 'POST') return json(await processVotes(env, 25_000));
  if (path === '/people' && method === 'POST') {
    const body = await readJson<{ people?: PersonInput[]; asOf?: string }>(request, 512 * 1024);
    return upsertPeople(env, body.people ?? [], /^\d{4}-\d{2}-\d{2}$/.test(String(body.asOf)) ? String(body.asOf) : nowIso().slice(0, 10));
  }
  if (path === '/quota' && method === 'GET') return quota(env);
  if (path === '/verify' && method === 'GET') return verify(env);
  if (path === '/queue' && method === 'GET') return listQueue(env, url);
  if (path === '/export/tables' && method === 'GET') return exportTables(env);
  if (path === '/export' && method === 'GET') return exportPage(env, url);
  // Backups are reads plus R2 writes, so they run even after the day's D1 write budget is spent.
  if (method === 'PUT' && path.startsWith('/backup/')) return putBackup(env, request, path.slice('/backup/'.length));
  if (method === 'POST' && path === '/backup/prune') {
    const b = await readJson<Json>(request, 4096);
    return pruneBackups(env, Number(b.keepDays ?? 90) || 90);
  }

  if (method === 'PUT') {
    const m = /^\/archive\/([0-9a-f]{64})$/.exec(path);
    if (m) {
      await budget.check(5);
      return putArchive(env, request, m[1], url, budget);
    }
  }
  if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

  // Every other write goes through the daily budget gate first.
  await budget.check();
  const body = await readJson<Json>(request, 2 * 1024 * 1024);
  if (path === '/sources') return upsertSources(env, body, budget);
  if (path === '/sources/status') return sourceStatus(env, body, budget);
  if (path === '/bodies') return upsertBodies(env, body, budget);
  if (path === '/meetings') return upsertMeetings(env, body, budget);
  if (path === '/queue') return upsertQueue(env, body, budget);
  if (path === '/queue/status') return queueStatus(env, body, budget);
  if (path === '/queue/retry-errors') return retryErrors(env, budget);
  if (path === '/documents') return upsertDocument(env, body, budget);
  if (path === '/gis/prune') return pruneGis(env, body);
  if (path === '/document-sources/availability') return sourceAvailability(env, body, budget);
  if (path === '/errors') return errors(env, body, budget);
  if (path === '/optimize') return optimize(env, budget);
  if (path === '/runs') return runs(env, null, body, budget);
  const run = /^\/runs\/([A-Za-z0-9_.:-]{1,64})$/.exec(path);
  if (run) return runs(env, run[1], body, budget);
  const chunks = /^\/documents\/(doc_[0-9a-f]{16})\/chunks$/.exec(path);
  if (chunks) return putChunks(env, chunks[1], body, budget);
  const patch = /^\/documents\/(doc_[0-9a-f]{16})$/.exec(path);
  if (patch) return patchDocument(env, patch[1], body, budget);
  throw notFound('Unknown admin route.');
}

export { chunked };
