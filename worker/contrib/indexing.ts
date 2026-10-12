/**
 * Indexing for records added on the portal (staff uploads and resident submissions), through the
 * same pipeline as the city's own records: indexRecord (catalog row, provenance, archived copy) and
 * putChunks (search shards, which search and chat read). Small files are indexed in the request;
 * big PDFs get a title entry at once and their full text from the five-minute cron.
 */
import type { Env } from '../env';
import { intVar } from '../env';
import { Budget, putChunks } from '../admin/routes';
import { categoriesForType, normalizeType } from '../lib/taxonomy';
import { nowIso } from '../lib/util';
import { RESIDENT_LABEL, RESIDENT_SOURCE_ID, STAFF_SOURCE_ID, type FileKind } from '../lib/contrib';
import { SearchRepository } from '../search/SearchRepository';
import { chunkPages } from '../sync/chunk';
import { extractPdf, looksScanned, type Page } from '../sync/extract';
import { indexRecord, sha256Hex } from '../sync/ingest';
import { ensureContribTables } from './schema';
import { DEFAULT_HARD_STOP_BYTES } from '../lib/archivePolicy';

/** PDFs up to this size are read in the request; bigger ones are queued for the cron. */
export const SYNC_PDF_BYTES = 4 * 1024 * 1024;

export type ContribKind = 'file' | 'project' | 'note' | 'link';
export type Origin = 'staff' | 'resident';

export interface Contribution {
  origin: Origin;
  id: string;
  kind: ContribKind;
  title: string;
  docType: string;
  docDate: string | null;
  body: string | null;
  url: string | null;
  statusText: string | null;
  location: string | null;
  meetingId: string | null;
  projectName: string | null;
  fileKind: FileKind | null;
  fileName: string | null;
  mime: string | null;
  fileSize: number | null;
  sha256: string | null;
  fileKey: string | null;
  /** A staff text or CSV file's content (kept with the upload, since text files have no stored copy). */
  fileText: string | null;
}

const sourceOf = (c: Contribution) => (c.origin === 'staff' ? STAFF_SOURCE_ID : RESIDENT_SOURCE_ID);

/** The words a record is found by: its title, the details given with it, and for residents the label. */
export function headerText(c: Contribution): string {
  const lines: string[] = [];
  if (c.origin === 'resident') lines.push(RESIDENT_LABEL);
  if (c.kind === 'project') {
    lines.push(`Project: ${c.title}`);
    if (c.statusText) lines.push(`Status: ${c.statusText}`);
    if (c.location) lines.push(`Location: ${c.location}`);
  } else if (c.kind === 'link') {
    lines.push(c.title);
    if (c.url) lines.push(`Web address: ${c.url}`);
  } else if (c.kind === 'file') {
    lines.push(c.title);
  }
  if (c.projectName) lines.push(`Project: ${c.projectName}`);
  if (c.body) lines.push('', c.body);
  return lines.join('\n').trim();
}

function canonicalSeed(c: Contribution): string {
  return `${sourceOf(c)}:${c.id}`;
}

/** Text of the file itself (PDF text layer, or a text file), or [] for images and scans. */
export async function filePages(bytes: Uint8Array, kind: FileKind | null): Promise<{ pages: Page[]; pageCount: number | null; scanned: boolean }> {
  if (kind === 'pdf') {
    // A copy: the PDF reader may take over (detach) the buffer it is given.
    const pdf = await extractPdf(bytes.slice());
    if (!pdf) return { pages: [], pageCount: null, scanned: false };
    if (looksScanned(pdf.pages)) return { pages: [], pageCount: pdf.pageCount, scanned: true };
    return { pages: pdf.pages, pageCount: pdf.pageCount, scanned: false };
  }
  if (kind === 'txt' || kind === 'csv') {
    const text = new TextDecoder().decode(bytes.subarray(0, 2 * 1024 * 1024));
    return { pages: [{ number: 1, text }], pageCount: 1, scanned: false };
  }
  return { pages: [], pageCount: null, scanned: false };
}

