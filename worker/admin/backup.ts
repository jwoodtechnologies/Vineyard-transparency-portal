/**
 * Weekly catalog backups into the portal's own R2 bucket (backups/YYYY-MM-DD/<table>.ndjson.gz).
 *
 * The ingest job (python -m ingest backup) pages every table through GET /api/admin/export and
 * uploads one gzipped NDJSON file per table with PUT /api/admin/backup/..., then prunes backups
 * older than 90 days. The search shards are not copied: every chunk can be rebuilt from the
 * archived originals in R2 by re-running ingestion. Panel credentials (password hash, passkeys)
 * are deliberately left out of backups.
 */
import type { Env } from '../env';
import { HttpError, badRequest, json } from '../lib/http';

export const BACKUP_TABLES = [
  'sources',
  'government_bodies',
  'meetings',
  'agenda_items',
  'documents',
  'document_sources',
  'document_versions',
  'document_relationships',
  'crawl_runs',
  'crawl_queue',
  'ingestion_errors',
  'archive_stats',
  'quota_usage',
  'issue_reports',
  'news_items',
  'cron_runs',
  'activity_visits',
  'activity_questions',
  'activity_feedback',
];

export async function exportTables(env: Env): Promise<Response> {
  const res = await env.CATALOG_DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const have = new Set((res.results ?? []).map((r) => r.name));
  return json({ tables: BACKUP_TABLES.filter((t) => have.has(t)) });
}

export async function exportPage(env: Env, url: URL): Promise<Response> {
  const table = url.searchParams.get('table') ?? '';
  if (!BACKUP_TABLES.includes(table)) throw badRequest('Unknown table.');
  const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 500) || 500));
  const res = await env.CATALOG_DB.prepare(`SELECT rowid AS __rowid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ?`).bind(after, limit).all<Record<string, unknown>>();
  const rows = res.results ?? [];
  return json({ table, rows, last: rows.length ? Number(rows[rows.length - 1].__rowid) : after, done: rows.length < limit });
}

export async function putBackup(env: Env, request: Request, key: string): Promise<Response> {
  if (!env.ARCHIVE) throw new HttpError(503, 'backend_unavailable', 'The archive bucket is not bound.');
  if (!/^\d{4}-\d{2}-\d{2}\/[a-z_]{2,40}\.ndjson\.gz$/.test(key)) throw badRequest('Bad backup name.');
  if (!request.body) throw badRequest('Empty backup.');
  const size = Number(request.headers.get('content-length') ?? 0);
  if (size > 200 * 1024 * 1024) throw badRequest('Backup file too large.');
  const obj = await env.ARCHIVE.put(`backups/${key}`, request.body, { httpMetadata: { contentType: 'application/gzip' } });
  return json({ ok: true, key: `backups/${key}`, size: obj?.size ?? size });
}

export async function pruneBackups(env: Env, keepDays: number): Promise<Response> {
  if (!env.ARCHIVE) throw new HttpError(503, 'backend_unavailable', 'The archive bucket is not bound.');
  const cutoff = new Date(Date.now() - Math.max(14, keepDays) * 86400_000).toISOString().slice(0, 10);
  let cursor: string | undefined;
  const drop: string[] = [];
  const days = new Set<string>();
  do {
    const page = await env.ARCHIVE.list({ prefix: 'backups/', cursor, limit: 1000 });
    for (const o of page.objects) {
      const day = o.key.slice(8, 18);
      days.add(day);
      if (day < cutoff) drop.push(o.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // Never delete the newest backup, whatever its date.
  const newest = [...days].sort().pop();
  const doomed = drop.filter((k) => k.slice(8, 18) !== newest);
  for (let i = 0; i < doomed.length; i += 500) await env.ARCHIVE.delete(doomed.slice(i, i + 500));
  return json({ ok: true, kept: [...days].filter((d) => d >= cutoff || d === newest).sort(), deleted: doomed.length });
}
