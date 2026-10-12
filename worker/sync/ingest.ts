/**
 * Queue ingestion inside the Worker (five-minute sync). New agendas, packets, minutes, city
 * documents and watched pages are fetched, their text extracted and chunked for search and chat,
 * and priority records archived to R2, without waiting for GitHub's throttled schedule.
 *
 * The GitHub ingest job keeps the work the Worker cannot do: OCR of scans, Word and Excel files,
 * municipal code site entries, and very large files. Those items are left pending for it.
 */
import type { Env } from '../env';
import { Budget, putChunks, storeArchive, upsertDocument } from '../admin/routes';
import { archiveLimits } from '../lib/archivePolicy';
import { CC_API, classifyType } from '../lib/civicclerk';
import { chunkPages } from './chunk';
import { extractHtml, extractPdf, looksScanned, type Page } from './extract';
import { assertRobots, RobotsBlocked } from './robots';

export const SYNC_UA = 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org; public records archive)';
const MAX_BYTES = 25 * 1024 * 1024;
const MEDIA = /\.(mp4|mov|m4v|webm|mp3|m4a|wav|wma|wmv|avi|flv|ogg)(\?|$)/i;
const LEASE_MINUTES = 20;

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface QueueRow {
  url_key: string;
  source_id: string;
  url: string;
  parent_url: string | null;
  priority: number;
  metadata_json: string | null;
  attempts: number;
  known_etag?: string | null;
  known_last_modified?: string | null;
}

type Meta = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export type ItemOutcome = 'done' | 'unchanged' | 'skipped' | 'left_for_github' | 'error';

async function setStatus(env: Env, key: string, status: string, extra: { documentId?: string | null; etag?: string | null; lastModified?: string | null; sha?: string | null; error?: string | null; countAttempt?: boolean; retryAt?: string | null } = {}): Promise<void> {
  const now = new Date().toISOString();
  await env.CATALOG_DB.prepare(
    `UPDATE crawl_queue SET status = ?, document_id = coalesce(?, document_id), etag = coalesce(?, etag), last_modified = coalesce(?, last_modified),
       sha256 = coalesce(?, sha256), attempts = attempts + ?, last_attempt_at = ?, next_attempt_at = ?, last_error = ?, run_id = 'worker', updated_at = ? WHERE url_key = ?`,
  )
    .bind(status, extra.documentId ?? null, extra.etag ?? null, extra.lastModified ?? null, extra.sha ?? null, extra.countAttempt === false ? 0 : 1, now, extra.retryAt ?? null, extra.error ?? null, now, key)
    .run();
}

