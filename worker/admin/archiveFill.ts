/**
 * Filling the R2 archive with the files it does not hold yet, inside the free storage.
 *
 * GET  /api/admin/archive/remaining   counts and bytes of every file not stored yet (known sizes, and an estimate
 *                                     from the average known size of the same type where a size is unknown), what
 *                                     fits under the stop, and the monthly cost of storing all of it beyond the free
 *                                     10 GB-month. Reads only.
 * POST /api/admin/archive/fill        puts files not stored yet back on the crawl queue, priority records first and
 *                                     only what fits under the stop, so the next sync downloads and stores them.
 *                                     {"limit": 300, "dryRun": false}. Never deletes anything.
 *
 * The stop itself is enforced on every upload (storeArchive in ./routes.ts); this only decides what to fetch again.
 */
import type { Env } from '../env';
import { intVar } from '../env';
import { archiveLimitFor, archiveRank, DEFAULT_HARD_STOP_BYTES, DEFAULT_PRIORITY_RESERVE_BYTES, isPriorityArchive } from '../lib/archivePolicy';
import { nowIso } from '../lib/util';
import type { Budget } from './routes';

/** R2 Standard storage price beyond the included amount, US dollars per GB-month (Cloudflare R2 pricing). */
export const R2_PRICE_PER_GB_MONTH = 0.015;
/** Included R2 storage per account per month, bytes (decimal GB, the smaller reading of "10 GB"). */
export const R2_FREE_BYTES = 10_000_000_000;
/** Included Class A operations (writes) per month. One upload is one Class A operation. */
export const R2_FREE_CLASS_A = 1_000_000;
/** The account's other buckets, as measured when the stop was set (docs/FREE_TIER_LIMITS.md); overridable by variable. */
export const DEFAULT_OTHER_BUCKETS_BYTES = 1_700_000_000;

type Row = { id: string; title: string | null; document_type: string; file_size: number | null; sha256: string | null; archive_status: string; canonical_key: string | null; document_date: string | null; queue_status: string | null };

/** Files a stored copy could be made of: not stored yet, not a web page or plain-text record, not audio or video. */
const NOT_STORED_SQL = `SELECT d.id, d.title, d.document_type, d.file_size, d.sha256, d.archive_status, d.canonical_key, d.document_date,
       (SELECT q.status FROM crawl_queue q WHERE q.url_key = d.canonical_key) AS queue_status
     FROM documents d
     WHERE d.archive_status <> 'archived' AND d.archive_status <> 'remote_only_media'
       AND d.mime_type NOT LIKE 'text/%' AND d.mime_type NOT LIKE 'video/%' AND d.mime_type NOT LIKE 'audio/%'`;

function limits(env: Env) {
  return {
    hardStop: intVar(env.ARCHIVE_STORAGE_HARD_STOP_BYTES, DEFAULT_HARD_STOP_BYTES),
    reserve: intVar(env.ARCHIVE_PRIORITY_RESERVE_BYTES, DEFAULT_PRIORITY_RESERVE_BYTES),
    maxObject: intVar(env.ARCHIVE_MAX_OBJECT_BYTES, 25 * 1024 * 1024),
    otherBuckets: intVar(env.R2_OTHER_BUCKETS_BYTES, DEFAULT_OTHER_BUCKETS_BYTES),
  };
}

/** Average known file size by type (and overall), from every file record with a size. */
async function averageSizes(env: Env): Promise<{ byType: Map<string, number>; overall: number }> {
  const res = await env.CATALOG_DB.prepare(
    `SELECT document_type AS t, count(*) AS n, sum(file_size) AS b FROM documents
     WHERE file_size > 0 AND mime_type NOT LIKE 'text/%' AND mime_type NOT LIKE 'video/%' AND mime_type NOT LIKE 'audio/%' GROUP BY document_type`,
  ).all<{ t: string; n: number; b: number }>();
  const byType = new Map<string, number>();
  let n = 0;
  let b = 0;
  for (const r of res.results ?? []) {
    byType.set(r.t, Number(r.b) / Math.max(1, Number(r.n)));
    n += Number(r.n);
    b += Number(r.b);
  }
  return { byType, overall: n ? b / n : 0 };
}

/** One entry per distinct file (records sharing a content hash are stored once). */
function distinctFiles(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    if (r.sha256) {
      if (seen.has(r.sha256)) continue;
      seen.add(r.sha256);
    }
    out.push(r);
  }
  return out;
}

const gb = (bytes: number) => Math.round((bytes / 1e9) * 1000) / 1000;
const dollars = (bytes: number) => Math.round(Math.max(0, bytes - R2_FREE_BYTES) / 1e9 * R2_PRICE_PER_GB_MONTH * 100) / 100;