/** Replaces a record's search chunks with these pages. */
export async function writeChunks(env: Env, docId: string, pages: Page[], budget: Budget): Promise<number> {
  const chunks = chunkPages(pages.filter((p) => p.text.trim()));
  if (!chunks.length) return 0;
  for (let off = 0; off < chunks.length; off += 200) {
    const batch = chunks.slice(off, off + 200).map((ch) => ({ id: `${docId}:c${String(ch.index).padStart(5, '0')}`, pageStart: ch.pageStart, pageEnd: ch.pageEnd, sectionTitle: ch.sectionTitle, text: ch.text, ocr: false }));
    await putChunks(env, docId, { chunks: batch, append: off > 0, offset: off }, budget);
  }
  return chunks.length;
}

/**
 * Creates the catalog record and indexes it. A file's bytes are passed for small files (indexed now);
 * `queueFull` adds a title entry now and leaves the file's text to the cron.
 */
export async function createRecord(env: Env, c: Contribution, bytes: Uint8Array | null, budget: Budget, queueFull: boolean): Promise<{ documentId: string; indexStatus: string }> {
  await ensureContribTables(env);
  const key = await sha256Hex(canonicalSeed(c));
  const header = headerText(c);
  let pages: Page[] = header ? [{ number: null, text: header }] : [];
  let pageCount: number | null = null;
  let indexStatus = 'done';
  if (bytes && !queueFull) {
    const f = await filePages(bytes, c.fileKind);
    pages = [...pages, ...f.pages];
    pageCount = f.pageCount;
    if (f.scanned) indexStatus = 'no_text';
  } else if (queueFull) indexStatus = 'queued';
  // Staff files keep their real hash (one stored copy per file); everything else gets a hash of its own so it never merges with another record.
  const sha = c.origin === 'staff' && c.kind === 'file' && c.sha256 ? c.sha256 : await sha256Hex(`${canonicalSeed(c)}:${c.sha256 ?? header}`);
  const isFile = c.kind === 'file' && bytes != null;
  const out = await indexRecord(
    env,
    {
      key,
      sourceId: sourceOf(c),
      // Staff links point at the page they name; nothing else has a web address of its own.
      url: c.origin === 'staff' && c.kind === 'link' && c.url ? c.url : `vtp:${sourceOf(c)}/${c.id}`,
      meta: { documentDate: c.docDate, meetingId: c.origin === 'staff' ? c.meetingId : null, sectionHeading: c.body ? c.body.slice(0, 600) : null },
      title: c.title,
      documentType: c.docType,
      mime: isFile ? (c.mime ?? 'application/octet-stream') : 'text/plain',
      fileName: c.fileName ?? `${c.title.replace(/[^A-Za-z0-9 ._()-]+/g, '_').slice(0, 100) || 'record'}.txt`,
      bytes: isFile ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : null,
      ext: c.fileKind ?? 'txt',
      sha,
      pages,
      pageCount,
      textStatus: 'extracted',
      ocrStatus: 'not_required',
      archive: c.origin === 'staff' ? 'always' : 'never',
    },
    budget,
  );
  if (out.status !== 'new') {
    // Never adopt a record that already existed (another source's copy of the same file).
    throw new Error(`not_new:${out.documentId}`);
  }
  if (c.origin === 'resident' && c.fileKey) {
    await env.CATALOG_DB.prepare("UPDATE documents SET archive_key = ?, archive_status = 'archived', archived_at = ?, file_size = ? WHERE id = ?").bind(c.fileKey, nowIso(), c.fileSize, out.documentId).run();
  }
  if (queueFull) await enqueue(env, out.documentId, c.origin, c.id);
  return { documentId: out.documentId, indexStatus };
}

export async function enqueue(env: Env, documentId: string, origin: Origin, itemId: string): Promise<void> {
  await env.CATALOG_DB.prepare('INSERT INTO contrib_queue (document_id, origin, item_id, queued_at) VALUES (?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET queued_at = excluded.queued_at, attempts = 0, last_error = NULL')
    .bind(documentId, origin, itemId, nowIso())
    .run();
}

