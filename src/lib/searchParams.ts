import type { CategoryId, DocumentType, SearchFilters, SearchMatchMode, SearchRequest, SearchSort } from '@/types/models';

/** Serializes search state into a shareable URL: /search?q=parking&type=resolution&year=2026 */
export function searchRequestToParams(req: SearchRequest): URLSearchParams {
  const p = new URLSearchParams();
  if (req.query) p.set('q', req.query);
  const f = req.filters ?? {};
  f.documentTypes?.forEach((t) => p.append('type', t));
  f.categories?.forEach((c) => p.append('category', c));
  f.years?.forEach((y) => p.append('year', String(y)));
  f.governmentBodyIds?.forEach((b) => p.append('body', b));
  f.sourceIds?.forEach((s) => p.append('source', s));
  if (f.dateFrom) p.set('from', f.dateFrom);
  if (f.dateTo) p.set('to', f.dateTo);
  if (f.meetingId) p.set('meeting', f.meetingId);
  if (req.match && req.match !== 'all') p.set('match', req.match);
  if (req.titleOnly) p.set('title', '1');
  if (req.sort && req.sort !== 'relevance') p.set('sort', req.sort);
  if (req.page && req.page > 1) p.set('page', String(req.page));
  return p;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function paramsToSearchRequest(p: URLSearchParams): SearchRequest {
  const filters: SearchFilters = {};
  const types = p.getAll('type').filter(Boolean) as DocumentType[];
  if (types.length) filters.documentTypes = types;
  const cats = p.getAll('category').filter(Boolean) as CategoryId[];
  if (cats.length) filters.categories = cats;
  const years = p
    .getAll('year')
    .map(Number)
    .filter((y) => Number.isInteger(y) && y > 1800 && y < 2200);
  if (years.length) filters.years = years;
  const bodies = p.getAll('body').filter(Boolean);
  if (bodies.length) filters.governmentBodyIds = bodies;
  const sources = p.getAll('source').filter(Boolean);
  if (sources.length) filters.sourceIds = sources;
  const from = p.get('from');
  if (from && DATE_RE.test(from)) filters.dateFrom = from;
  const to = p.get('to');
  if (to && DATE_RE.test(to)) filters.dateTo = to;
  const meeting = p.get('meeting');
  if (meeting) filters.meetingId = meeting;
  const match = p.get('match') as SearchMatchMode | null;
  const sort = p.get('sort') as SearchSort | null;
  const page = Number(p.get('page') ?? 1);
  return {
    query: (p.get('q') ?? '').slice(0, 500),
    filters,
    match: match && ['all', 'any', 'phrase'].includes(match) ? match : 'all',
    titleOnly: p.get('title') === '1',
    sort: sort && ['relevance', 'date_desc', 'date_asc', 'title'].includes(sort) ? sort : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: 10,
  };
}

export function countActiveFilters(f: SearchFilters | undefined): number {
  if (!f) return 0;
  return (
    (f.documentTypes?.length ?? 0) +
    (f.categories?.length ?? 0) +
    (f.years?.length ?? 0) +
    (f.governmentBodyIds?.length ?? 0) +
    (f.sourceIds?.length ?? 0) +
    (f.dateFrom ? 1 : 0) +
    (f.dateTo ? 1 : 0) +
    (f.meetingId ? 1 : 0)
  );
}

export function searchPath(req: Partial<SearchRequest> & { query: string }): string {
  const qs = searchRequestToParams({ ...req }).toString();
  return `/search${qs ? `?${qs}` : ''}`;
}

export function askPath(question: string): string {
  return `/ask?q=${encodeURIComponent(question)}`;
}
