import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { archiveRemaining, fillArchiveQueue } from '../worker/admin/archiveFill';
import { Budget, storeArchive } from '../worker/admin/routes';

const now = '2026-10-12T00:00:00Z';

function seed(opts: { stored?: number; hardStop?: string; reserve?: string } = {}) {
  const env = testEnv();
  Object.assign(env, { ARCHIVE_STORAGE_HARD_STOP_BYTES: opts.hardStop ?? '10000', ARCHIVE_PRIORITY_RESERVE_BYTES: opts.reserve ?? '1000', R2_OTHER_BUCKETS_BYTES: '0', MAX_D1_INGEST_ROWS_PER_DAY: '1000000' });
  const db = env.CATALOG_DB.db;
  db.prepare('UPDATE archive_stats SET stored_bytes = ? WHERE id = 1').run(opts.stored ?? 0);
  const doc = db.prepare(
    `INSERT INTO documents (id, slug, title, document_type, document_date, source_id, mime_type, file_size, sha256, canonical_key, archive_status, created_at, updated_at, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, 's', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const q = db.prepare(`INSERT INTO crawl_queue (url_key, source_id, url, status, priority, etag, discovered_at, updated_at) VALUES (?, 's', ?, ?, 80, 'etag', ?, ?)`);
  const src = db.prepare(`INSERT INTO document_sources (id, document_id, source_id, source_url, canonical_key, retrieved_at, etag) VALUES (?, ?, 's', ?, ?, ?, 'etag')`);
  const add = (id: string, title: string, type: string, size: number | null, status = 'not_archived', queue = 'done', mime = 'application/pdf', sha: string | null = `sha_${id}`) => {
    doc.run(id, id, title, type, '2026-06-23', mime, size, sha, `k_${id}`, status, now, now, now, now);
    q.run(`k_${id}`, `https://example.gov/${id}.pdf`, queue, now, now);
    src.run(`src_${id}`, id, `https://example.gov/${id}.pdf`, `k_${id}`, now);
  };
  return { env, db, add };
}