/** Signed download link for a CivicClerk agenda-item attachment (mirrors ingest/pipeline.py). */
async function ccAttachmentUrl(meta: Meta): Promise<string | null> {
  const agendaId = Math.trunc(Number(meta.agendaId ?? 0));
  const attId = Math.trunc(Number(meta.attachmentId ?? 0));
  if (!agendaId || !attId) return null;
  const r = await fetch(`${CC_API}/Meetings/${agendaId}`, { headers: { 'user-agent': SYNC_UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`CivicClerk meeting ${agendaId}: HTTP ${r.status}`);
  const data = (await r.json()) as { items?: unknown[] };
  const walk = (items: unknown[]): string | null => {
    for (const raw of items ?? []) {
      const it = raw as { attachments?: Array<Record<string, unknown>>; childAgendaItems?: unknown[]; items?: unknown[] };
      for (const att of it.attachments ?? []) {
        if (Math.trunc(Number(att.id ?? 0)) === attId) {
          return str(att.pdfVersionFullPath) ?? (str(att.mediaFullPath) ? `https://civicclerk.blob.core.windows.net/${att.mediaFullPath}` : null);
        }
      }
      const deeper = walk([...(it.childAgendaItems ?? []), ...(it.items ?? [])]);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(data.items ?? []);
}

function extOf(url: string, meta: Meta): string {
  const hint = str(meta.extension) ?? str(meta.fileNameHint) ?? url.split('?')[0];
  const m = /\.([a-z0-9]{2,5})$/i.exec(hint ?? '');
  return m ? m[1].toLowerCase() : '';
}

function fileNameFor(meta: Meta, url: string, title: string, ext: string): string {
  const hint = str(meta.fileName) ?? str(meta.fileNameHint) ?? decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
  if (hint && !/GetMeetingFileStream/i.test(hint) && !/^[0-9a-f-]{30,}\.\w+$/i.test(hint)) return hint.slice(0, 200);
  return `${title.replace(/[^A-Za-z0-9._ ()-]+/g, '_').slice(0, 120) || 'record'}.${ext || 'bin'}`;
}

async function indexChunks(env: Env, docId: string, pages: Page[], budget: Budget, ocrStatus: string): Promise<number> {
  const chunks = chunkPages(pages);
  for (let off = 0; off < chunks.length; off += 200) {
    const batch = chunks.slice(off, off + 200).map((c) => ({ id: `${docId}:c${String(c.index).padStart(5, '0')}`, pageStart: c.pageStart, pageEnd: c.pageEnd, sectionTitle: c.sectionTitle, text: c.text, ocr: false }));
    await putChunks(env, docId, { chunks: batch, append: off > 0, offset: off, ocrStatus }, budget);
  }
  return chunks.length;
}

export interface IndexInput {
  key: string;
  sourceId: string;
  url: string;
  parentUrl?: string | null;
  meta: Meta;
  title: string;
  documentType?: string | null;
  mime: string;
  fileName: string;
  bytes?: ArrayBuffer | null;
  ext: string;
  sha: string;
  pages: Page[];
  pageCount: number | null;
  textStatus: string;
  ocrStatus: string;
  etag?: string | null;
  lastModified?: string | null;
  httpStatus?: number;
  /** Archive copy: by the archive policy (default), always (portal staff uploads, the only copy), or never (stored elsewhere). */
  archive?: 'policy' | 'always' | 'never';
}

/** Writes one record (metadata, provenance, chunks, archived copy) through the same code paths as the ingest API. */
export async function indexRecord(env: Env, x: IndexInput, budget: Budget): Promise<{ documentId: string; status: string; chunks: number; archive: string | null }> {
  const meta = x.meta;
  const documentType = x.documentType ?? str(meta.documentType) ?? classifyType(x.title, x.fileName);
  const documentDate = str(meta.documentDate);
  const res = await upsertDocument(
    env,
    {
      document: {
        title: x.title.slice(0, 500),
        documentType,
        documentNumber: str(meta.documentNumber),
        documentDate,
        year: documentDate ? Number(documentDate.slice(0, 4)) : (meta.year ?? null),
        governmentBodyId: str(meta.governmentBodyId),
        governmentBodyName: str(meta.governmentBodyName),
        meetingId: str(meta.meetingId),
        mimeType: x.mime,
        fileName: x.fileName,
        fileSize: x.bytes ? x.bytes.byteLength : null,
        pageCount: x.pageCount,
        sha256: x.sha,
        textStatus: x.textStatus,
        ocrStatus: x.ocrStatus,
        archiveStatus: x.bytes && x.bytes.byteLength > MAX_BYTES ? 'remote_only_large_file' : 'not_archived',
        description: str(meta.sectionHeading),
        dedupeMeeting: Boolean(meta.dedupeMeeting),
        currency: str(meta.currency),
      },
      source: { canonicalKey: x.key, sourceId: x.sourceId, url: x.url, parentUrl: x.parentUrl ?? null, linkText: str(meta.linkText), retrievedAt: new Date().toISOString(), etag: x.etag ?? null, lastModified: x.lastModified ?? null, httpStatus: x.httpStatus ?? 200 },
      relationships: meta.relationship && meta.meetingId ? [{ type: meta.relationship, toKind: 'meeting', toId: meta.meetingId, toTitle: str(meta.meetingTitle) ?? '', basis: 'source_structure' }] : [],
      meetingRole: str(meta.meetingRole),
    },
    budget,
  );
  const out = (await res.json()) as { documentId: string; status: string; needsChunks?: boolean; needsArchive?: boolean };
  let archive: string | null = null;
  const archiveMode = x.archive ?? 'policy';
  if ((archiveMode === 'always' || (archiveMode === 'policy' && out.needsArchive)) && x.bytes && !x.mime.startsWith('text/')) {
    const a = await storeArchive(env, x.sha, x.bytes, x.bytes.byteLength, x.ext || 'bin', x.mime, budget, { always: archiveMode === 'always' });
    archive = String(a.status);
  }
  let chunks = 0;
  if (out.needsChunks && x.pages.some((p) => p.text.trim())) chunks = await indexChunks(env, out.documentId, x.pages, budget, x.ocrStatus);
  return { documentId: out.documentId, status: out.status, chunks, archive };
}

/**
 * A file over 25 MiB that is already a record (put back on the queue by the archive fill): its bytes stream from the
 * source straight into R2 (never into memory), checked by R2 against the SHA-256 the record already has, and no
 * text is extracted (the record keeps the text it has). Files up to ARCHIVE_MAX_LARGE_OBJECT_BYTES (500 MB); larger
 * ones are linked and logged. A file that is not a record yet is still left for the GitHub job.
 */
async function archiveLargeKnownFile(env: Env, item: QueueRow, res: Response, len: number, urlExt: string, budget: Budget): Promise<ItemOutcome> {
  const known = await env.CATALOG_DB.prepare(
    `SELECT d.id, d.sha256, d.mime_type, d.archive_status FROM document_sources ds JOIN documents d ON d.id = ds.document_id WHERE ds.canonical_key = ? LIMIT 1`,
  )
    .bind(item.url_key)
    .first<{ id: string; sha256: string | null; mime_type: string | null; archive_status: string }>();
  if (!known?.sha256 || !/^[0-9a-f]{64}$/.test(known.sha256) || /^(text|video|audio)\//.test(known.mime_type ?? '')) {
    await res.body?.cancel().catch(() => undefined);
    return 'left_for_github';
  }
  const done = (archive: string) => setStatus(env, item.url_key, 'done', { documentId: known.id, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), sha: known.sha256, error: archive === 'archived' || archive === 'exists' ? null : `archive: ${archive}` });
  if (known.archive_status === 'archived') {
    await res.body?.cancel().catch(() => undefined);
    await done('exists');
    return 'done';
  }
  const mime = known.mime_type || 'application/octet-stream';
  const ext = mime === 'application/pdf' ? 'pdf' : urlExt || 'bin';
  const { maxLargeObject } = archiveLimits(env);
  if (len > maxLargeObject) await res.body?.cancel().catch(() => undefined);
  // R2 refuses the upload if the bytes no longer match the record's SHA-256 (the file changed at the source):
  // the error is recorded and the GitHub job re-reads it as a new version.
  const a = await storeArchive(env, known.sha256, len > maxLargeObject ? null : res.body, len, ext, mime, budget);
  console.log(JSON.stringify({ event: 'archive_large_stream', key: item.url_key, size: len, status: a.status }));
  await done(String(a.status));
  return 'done';
}

/** Processes one queue item. Never throws; the outcome is recorded on the queue row. */
export async function ingestItem(env: Env, item: QueueRow, budget: Budget): Promise<ItemOutcome> {
  const meta = ((): Meta => {
    try {
      return JSON.parse(item.metadata_json ?? '{}') as Meta;
    } catch {
      return {};
    }
  })();
  const key = item.url_key;
  const kind = str(meta.kind);
  try {
    if (kind === 'mco_content') return 'left_for_github';
    // CivicClerk refuses Cloudflare's network (HTTP 403): its files are read by the GitHub job.
    if (kind === 'cc_attachment' || /(^|\.)civicclerk\.com$/i.test(new URL(item.url).host)) return 'left_for_github';
    let url = item.url;
    let sourceUrl = item.url;
    if (kind === 'cc_attachment') {
      const fresh = await ccAttachmentUrl(meta);
      if (!fresh) {
        await setStatus(env, key, 'skipped', { error: 'attachment no longer published' });
        return 'skipped';
      }
      url = fresh;
      const parent = (item.parent_url ?? str(meta.sourceUrl) ?? '').split('#')[0];
      sourceUrl = parent ? `${parent}#attachment-${Math.trunc(Number(meta.attachmentId ?? 0))}-${Math.trunc(Number(meta.agendaId ?? 0))}` : item.url.split('#')[0];
    }
    if (MEDIA.test(url)) {
      await setStatus(env, key, 'skipped', { error: 'media files are linked, not archived' });
      return 'skipped';
    }
    await assertRobots(env, url);
    const headers: Record<string, string> = { 'user-agent': SYNC_UA, accept: '*/*' };
    if (item.known_etag) headers['if-none-match'] = item.known_etag;
    if (item.known_last_modified) headers['if-modified-since'] = item.known_last_modified;
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.status === 304) {
      await setStatus(env, key, 'unchanged', { countAttempt: false });
      return 'unchanged';
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.slice(0, 160)}`);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) return archiveLargeKnownFile(env, item, res, len, extOf(url, meta), budget);
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    let ext = extOf(url, meta);
    if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
      await setStatus(env, key, 'skipped', { error: `media (${contentType}) linked only` });
      return 'skipped';
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return 'left_for_github';
    const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
    const isPdf = String.fromCharCode(...head) === '%PDF-' || contentType === 'application/pdf' || ext === 'pdf';
    const isHtml = !isPdf && (contentType.startsWith('text/html') || kind === 'web_page' || kind === 'press_release');

    let pages: Page[] = [];
    let pageCount: number | null = null;
    let sha: string;
    let mime: string;
    let heading: string | null = null;
    let textStatus = 'extracted';
    let ocrStatus = 'not_required';
    if (isHtml) {
      if (kind !== 'web_page' && kind !== 'press_release') {
        await setStatus(env, key, 'skipped', { error: 'HTML page, not a document' });
        return 'skipped';
      }
      const page = extractHtml(new TextDecoder().decode(bytes), res.url || url);
      heading = page.heading;
      const need = str(meta.requireMention);
      if (need && !new RegExp(`\\b${need.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(page.text)) {
        await setStatus(env, key, 'skipped', { error: `does not mention ${need}` });
        return 'skipped';
      }
      if (page.text.length < 80) {
        await setStatus(env, key, 'skipped', { error: 'page has no readable content' });
        return 'skipped';
      }
      pages = [{ number: null, text: page.text }];
      sha = await sha256Hex(page.text);
      mime = 'text/html';
      ext = 'html';
    } else if (isPdf) {
      const pdf = await extractPdf(new Uint8Array(bytes));
      if (!pdf) return 'left_for_github';
      pages = pdf.pages;
      pageCount = pdf.pageCount;
      if (looksScanned(pages)) {
        // A scan: GitHub's job runs OCR on it when it can reach the file; the record is still listed now.
        textStatus = 'empty';
        ocrStatus = 'needed';
        pages = [];
      }
      sha = await sha256Hex(bytes);
      mime = 'application/pdf';
      ext = 'pdf';
    } else {
      return 'left_for_github';
    }
    const title = (str(meta.title) ?? heading ?? str(meta.linkText) ?? fileNameFor(meta, url, 'record', ext)).replace(/\s+/g, ' ').slice(0, 500);
    const result = await indexRecord(
      env,
      {
        key,
        sourceId: item.source_id,
        url: sourceUrl,
        parentUrl: item.parent_url,
        meta,
        title,
        mime,
        fileName: fileNameFor(meta, res.url || url, title, ext),
        bytes: isHtml ? null : bytes,
        ext,
        sha,
        pages,
        pageCount,
        textStatus,
        ocrStatus,
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        httpStatus: res.status,
      },
      budget,
    );
    await setStatus(env, key, 'done', { documentId: result.documentId, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), sha });
    return 'done';
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 400);
    if (e instanceof RobotsBlocked) {
      await setStatus(env, key, 'skipped', { error: msg }).catch(() => undefined);
      return 'skipped';
    }
    if (/quota_exhausted|budget/i.test(msg)) return 'error';
    const retry = new Date(Date.now() + Math.min(24, 2 ** Math.min(item.attempts, 4)) * 3600_000).toISOString();
    await setStatus(env, key, 'error', { error: `worker: ${msg}`, retryAt: retry }).catch(() => undefined);
    return 'error';
  }
}

