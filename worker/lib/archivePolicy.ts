/**
 * Which records get an archived copy in R2. Storage stops at ARCHIVE_STORAGE_HARD_STOP_BYTES, so
 * the space goes to the records a city is most likely to move or remove. Agenda packets and other
 * attachments stay as links to the city's own copy (their text is still indexed for search and chat).
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

/** An agenda-item attachment title ends like "(..., 2026-06-23, item 4)". */
const ATTACHMENT_TITLE = /, 20\d\d-\d\d-\d\d(, item [^)]*)?\)$/;

export function shouldArchive(documentType: unknown, title?: unknown): boolean {
  const type = String(documentType ?? '');
  if (!ARCHIVE_TYPES.has(type)) return false;
  const t = String(title ?? '');
  if (/\bpacket\b/i.test(t)) return false;
  // Attachments are archived only when they are themselves an ordinance, resolution, notice, budget or audit.
  if (ATTACHMENT_TITLE.test(t) && (type === 'agenda' || type === 'minutes')) return false;
  return true;
}