/** Applies edited details to an existing record and indexes it again. */
export async function updateRecord(env: Env, documentId: string, c: Contribution, budget: Budget): Promise<string> {
  const type = normalizeType(c.docType);
  await env.CATALOG_DB.prepare(
    `UPDATE documents SET title = ?, description = ?, document_type = ?, categories_json = ?, document_date = ?, year = ?, meeting_id = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(c.title.slice(0, 500), c.body ? c.body.slice(0, 600) : null, type, JSON.stringify(categoriesForType(type)), c.docDate, c.docDate ? Number(c.docDate.slice(0, 4)) : null, c.origin === 'staff' ? c.meetingId : null, nowIso(), documentId)
    .run();
  const header = headerText(c);
  if (c.kind === 'file' && c.fileKind === 'pdf' && (c.fileSize ?? 0) > SYNC_PDF_BYTES) {
    await writeChunks(env, documentId, [{ number: null, text: header }], budget);
    await enqueue(env, documentId, c.origin, c.id);
    return 'queued';
  }
  const bytes = c.kind === 'file' ? await storedBytes(env, documentId, c) : null;
  const f = bytes ? await filePages(bytes, c.fileKind) : { pages: [] as Page[], scanned: false };
  await writeChunks(env, documentId, [{ number: null, text: header }, ...f.pages], budget);
  return f.scanned ? 'no_text' : 'done';
}

/** The stored copy of a record's file. */
async function storedBytes(env: Env, documentId: string, c: Contribution): Promise<Uint8Array | null> {
  if (c.fileText != null) return new TextEncoder().encode(c.fileText);
  if (!env.ARCHIVE) return null;
  let key = c.fileKey;
  if (!key) {
    const row = await env.CATALOG_DB.prepare('SELECT archive_key FROM documents WHERE id = ?').bind(documentId).first<{ archive_key: string | null }>();
    key = row?.archive_key ?? null;
  }
  if (!key) return null;
  const obj = await env.ARCHIVE.get(key);
  return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
}

/** Removes a record from the catalog and search. The stored file goes too when nothing else uses it. */
export async function removeRecord(env: Env, documentId: string, origin: Origin, opts: { keepFile?: boolean } = {}): Promise<void> {
  const db = env.CATALOG_DB;
  const doc = await db.prepare('SELECT id, search_shard, archive_key, archive_status, file_size, source_id FROM documents WHERE id = ?').bind(documentId).first<{ id: string; search_shard: number | null; archive_key: string | null; archive_status: string; file_size: number | null; source_id: string }>();
  if (!doc) {
    await db.prepare('DELETE FROM contrib_queue WHERE document_id = ?').bind(documentId).run();
    return;
  }
  // Only portal records are ever removed this way.
  if (doc.source_id !== (origin === 'staff' ? STAFF_SOURCE_ID : RESIDENT_SOURCE_ID)) throw new Error('Not a portal record.');
  const repo = new SearchRepository(env);
  if (doc.search_shard != null && repo.available) await repo.removeDocument(Number(doc.search_shard), documentId).catch(() => 0);
  await db.batch([
    db.prepare('DELETE FROM document_sources WHERE document_id = ?').bind(documentId),
    db.prepare('DELETE FROM document_versions WHERE document_id = ?').bind(documentId),
    db.prepare('DELETE FROM document_relationships WHERE from_document_id = ?').bind(documentId),
    db.prepare('DELETE FROM contrib_queue WHERE document_id = ?').bind(documentId),
    db.prepare('DELETE FROM documents WHERE id = ?').bind(documentId),
  ]);
  const key = doc.archive_status === 'archived' ? doc.archive_key : null;
  if (key && env.ARCHIVE && !opts.keepFile) {
    if (origin === 'resident') {
      await env.ARCHIVE.delete(key);
    } else {
      const other = await db.prepare('SELECT 1 FROM documents WHERE archive_key = ? LIMIT 1').bind(key).first();
      if (!other) {
        const head = await env.ARCHIVE.head(key);
        await env.ARCHIVE.delete(key);
        await db.prepare('UPDATE archive_stats SET stored_bytes = max(0, stored_bytes - ?), stored_objects = max(0, stored_objects - 1), updated_at = ? WHERE id = 1').bind(head?.size ?? doc.file_size ?? 0, nowIso()).run();
      }
    }
  }
  await purgeCached(documentId);
}

/** Drops the edge copies of a record's pages so a change shows at once (best effort, this location). */
export async function purgeCached(documentId: string): Promise<void> {
  try {
    const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
    if (!cache) return;
    for (const p of ['', '/text', '/related', '/trail']) await cache.delete(new Request(`https://vineyardportal.org/api/documents/${documentId}${p}`));
  } catch {
    /* nothing cached here */
  }
}