describe('archive fill and remaining size', () => {
  it('counts every file not stored yet, estimating unknown sizes from the average of the same type', async () => {
    const { env, add } = seed({ stored: 1000 });
    add('m1', 'Minutes', 'minutes', 2000);
    add('m2', 'Minutes 2', 'minutes', 4000, 'archived');
    add('m3', 'Minutes 3', 'minutes', null);
    add('p1', 'Packet', 'agenda_packet', 4000, 'link_only');
    add('big', 'Big packet', 'agenda_packet', 50_000_000, 'remote_only_large_file');
    add('huge', 'Huge packet', 'agenda_packet', 600_000_000, 'remote_only_large_file');
    add('gis', 'A road', 'other', 10, 'not_archived', 'done', 'text/plain');
    add('dup', 'Minutes copy', 'minutes', 2000, 'not_archived', 'done', 'application/pdf', 'sha_m1');
    const r = (await archiveRemaining(env)) as Record<string, Record<string, number> & { minutes?: Record<string, number> }>;
    // m1 + m3 (estimated at the minutes average of 2000, 4000 and 2000) + p1 + the 50 MB packet (stored in parts);
    // the copy of m1 counts once; text records never; the 600 MB packet is over the 500 MB limit.
    expect(r.remaining.files).toBe(4);
    expect(r.remaining.unknownSizeFiles).toBe(1);
    expect(r.remaining.estimatedBytes).toBe(2667);
    expect(r.remaining.totalBytes).toBe(2000 + 2667 + 4000 + 50_000_000);
    expect(r.remainingPriority.files).toBe(2);
    expect(r.uploadedInParts.files).toBe(1);
    expect(r.overMaxObjectSize.files).toBe(1);
    // Stop 10,000 with 1,000 stored: both minutes fit (to 10,000), the packets only up to 9,000: 1000+2000+2667+4000 > 9000.
    expect(r.fitsUnderStop.files).toBe(2);
    expect(r.pastStop.files).toBe(2);
    const cost = r.cost as unknown as Record<string, number>;
    expect(cost.thisBucketAllBytes).toBe(1000 + 8667 + 50_000_000);
    expect(cost.thisBucketMonthlyUsd).toBe(0);
    // Four uploads, plus create, three 20 MiB parts and complete for the 50 MB file (less the one already counted).
    expect(cost.classAWritesNeeded).toBe(4 + 3 + 1);
  });

  it('queues files over 25 MiB too (they go up in parts), newest first within a rank, and gives the Worker back skipped ones', async () => {
    const { env, db, add } = seed({ hardStop: '60000000000', reserve: '500000000' });
    add('old', 'Packet 2019', 'agenda_packet', 80_000_000, 'remote_only_large_file');
    add('new', 'Packet 2026', 'agenda_packet', 90_000_000, 'remote_only_large_file');
    add('huge', 'Huge packet', 'agenda_packet', 600_000_000, 'remote_only_large_file');
    add('m1', 'Minutes', 'minutes', 2000);
    add('wait', 'City packet', 'agenda_packet', 70_000_000, 'not_archived', 'pending');
    db.prepare(`UPDATE documents SET document_date = '2019-01-08' WHERE id = 'old'`).run();
    db.prepare(`UPDATE crawl_queue SET metadata_json = '{"kind":"x","workerSkip":1}' WHERE url_key IN ('k_new', 'k_wait')`).run();
    const out = await fillArchiveQueue(env, { limit: 10 }, new Budget(env));
    expect(out.queued).toBe(3);
    expect(out.queuedInParts).toBe(2);
    const rows = db.prepare(`SELECT url_key, metadata_json FROM crawl_queue WHERE run_id = 'archive-fill' ORDER BY priority`).all() as Array<{ url_key: string; metadata_json: string | null }>;
    // Minutes first, then the packets newest first; the 600 MB one is never queued.
    expect(rows.map((r) => r.url_key)).toEqual(['k_m1', 'k_new', 'k_old']);
    expect(JSON.parse(String(rows[1].metadata_json))).toEqual({ kind: 'x' });
    const waiting = db.prepare(`SELECT metadata_json FROM crawl_queue WHERE url_key = 'k_wait'`).get() as { metadata_json: string };
    expect(JSON.parse(waiting.metadata_json).workerSkip).toBeUndefined();
  });

  it('queues priority records first, only what fits, and clears the not-modified marks', async () => {
    const { env, db, add } = seed({ stored: 1000 });
    add('s1', 'Staff report', 'staff_report', 3000);
    add('m1', 'Minutes', 'minutes', 2000);
    add('o1', 'Ordinance 2026-08', 'ordinance', 5000, 'quota_deferred');
    add('p1', 'Packet', 'agenda_packet', 1500, 'link_only');
    add('q1', 'Waiting', 'minutes', 500, 'not_archived', 'pending');
    const out = await fillArchiveQueue(env, { limit: 10 }, new Budget(env));
    // 1000 stored + 500 waiting; minutes (2000) and ordinance (5000) fit under 10,000 = 8500; staff report would reach 11,500.
    expect(out.queued).toBe(2);
    const rows = db.prepare(`SELECT url_key, status, priority, etag FROM crawl_queue WHERE run_id = 'archive-fill' ORDER BY priority`).all() as Array<{ url_key: string; status: string; priority: number; etag: string | null }>;
    expect(rows.map((r) => r.url_key)).toEqual(['k_m1', 'k_o1']);
    expect(rows.every((r) => r.status === 'pending' && r.etag === null && r.priority >= 500)).toBe(true);
    const src = db.prepare(`SELECT etag FROM document_sources WHERE canonical_key = 'k_m1'`).get() as { etag: string | null };
    expect(src.etag).toBeNull();
    // A dry run changes nothing.
    const dry = await fillArchiveQueue(env, { limit: 10, dryRun: true }, new Budget(env));
    expect(dry.dryRun).toBe(true);
  });

  it('stores other files only up to the reserve below the stop, priority records up to the stop', async () => {
    const { env, add } = seed({ stored: 8500 });
    add('s1', 'Slides', 'presentation', 600, 'not_archived', 'done', 'application/pdf', 'a'.repeat(64));
    add('m1', 'Minutes', 'minutes', 600, 'not_archived', 'done', 'application/pdf', 'b'.repeat(64));
    const bytes = new Uint8Array(600).buffer;
    const slides = await storeArchive(env, 'a'.repeat(64), bytes, 600, 'pdf', 'application/pdf', new Budget(env));
    expect(slides.status).toBe('quota_deferred');
    const minutes = await storeArchive(env, 'b'.repeat(64), bytes, 600, 'pdf', 'application/pdf', new Budget(env));
    expect(minutes.status).toBe('archived');
  });
});
