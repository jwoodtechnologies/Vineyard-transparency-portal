/**
 * Records added on the portal itself rather than read from a government site: uploads by portal
 * staff (owner and invited uploaders) and resident submissions from the public /add page.
 */
export const STAFF_SOURCE_ID = 'portal-staff';
export const RESIDENT_SOURCE_ID = 'resident-submitted';
export const STAFF_LABEL = 'Added by portal staff';
export const RESIDENT_LABEL = 'Resident submitted. Not a city record.';
export const RESIDENT_TYPE = 'resident_submission';
export const PORTAL_SOURCES = new Set([STAFF_SOURCE_ID, RESIDENT_SOURCE_ID]);

/** The label a record from this source carries wherever it is shown, or null for city records. */
export function sourceLabelFor(sourceId: string | null | undefined): string | null {
  if (sourceId === RESIDENT_SOURCE_ID) return RESIDENT_LABEL;
  if (sourceId === STAFF_SOURCE_ID) return STAFF_LABEL;
  return null;
}

export type FileKind = 'pdf' | 'png' | 'jpg' | 'txt' | 'csv';

/** The file's real type from its first bytes (never from its name or the browser's claim). */
export function sniffFile(bytes: Uint8Array, name = ''): FileKind | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return 'pdf';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  // Text files have no signature: valid UTF-8 with no control bytes, named .txt or .csv.
  const ext = /\.(txt|csv)$/i.exec(name)?.[1]?.toLowerCase() as 'txt' | 'csv' | undefined;
  if (ext && looksLikeText(b)) return ext;
  return null;
}

function looksLikeText(b: Uint8Array): boolean {
  const sample = b.subarray(0, Math.min(b.length, 64 * 1024));
  for (const c of sample) if (c === 0 || (c < 0x09) || (c > 0x0d && c < 0x20 && c !== 0x1b)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(sample.length < b.length ? sample.subarray(0, lastBoundary(sample)) : sample);
    return true;
  } catch {
    return false;
  }
}

/** Cut a sample at a UTF-8 character boundary. */
function lastBoundary(b: Uint8Array): number {
  let i = b.length;
  while (i > 0 && (b[i - 1] & 0xc0) === 0x80) i--;
  return i > 0 && b[i - 1] >= 0xc0 ? i - 1 : b.length;
}

export const MIME: Record<FileKind, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', txt: 'text/plain', csv: 'text/csv' };

/** A safe file name: letters, digits, spaces, dots, dashes, underscores and brackets; the real extension. */
export function sanitizeName(name: string, kind: FileKind): string {
  const base = name
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ._()-]+/g, '_')
    .replace(/^[.\s_-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${base || 'file'}.${kind}`;
}

/** A title from a file name: "2026-05_staff-report.pdf" reads "2026 05 staff report". */
export function titleFromName(name: string): string {
  const t = name
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (t || 'Untitled').slice(0, 200);
}

/** Plain text only: control characters dropped, line breaks kept, length capped. Never HTML-interpreted anywhere. */
export function plainText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max);
}

/** One line of plain text (titles, names). */
export function plainLine(v: unknown, max: number): string {
  return plainText(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An http(s) web address, or null. */
export function webUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 1000) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** The record types staff can pick for a file, mapped to the catalog vocabulary. */
export const STAFF_TYPES: Record<string, string> = {
  agenda: 'agenda',
  minutes: 'minutes',
  ordinance: 'ordinance',
  resolution: 'resolution',
  contract: 'contract',
  bid_award: 'procurement',
  staff_report: 'staff_report',
  budget: 'budget',
  notice: 'public_notice',
  other: 'other',
};
