/**
 * ProductionApiAdapter — talks to the Phase 2 backend over the REST contract in
 * docs/API_CONTRACT.md. Switching from demo data to production is configuration only:
 *   VITE_DATA_MODE=api  (and optionally VITE_API_BASE_URL)
 */
import type {
  ArchiveStatistics,
  AskRequest,
  AskResponse,
  BrowseFacets,
  Category,
  CodeNode,
  DocumentDetail,
  DocumentPageText,
  DocumentSummary,
  GovernmentBody,
  HealthStatus,
  IssueReport,
  IssueReportReceipt,
  Meeting,
  MeetingSummary,
  Paginated,
  RelatedDocument,
  SearchFilters,
  SearchRequest,
  SearchResponse,
  SourceRegistryEntry,
  SuggestedQuery,
  Topic,
  TopicDetail,
} from '@/types/models';
import type { DataAdapter, DocumentListRequest, MeetingListRequest, RequestOptions } from './DataAdapter';
import { DataError, toDataError, type DataErrorKind } from './errors';

type Query = Record<string, string | number | boolean | string[] | number[] | undefined | null>;

export function filtersToQuery(f: SearchFilters | undefined): Query {
  if (!f) return {};
  return {
    type: f.documentTypes,
    category: f.categories,
    year: f.years,
    from: f.dateFrom,
    to: f.dateTo,
    body: f.governmentBodyIds,
    source: f.sourceIds,
    meeting: f.meetingId,
    currency: f.currency,
  };
}