/**
 * Takes up to `max` pending items the Worker can handle, newest meeting files first, leasing each so
 * a concurrent GitHub run skips it. Stops early when `deadline` (epoch ms) passes.
 */
export async function drainQueue(env: Env, budget: Budget, max: number, deadline: number): Promise<Record<string, number>> {
  const now = new Date().toISOString();
  const res = await env.CATALOG_DB.prepare(
    `SELECT q.*, (SELECT ds.etag FROM document_sources ds WHERE ds.canonical_key = q.url_key LIMIT 1) AS known_etag,
            (SELECT ds.last_modified FROM document_sources ds WHERE ds.canonical_key = q.url_key LIMIT 1) AS known_last_modified
     FROM crawl_queue q
     WHERE q.status = 'pending' AND q.attempts < 5 AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= ?)
       AND coalesce(json_extract(q.metadata_json, '$.kind'), '') <> 'mco_content'
       AND coalesce(json_extract(q.metadata_json, '$.workerSkip'), 0) = 0
     ORDER BY q.priority, q.discovered_at DESC LIMIT ?`,
  )
    .bind(now, max * 3)
    .all<QueueRow>();
  const counts: Record<string, number> = {};
  let handled = 0;
  for (const item of res.results ?? []) {
    if (handled >= max || Date.now() > deadline) break;
    const lease = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
    const claimed = await env.CATALOG_DB.prepare(`UPDATE crawl_queue SET next_attempt_at = ? WHERE url_key = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`).bind(lease, item.url_key, now).run();
    if (!Number(claimed.meta?.changes ?? 0)) continue;
    const outcome = await ingestItem(env, item, budget);
    if (outcome === 'left_for_github') {
      // Hand it back to the GitHub job and never pick it up here again.
      await env.CATALOG_DB.prepare(`UPDATE crawl_queue SET next_attempt_at = NULL, metadata_json = json_set(coalesce(metadata_json, '{}'), '$.workerSkip', 1) WHERE url_key = ?`).bind(item.url_key).run();
    } else handled++;
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  return counts;
}