export interface Tally {
  files: number;
  knownSizeFiles: number;
  knownBytes: number;
  unknownSizeFiles: number;
  estimatedBytes: number;
  totalBytes: number;
}
const emptyTally = (): Tally => ({ files: 0, knownSizeFiles: 0, knownBytes: 0, unknownSizeFiles: 0, estimatedBytes: 0, totalBytes: 0 });

function add(t: Tally, size: number | null, estimate: number) {
  t.files++;
  if (size != null && size > 0) {
    t.knownSizeFiles++;
    t.knownBytes += size;
  } else {
    t.unknownSizeFiles++;
    t.estimatedBytes += estimate;
  }
  t.totalBytes = t.knownBytes + Math.round(t.estimatedBytes);
}

/** The numbers for GET /archive/remaining (counts and bytes only, no titles). */
export async function archiveRemaining(env: Env): Promise<Record<string, unknown>> {
  const { hardStop, reserve, maxObject, otherBuckets } = limits(env);
  const [stats, rowsRes, avg] = await Promise.all([
    env.CATALOG_DB.prepare('SELECT stored_bytes, stored_objects FROM archive_stats WHERE id = 1').first<{ stored_bytes: number; stored_objects: number }>(),
    env.CATALOG_DB.prepare(NOT_STORED_SQL).all<Row>(),
    averageSizes(env),
  ]);
  const stored = Number(stats?.stored_bytes ?? 0);
  const files = distinctFiles(rowsRes.results ?? []);
  const estimateFor = (t: string) => avg.byType.get(t) ?? avg.overall;

  const byType: Record<string, Tally> = {};
  const storable = emptyTally();
  const tooLarge = emptyTally();
  const priority = emptyTally();
  const other = emptyTally();
  const fits = emptyTally();
  const pastStop = emptyTally();
  // In archive order (priority records first, newest first), as the fill takes them.
  const ordered = [...files].sort((a, b) => archiveRank(a.document_type, a.title) - archiveRank(b.document_type, b.title) || String(b.document_date ?? '').localeCompare(String(a.document_date ?? '')));
  let projected = stored;
  for (const f of ordered) {
    const size = f.file_size == null ? null : Number(f.file_size);
    const est = estimateFor(f.document_type);
    if (size != null && size > maxObject) {
      add(tooLarge, size, est);
      continue;
    }
    add((byType[f.document_type] ??= emptyTally()), size, est);
    add(storable, size, est);
    add(isPriorityArchive(f.document_type, f.title) ? priority : other, size, est);
    const bytes = size && size > 0 ? size : est;
    if (projected + bytes <= archiveLimitFor(f.document_type, f.title, hardStop, reserve)) {
      projected += bytes;
      add(fits, size, est);
    } else add(pastStop, size, est);
  }
  for (const t of Object.values(byType)) t.estimatedBytes = Math.round(t.estimatedBytes);
  for (const t of [storable, tooLarge, priority, other, fits, pastStop]) t.estimatedBytes = Math.round(t.estimatedBytes);

  const allStorable = stored + storable.totalBytes;
  const allWithLarge = allStorable + tooLarge.totalBytes;
  return {
    note: 'Bytes are decimal (1 GB = 1,000,000,000 bytes). estimatedBytes = files of unknown size times the average known size of files of the same type. Records that share one file are counted once.',
    stop: { hardStopBytes: hardStop, priorityReserveBytes: reserve, otherFilesStopBytes: Math.max(0, hardStop - reserve), maxObjectBytes: maxObject },
    stored: { bytes: stored, objects: Number(stats?.stored_objects ?? 0), gb: gb(stored) },
    remaining: { ...storable, gb: gb(storable.totalBytes) },
    remainingPriority: { ...priority, gb: gb(priority.totalBytes) },
    remainingOther: { ...other, gb: gb(other.totalBytes) },
    remainingByType: byType,
    fitsUnderStop: { ...fits, gb: gb(fits.totalBytes) },
    pastStop: { ...pastStop, gb: gb(pastStop.totalBytes) },
    overMaxObjectSize: { ...tooLarge, gb: gb(tooLarge.totalBytes) },
    averageKnownBytesByType: Object.fromEntries([...avg.byType.entries()].map(([k, v]) => [k, Math.round(v)])),
    cost: {
      pricePerGbMonth: R2_PRICE_PER_GB_MONTH,
      freeBytes: R2_FREE_BYTES,
      otherBucketsBytesAssumed: otherBuckets,
      // This bucket alone (stored now plus every remaining file up to the object size limit).
      thisBucketAllBytes: allStorable,
      thisBucketMonthlyUsd: dollars(allStorable),
      // With the account's other buckets, which share the same free 10 GB.
      accountAllBytes: allStorable + otherBuckets,
      accountMonthlyUsd: dollars(allStorable + otherBuckets),
      // Also storing the files over the object size limit (now linked only).
      accountWithLargeFilesBytes: allWithLarge + otherBuckets,
      accountWithLargeFilesMonthlyUsd: dollars(allWithLarge + otherBuckets),
      classAWritesNeeded: storable.files,
      classAWritesFreePerMonth: R2_FREE_CLASS_A,
    },
  };
}

