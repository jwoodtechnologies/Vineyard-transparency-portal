/**
 * Which records get a stored copy in R2, and in what order. Every downloaded file (PDFs, Word files,
 * spreadsheets, images) is kept on the portal's own storage so it opens from the portal, not from the
 * city's site. Storage stops at ARCHIVE_STORAGE_HARD_STOP_BYTES (inside the account's free 10 GB-month),
 * so when space is short the priority records come first: minutes, agendas, ordinances, resolutions,
 * notices, budgets and audits. Other files (agenda packets, staff reports, slides) stop a little earlier,
 * at the hard stop minus ARCHIVE_PRIORITY_RESERVE_BYTES, so new priority records always find room.
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
 * The stop when ARCHIVE_STORAGE_HARD_STOP_BYTES is not set: 7.5 GB (decimal). The account's free R2 storage
 * is 10 GB-month for every bucket together; the owner's other buckets held about 1.7 GB when this was set,
 * and this bucket also holds the weekly catalog backups and residents' files, which the stop does not count.
 * 7.5 + 1.7 leaves about 0.8 GB of headroom below 10 GB. See docs/FREE_TIER_LIMITS.md.
 */
export const DEFAULT_HARD_STOP_BYTES = 7_500_000_000;

/** Space kept for priority records when other files are stored (500 MB unless the variable says otherwise). */
export const DEFAULT_PRIORITY_RESERVE_BYTES = 500_000_000;

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