/** Free archive space left before the storage stop (ARCHIVE_STORAGE_HARD_STOP_BYTES). */
export async function archiveRoom(env: Env): Promise<{ stored: number; hardStop: number }> {
  const stats = await env.CATALOG_DB.prepare('SELECT stored_bytes FROM archive_stats WHERE id = 1').first<{ stored_bytes: number }>();
  return { stored: Number(stats?.stored_bytes ?? 0), hardStop: intVar(env.ARCHIVE_STORAGE_HARD_STOP_BYTES, DEFAULT_HARD_STOP_BYTES) };
}

type ItemRow = Record<string, unknown>;

/** A stored upload or submission row as a Contribution. */
export function contributionFrom(origin: Origin, r: ItemRow, projectName: string | null = null): Contribution {
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    origin,
    id: String(r.id),
    kind: String(r.kind) as ContribKind,
    title: String(r.title),
    docType: origin === 'staff' ? String(r.doc_type) : 'resident_submission',
    docDate: s(r.doc_date),
    body: s(r.body),
    url: s(r.url),
    statusText: s(r.status_text),
    location: s(r.location),
    meetingId: s(r.meeting_id),
    projectName,
    fileKind: (s(r.file_name)?.split('.').pop() as FileKind | undefined) ?? null,
    fileName: s(r.file_name),
    mime: s(r.mime),
    fileSize: r.file_size == null ? null : Number(r.file_size),
    sha256: s(r.sha256),
    fileKey: s(r.file_key),
    fileText: s(r.file_text),
  };
}

/** Five-minute cron: full text of queued big PDFs. */
export async function drainContribQueue(env: Env, budget: Budget, deadline: number): Promise<Record<string, number>> {
  await ensureContribTables(env);
  const db = env.CATALOG_DB;
  const rows = await db.prepare('SELECT * FROM contrib_queue WHERE attempts < 3 ORDER BY queued_at LIMIT 3').all<{ document_id: string; origin: Origin; item_id: string; attempts: number }>();
  const out = { done: 0, failed: 0 };
  for (const q of rows.results ?? []) {
    if (Date.now() > deadline) break;
    const table = q.origin === 'staff' ? 'uploads' : 'resident_submissions';
    try {
      const item = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(q.item_id).first<ItemRow>();
      if (!item || (q.origin === 'resident' && (item.hidden_at || item.removed_at))) {
        await db.prepare('DELETE FROM contrib_queue WHERE document_id = ?').bind(q.document_id).run();
        continue;
      }
      const projectName = q.origin === 'staff' && item.project_id ? ((await db.prepare('SELECT title FROM uploads WHERE id = ?').bind(item.project_id).first<{ title: string }>())?.title ?? null) : null;
      const c = contributionFrom(q.origin, item, projectName);
      const bytes = await storedBytes(env, q.document_id, c);
      if (!bytes) throw new Error('stored file not found');
      const f = await filePages(bytes, c.fileKind);
      await writeChunks(env, q.document_id, [{ number: null, text: headerText(c) }, ...f.pages], budget);
      if (f.pageCount) await db.prepare('UPDATE documents SET page_count = ? WHERE id = ?').bind(f.pageCount, q.document_id).run();
      await db.batch([db.prepare(`UPDATE ${table} SET index_status = ? WHERE id = ?`).bind(f.scanned ? 'no_text' : 'done', q.item_id), db.prepare('DELETE FROM contrib_queue WHERE document_id = ?').bind(q.document_id)]);
      await purgeCached(q.document_id);
      out.done++;
    } catch (e) {
      out.failed++;
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      await db.prepare('UPDATE contrib_queue SET attempts = attempts + 1, last_error = ? WHERE document_id = ?').bind(msg, q.document_id).run();
      if (q.attempts + 1 >= 3) await db.prepare(`UPDATE ${table} SET index_status = 'failed' WHERE id = ?`).bind(q.item_id).run();
    }
  }
  return out;
}
