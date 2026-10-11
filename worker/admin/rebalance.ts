/**
 * Archive rebalance (admin, run from the GitHub ingest job). The R2 archive stops at
 * ARCHIVE_STORAGE_HARD_STOP_BYTES, which is never raised. To make room for the priority records
 * (minutes, agendas, ordinances, resolutions, notices, budgets, audits), stored copies of other
 * records (agenda packets, attachments, studies) are removed; those records stay indexed and link to
 * the city's own copy. Deferred priority records are queued again so the next sync archives them.
 *
 * POST /api/admin/archive/rebalance {"apply": false} reports what would change (default).
 * {"apply": true, "limit": 200} removes up to `limit` copies per call.
 */
import type { Env } from '../env';
import { json } from '../lib/http';
import { ARCHIVE_TYPES, shouldArchive } from '../lib/archivePolicy';

type Row = { id: string; title: string; document_type: string; archive_key: string; file_size: number | null };

export async function rebalanceArchive(env: Env, body: Record<string, unknown>): Promise<Response> {
  const db = env.CATALOG_DB;
  const apply = body.apply === true;
  const limit = Math.min(500, Math.max(1, Number(body.limit ?? 200) || 200));
  const archived = await db.prepare(`SELECT id, title, document_type, archive_key, file_size FROM documents WHERE archive_status = 'archived' AND archive_key IS NOT NULL`).all<Row>();
  const rows = archived.results ?? [];
  // A stored object is kept when any record using it is a priority record.
  const keepKeys = new Set(rows.filter((r) => shouldArchive(r.document_type, r.title)).map((r) => r.archive_key));
  const removable = rows.filter((r) => !keepKeys.has(r.archive_key));
  const byKey = new Map<string, Row[]>();
  for (const r of removable) byKey.set(r.archive_key, [...(byKey.get(r.archive_key) ?? []), r]);
  const removableBytes = [...byKey.values()].reduce((n, list) => n + Number(list[0].file_size ?? 0), 0);
  const byType: Record<string, number> = {};
  for (const r of removable) byType[r.document_type] = (byType[r.document_type] ?? 0) + 1;

  const deferred = await db
    .prepare(`SELECT document_type, title, file_size FROM documents WHERE archive_status = 'quota_deferred' AND document_type IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify([...ARCHIVE_TYPES]))
    .all<{ document_type: string; title: string; file_size: number | null }>();
  const priorityDeferred = (deferred.results ?? []).filter((d) => shouldArchive(d.document_type, d.title));
  const priorityDeferredBytes = priorityDeferred.reduce((n, d) => n + Number(d.file_size ?? 0), 0);
  const stats = await db.prepare('SELECT stored_bytes, stored_objects FROM archive_stats WHERE id = 1').first<{ stored_bytes: number; stored_objects: number }>();

  const report = {
    storedBytes: Number(stats?.stored_bytes ?? 0),
    storedObjects: Number(stats?.stored_objects ?? 0),
    archivedRecords: rows.length,
    removableObjects: byKey.size,
    removableRecords: removable.length,
    removableBytes,
    removableByType: byType,
    priorityDeferredRecords: priorityDeferred.length,
    priorityDeferredBytes,
    nonPriorityDeferredRecords: (await db.prepare(`SELECT count(*) AS n FROM documents WHERE archive_status = 'quota_deferred'`).first<{ n: number }>())!.n - priorityDeferred.length,
  };
  if (!apply) return json({ apply: false, ...report });

  let removedObjects = 0;
  let freed = 0;
  for (const [key, list] of [...byKey.entries()].slice(0, limit)) {
    if (env.ARCHIVE) await env.ARCHIVE.delete(key);
    const size = Number(list[0].file_size ?? 0);
    await db.batch([
      db.prepare(`UPDATE documents SET archive_status = 'link_only', archive_key = NULL, archived_at = NULL WHERE archive_key = ?`).bind(key),
      db.prepare(`UPDATE document_versions SET archive_key = NULL WHERE archive_key = ?`).bind(key),
      db.prepare('UPDATE archive_stats SET stored_bytes = max(0, stored_bytes - ?), stored_objects = max(0, stored_objects - 1), updated_at = ? WHERE id = 1').bind(size, new Date().toISOString()),
    ]);
    removedObjects++;
    freed += size;
  }
  // Non-priority records still marked deferred are links by policy, not waiting for space.
  await db.prepare(`UPDATE documents SET archive_status = 'link_only' WHERE archive_status = 'quota_deferred' AND document_type NOT IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...ARCHIVE_TYPES])).run();
  // Deferred priority records: fetch again so the sync archives them while space lasts.
  const requeued = await db
    .prepare(
      `UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, etag = NULL, last_modified = NULL
       WHERE url_key IN (SELECT ds.canonical_key FROM document_sources ds JOIN documents d ON d.id = ds.document_id
                         WHERE d.archive_status = 'quota_deferred' AND d.document_type IN (SELECT value FROM json_each(?)))`,
    )
    .bind(JSON.stringify([...ARCHIVE_TYPES]))
    .run();
  return json({ apply: true, removedObjects, freedBytes: freed, requeued: Number(requeued.meta?.changes ?? 0), before: report });
}