export class ProductionApiAdapter implements DataAdapter {
  readonly mode = 'api' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private url(path: string, query?: Query): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(`${this.baseUrl}/api${path}`, origin);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
      else u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async request<T>(path: string, init: { method?: 'GET' | 'POST'; query?: Query; body?: unknown } = {}, opts?: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), this.timeoutMs);
    const onAbort = () => controller.abort(opts?.signal?.reason);
    opts?.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(this.url(path, init.query), {
        method: init.method ?? 'GET',
        headers: init.body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      if (!res.ok) throw await this.errorFrom(res);
      const type = res.headers.get('content-type') ?? '';
      if (!type.includes('application/json')) throw new DataError('bad_response', 'The archive returned an unexpected response.', { status: res.status });
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof DataError) throw e;
      if (controller.signal.aborted && !opts?.signal?.aborted) throw new DataError('timeout', 'The archive took too long to respond.', { cause: e });
      throw toDataError(e);
    } finally {
      clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async errorFrom(res: Response): Promise<DataError> {
    let kind: DataErrorKind =
      res.status === 404 ? 'not_found' : res.status === 429 ? 'rate_limited' : res.status === 400 ? 'bad_request' : res.status >= 500 ? 'server' : 'bad_response';
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { kind?: DataErrorKind; message?: string; retryAfterSeconds?: number } };
      if (body.error?.kind) kind = body.error.kind;
      if (body.error?.message) message = body.error.message;
    } catch {
      /* non-JSON error body */
    }
    const retryHeader = Number(res.headers.get('retry-after'));
    return new DataError(kind, message, { status: res.status, retryAfterSeconds: Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null });
  }

  async health(opts?: RequestOptions): Promise<HealthStatus> {
    try {
      const h = await this.request<Partial<HealthStatus> & { status: string }>('/health', {}, opts);
      return {
        status: (['ok', 'degraded', 'backend_not_connected', 'offline'].includes(h.status) ? h.status : 'degraded') as HealthStatus['status'],
        mode: 'api',
        search: h.search ?? h.status === 'ok',
        ai: h.ai ?? h.status === 'ok',
        checkedAt: h.checkedAt ?? new Date().toISOString(),
        message: h.message,
      };
    } catch (e) {
      const err = toDataError(e);
      return { status: 'offline', mode: 'api', search: false, ai: false, checkedAt: new Date().toISOString(), message: err.message };
    }
  }

  ask(request: AskRequest, opts?: RequestOptions): Promise<AskResponse> {
    return this.request('/ask', { method: 'POST', body: request }, opts);
  }

  search(r: SearchRequest, opts?: RequestOptions): Promise<SearchResponse> {
    return this.request(
      '/search',
      { query: { q: r.query, match: r.match, title: r.titleOnly ? 1 : undefined, sort: r.sort, page: r.page, pageSize: r.pageSize, ...filtersToQuery(r.filters) } },
      opts,
    );
  }

  listDocuments(r: DocumentListRequest, opts?: RequestOptions): Promise<Paginated<DocumentSummary>> {
    return this.request('/documents', { query: { sort: r.sort, page: r.page, pageSize: r.pageSize, ...filtersToQuery(r.filters) } }, opts);
  }

  async getDocumentsByIds(ids: string[], opts?: RequestOptions): Promise<DocumentSummary[]> {
    if (!ids.length) return [];
    const res = await this.request<Paginated<DocumentSummary>>('/documents', { query: { ids: ids.slice(0, 100) } }, opts);
    return res.items;
  }

  getDocument(id: string, opts?: RequestOptions): Promise<DocumentDetail> {
    return this.request(`/documents/${encodeURIComponent(id)}`, {}, opts);
  }

  getDocumentText(id: string, opts?: RequestOptions): Promise<DocumentPageText[]> {
    return this.request(`/documents/${encodeURIComponent(id)}/text`, {}, opts);
  }

  getRelatedDocuments(id: string, opts?: RequestOptions): Promise<RelatedDocument[]> {
    return this.request(`/documents/${encodeURIComponent(id)}/related`, {}, opts);
  }

  getDocumentFileUrl(id: string, archiveUrl: string | null): string | null {
    void archiveUrl;
    return this.url(`/documents/${encodeURIComponent(id)}/file`);
  }

  listMeetings(r: MeetingListRequest, opts?: RequestOptions): Promise<Paginated<MeetingSummary>> {
    return this.request('/meetings', { query: { body: r.governmentBodyId, year: r.year, page: r.page, pageSize: r.pageSize, sort: r.sort } }, opts);
  }

  getMeeting(id: string, opts?: RequestOptions): Promise<Meeting> {
    return this.request(`/meetings/${encodeURIComponent(id)}`, {}, opts);
  }

  listGovernmentBodies(opts?: RequestOptions): Promise<GovernmentBody[]> {
    return this.request('/bodies', {}, opts);
  }

  getGovernmentBody(id: string, opts?: RequestOptions): Promise<GovernmentBody> {
    return this.request(`/bodies/${encodeURIComponent(id)}`, {}, opts);
  }

  listCategories(opts?: RequestOptions): Promise<Category[]> {
    return this.request('/categories', {}, opts);
  }

  getBrowseFacets(opts?: RequestOptions): Promise<BrowseFacets> {
    return this.request('/browse/facets', {}, opts);
  }

  listSources(opts?: RequestOptions): Promise<SourceRegistryEntry[]> {
    return this.request('/sources', {}, opts);
  }

  getSource(id: string, opts?: RequestOptions): Promise<SourceRegistryEntry> {
    return this.request(`/sources/${encodeURIComponent(id)}`, {}, opts);
  }

  getStatistics(opts?: RequestOptions): Promise<ArchiveStatistics> {
    return this.request('/stats', {}, opts);
  }

  getSuggestions(opts?: RequestOptions): Promise<SuggestedQuery[]> {
    return this.request('/suggestions', {}, opts);
  }

  listTopics(opts?: RequestOptions): Promise<Topic[]> {
    return this.request('/topics', {}, opts);
  }

  getTopic(id: string, opts?: RequestOptions): Promise<TopicDetail> {
    return this.request(`/topics/${encodeURIComponent(id)}`, {}, opts);
  }

  getMunicipalCode(opts?: RequestOptions): Promise<CodeNode[]> {
    return this.request('/code', {}, opts);
  }

  submitIssueReport(report: IssueReport, opts?: RequestOptions): Promise<IssueReportReceipt> {
    return this.request('/reports', { method: 'POST', body: report }, opts);
  }
}
