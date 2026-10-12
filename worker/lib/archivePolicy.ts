/**
 * Which records get a stored copy in R2, and in what order. Every downloaded file (PDFs, Word files,
 * spreadsheets, images) is kept on the portal's own storage so it opens from the portal, not from the
 * city's site. The owner approved storing every public record file past the free 10 GB-month on 2026-10-12
 * (docs/FREE_TIER_LIMITS.md). Storage still stops at ARCHIVE_STORAGE_HARD_STOP_BYTES, which can never pass
 * ARCHIVE_STORAGE_CEILING_BYTES, so the monthly cost has a fixed worst case. Priority records come first:
 * minutes, agendas, ordinances, resolutions, notices, budgets and audits. Other files (agenda packets, staff
 * reports, slides) stop a little earlier, at the stop minus ARCHIVE_PRIORITY_RESERVE_BYTES, so new priority
 * records always find room.
 */
export const ARCHIVE_TYPES = new Set(['minutes', 'agenda', 'ordinance', 'resolution', 'public_notice', 'budget', 'audit', 'financial_report']);

/** Lower number = archived first when space is short. */
export const ARCHIVE_RANK: Record<string, number> = {
  minutes: 0,
  agenda: 1,
  ordinance: 2,
  resolution: 3,
  public_notice: 4,
  budget: 5,
  audit: 6,
  financial_report: 7,
};
/** Every other file, after the priority records; agenda packets (the largest files) last. */
export const OTHER_RANK = 8;
export const PACKET_RANK = 9;

/**
 * The stop when ARCHIVE_STORAGE_HARD_STOP_BYTES is not set: 60 GB (decimal). Every remaining public record file
 * came to about 37 GB on 2026-10-12 (38.6 GB with the account's other buckets), so 60 GB covers all of it with room
 * for years of new records. Beyond the free 10 GB-month, R2 Standard storage is $0.015 per GB-month: a full
 * 60 GB bucket would cost about (60 - 10) x 0.015 = $0.75 a month, the worst case.
 */
export const DEFAULT_HARD_STOP_BYTES = 60_000_000_000;

/**
 * The ceiling the stop can never pass (ARCHIVE_STORAGE_CEILING_BYTES, 60 GB unless set). Raising the stop alone
 * does nothing past it; raising both is a deliberate second change.
 */
export const DEFAULT_CEILING_BYTES = 60_000_000_000;

/** A mistyped ceiling (an extra zero) still never passes 100 GB, about $1.35 a month. */
export const MAX_CEILING_BYTES = 100_000_000_000;

/** Space kept for priority records when other files are stored (500 MB unless the variable says otherwise). */
export const DEFAULT_PRIORITY_RESERVE_BYTES = 500_000_000;

/**
 * The largest file sent to the Worker in one request (ARCHIVE_MAX_OBJECT_BYTES, 25 MiB). Larger files go up in
 * parts (R2 multipart, /api/admin/archive/multipart/...), since a Worker request body is limited (100 MB on Paid).
 */
export const DEFAULT_MAX_OBJECT_BYTES = 25 * 1024 * 1024;

/** The largest file stored at all (ARCHIVE_MAX_LARGE_OBJECT_BYTES, 500 MB). Larger files are linked and logged. */
export const DEFAULT_MAX_LARGE_OBJECT_BYTES = 500_000_000;
/** No setting can make the largest stored file pass 1 GB. */
export const MAX_LARGE_OBJECT_BYTES = 1_000_000_000;

/** The part size the ingest uploads large files in (R2 needs at least 5 MiB for every part but the last). */
export const MULTIPART_PART_BYTES = 20 * 1024 * 1024;
/** The largest part the Worker accepts (well under the 100 MB request body limit). */
export const MAX_PART_BYTES = 50 * 1024 * 1024;
/** R2 allows at most 10,000 parts per upload. */
export const MAX_PARTS = 10_000;

