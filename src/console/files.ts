/**
 * Links to a record. A PDF opens in the portal's own viewer (the real PDF, page by page, at the right page),
 * so nobody leaves the site or has to download anything.
 */
export const docHref = (id: string, page?: number | null, query?: string): string => {
  const qs = new URLSearchParams();
  if (page && page > 1) qs.set('page', String(page));
  if (query) qs.set('q', query);
  return `/documents/${encodeURIComponent(id)}${qs.size ? `?${qs.toString()}` : ''}`;
};
