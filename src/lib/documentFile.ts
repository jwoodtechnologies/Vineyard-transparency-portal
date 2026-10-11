/**
 * Where a record's file can be read from, shared by the Worker (GET /api/documents/:id/file) and the viewer.
 *
 * - archive: the portal's own copy (R2), always same origin.
 * - proxy: no copy yet, but the official file is on a government host the Worker streams through the portal
 *   (same origin, edge cached, robots.txt honored, size capped). CivicClerk is not on this list: it refuses
 *   Cloudflare's network (HTTP 403), so its files are read from the browser instead (direct, below).
 * - direct: a host the browser may read itself (pdf.js over CORS) when there is no copy and no proxy.
 */

/** Official hosts whose PDFs the Worker may stream when it has no archived copy of its own. */
export const PROXY_HOSTS = /^https:\/\/(s3[.-][a-z0-9-]*\.amazonaws\.com\/municipalcodeonline|s3\.amazonaws\.com\/municipalcodeonline|(www\.)?vineyardutah\.(gov|org)|cms3\.revize\.com|www\.utah\.gov\/pmn\/files)\//i;

/** Hosts a browser may read a PDF from directly (listed in connect-src in public/_headers). */
export const DIRECT_HOSTS = /^https:\/\/(vineyardut\.api\.civicclerk\.com|civicclerk\.blob\.core\.windows\.net)\//i;

/** The largest file the Worker streams on a reader's behalf (a bigger one opens at the city's own address). */
export const PROXY_MAX_BYTES = 80 * 1024 * 1024;

export type FileRoute = 'archive' | 'proxy' | 'direct' | 'none';

export function fileRoute(doc: { archiveUrl: string | null; originalUrl?: string | null }): FileRoute {
  if (doc.archiveUrl) return 'archive';
  const u = doc.originalUrl ?? '';
  if (PROXY_HOSTS.test(u)) return 'proxy';
  if (DIRECT_HOSTS.test(u)) return 'direct';
  return 'none';
}

/** The kind of file, from its media type: how the viewer shows it. */
export type FileKind = 'pdf' | 'image' | 'text' | 'word' | 'sheet' | 'other';

export function fileKind(mimeType: string | null | undefined, fileName?: string | null): FileKind {
  const m = (mimeType ?? '').toLowerCase();
  const n = (fileName ?? '').toLowerCase();
  if (m === 'application/pdf' || (!m && n.endsWith('.pdf'))) return 'pdf';
  if (/^image\/(png|jpeg|gif|webp)$/.test(m)) return 'image';
  if (/^text\/(html|plain)|application\/xhtml/.test(m)) return 'text';
  if (/wordprocessingml|msword|opendocument\.text|rtf/.test(m) || /\.(docx?|odt|rtf)$/.test(n)) return 'word';
  if (/spreadsheetml|ms-excel|opendocument\.spreadsheet|text\/csv/.test(m) || /\.(xlsx?|ods|csv)$/.test(n)) return 'sheet';
  return 'other';
}

/** A short label for a file that is offered as a download. */
export const FILE_KIND_LABEL: Record<FileKind, string> = {
  pdf: 'PDF',
  image: 'Image',
  text: 'Web page',
  word: 'Word document',
  sheet: 'Spreadsheet',
  other: 'File',
};
