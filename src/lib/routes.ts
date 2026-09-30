import type { DocumentSummary } from '@/types/models';

/** Stable, shareable document URL, optionally jumping to a page and highlighting terms. */
export function docHref(doc: Pick<DocumentSummary, 'id'>, page?: number | null, q?: string) {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (q) params.set('q', q);
  const qs = params.toString();
  return `/documents/${encodeURIComponent(doc.id)}${qs ? `?${qs}` : ''}`;
}