export interface ArchiveLimitVars {
  ARCHIVE_STORAGE_HARD_STOP_BYTES?: string;
  ARCHIVE_STORAGE_CEILING_BYTES?: string;
  ARCHIVE_PRIORITY_RESERVE_BYTES?: string;
  ARCHIVE_MAX_OBJECT_BYTES?: string;
  ARCHIVE_MAX_LARGE_OBJECT_BYTES?: string;
}

export interface ArchiveLimits {
  /** The stop every upload is checked against: the configured stop, never above the ceiling. */
  hardStop: number;
  /** The ceiling itself (never above MAX_CEILING_BYTES). */
  ceiling: number;
  reserve: number;
  /** The largest single-request upload. */
  maxObject: number;
  /** The largest file stored at all. */
  maxLargeObject: number;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** The archive's limits from the Worker variables, with the ceiling applied. */
export function archiveLimits(vars: ArchiveLimitVars): ArchiveLimits {
  const ceiling = Math.min(num(vars.ARCHIVE_STORAGE_CEILING_BYTES, DEFAULT_CEILING_BYTES), MAX_CEILING_BYTES);
  const hardStop = Math.min(num(vars.ARCHIVE_STORAGE_HARD_STOP_BYTES, DEFAULT_HARD_STOP_BYTES), ceiling);
  const maxLargeObject = Math.min(num(vars.ARCHIVE_MAX_LARGE_OBJECT_BYTES, DEFAULT_MAX_LARGE_OBJECT_BYTES), MAX_LARGE_OBJECT_BYTES);
  const maxObject = Math.min(num(vars.ARCHIVE_MAX_OBJECT_BYTES, DEFAULT_MAX_OBJECT_BYTES), maxLargeObject);
  return { hardStop, ceiling, reserve: num(vars.ARCHIVE_PRIORITY_RESERVE_BYTES, DEFAULT_PRIORITY_RESERVE_BYTES), maxObject, maxLargeObject };
}

/** An agenda-item attachment title ends like "(..., 2026-06-23, item 4)". */
const ATTACHMENT_TITLE = /, 20\d\d-\d\d-\d\d(, item [^)]*)?\)$/;

/** A priority record: kept first and allowed up to the hard stop itself. */
export function isPriorityArchive(documentType: unknown, title?: unknown): boolean {
  const type = String(documentType ?? '');
  if (!ARCHIVE_TYPES.has(type)) return false;
  const t = String(title ?? '');
  if (/\bpacket\b/i.test(t)) return false;
  // Attachments are priority only when they are themselves an ordinance, resolution, notice, budget or audit.
  if (ATTACHMENT_TITLE.test(t) && (type === 'agenda' || type === 'minutes')) return false;
  return true;
}

/** Every record with a file is stored while space lasts (web pages and media are never files here). */
export function shouldArchive(documentType: unknown, title?: unknown): boolean {
  void documentType;
  void title;
  return true;
}

/** The order files are stored in when space is short (lower first). */
export function archiveRank(documentType: unknown, title?: unknown): number {
  const type = String(documentType ?? '');
  if (isPriorityArchive(type, title)) return ARCHIVE_RANK[type] ?? OTHER_RANK;
  if (type === 'agenda_packet' || /\bpacket\b/i.test(String(title ?? ''))) return PACKET_RANK;
  return OTHER_RANK;
}

/** The byte limit a file of this kind may fill the archive to. */
export function archiveLimitFor(documentType: unknown, title: unknown, hardStop: number, reserve: number): number {
  return isPriorityArchive(documentType, title) ? hardStop : Math.max(0, hardStop - Math.max(0, reserve));
}

/** The order files are stored in: priority rank first, then newest first. */
export function archiveOrder<T extends { document_type: string; title: string | null; document_date: string | null }>(a: T, b: T): number {
  return archiveRank(a.document_type, a.title) - archiveRank(b.document_type, b.title) || String(b.document_date ?? '').localeCompare(String(a.document_date ?? ''));
}