/**
 * Puts files not stored yet back on the queue, priority records first, only as many as fit under the stop (after
 * what is already waiting in the queue). Their conditional-request marks are cleared so the file is downloaded again.
 */
export async function fillArchiveQueue(env: Env, body: Record<string, unknown>, budget: Budget): Promise<Record<string, unknown>> {
  const { hardStop, reserve, maxObject } = limits(env);
  const limit = Math.min(1000, Math.max(1, Number(body.limit ?? 300) || 300));
  const dryRun = body.dryRun === true;
  const [stats, rowsRes, avg] = await Promise.all([
    env.CATALOG_DB.prepare('SELECT stored_bytes FROM archive_stats WHERE id = 1').first<{ stored_bytes: number }>(),
    env.CATALOG_DB.prepare(NOT_STORED_SQL).all<Row>(),
    averageSizes(env),
  ]);
  const files = distinctFiles(rowsRes.results ?? []).filter((f) => f.file_size == null || Number(f.file_size) <= maxObject);
  const sizeOf = (f: Row) => (f.file_size && Number(f.file_size) > 0 ? Number(f.file_size) : (avg.byType.get(f.document_type) ?? avg.overall));
  // Files already waiting in the queue will be stored when the sync reaches them: count them first.
  let projected = Number(stats?.stored_bytes ?? 0);
  for (const f of files) if (f.queue_status === 'pending') projected += sizeOf(f);
  const candidates = files
    .filter((f) => f.canonical_key && (f.queue_status === 'done' || f.queue_status === 'unchanged'))
    .sort((a, b) => archiveRank(a.document_type, a.title) - archiveRank(b.document_type, b.title) || String(b.document_date ?? '').localeCompare(String(a.document_date ?? '')));
  const picked: Array<{ key: string; rank: number; bytes: number }> = [];
  let pastStop = 0;
  for (const f of candidates) {
    if (picked.length >= limit) break;
    const bytes = sizeOf(f);
    if (projected + bytes > archiveLimitFor(f.document_type, f.title, hardStop, reserve)) {
      pastStop++;
      continue;
    }
    projected += bytes;
    picked.push({ key: String(f.canonical_key), rank: archiveRank(f.document_type, f.title), bytes });
  }
  const summary = { dryRun, queued: picked.length, queuedBytes: Math.round(picked.reduce((n, p) => n + p.bytes, 0)), skippedPastStop: pastStop, projectedBytes: Math.round(projected), hardStopBytes: hardStop };
  if (dryRun || !picked.length) return summary;

  await budget.check(picked.length * 3);
  const db = env.CATALOG_DB;
  let rows = 0;
  for (let i = 0; i < picked.length; i += 100) {
    const part = picked.slice(i, i + 100);
    const payload = JSON.stringify(part.map((p) => ({ k: p.key, p: 500 + p.rank })));
    const r = await db.batch([
      // After new records (lower numbers), in archive order.
      db
        .prepare(
          `UPDATE crawl_queue SET status = 'pending', attempts = 0, next_attempt_at = NULL, etag = NULL, last_modified = NULL, run_id = 'archive-fill', updated_at = ?,
             priority = (SELECT json_extract(value, '$.p') FROM json_each(?) WHERE json_extract(value, '$.k') = crawl_queue.url_key)
           WHERE url_key IN (SELECT json_extract(value, '$.k') FROM json_each(?)) AND status IN ('done', 'unchanged')`,
        )
        .bind(nowIso(), payload, payload),
      // A conditional request would answer "not modified" and skip the download.
      db.prepare(`UPDATE document_sources SET etag = NULL, last_modified = NULL WHERE canonical_key IN (SELECT json_extract(value, '$.k') FROM json_each(?))`).bind(payload),
    ]);
    rows += r.reduce((n, x) => n + Number(x.meta?.rows_written ?? 0), 0);
  }
  await budget.record(rows);
  return { ...summary, rowsWritten: rows };
}
