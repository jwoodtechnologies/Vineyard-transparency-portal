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
  SearchSort,
  SourceRegistryEntry,
  SuggestedQuery,
  Topic,
  TopicDetail,
} from '@/types/models';

export interface DocumentListRequest {
  filters?: SearchFilters;
  sort?: Exclude<SearchSort, 'relevance'>;
  page?: number;
  pageSize?: number;
}

export interface MeetingListRequest {
  governmentBodyId?: string;
  year?: number;
  page?: number;
  pageSize?: number;
  sort?: 'date_desc' | 'date_asc';
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * Backend-neutral data access contract. React components never talk to a database or HTTP
 * directly — they call services, which call the active adapter.
 *
 * Implementations:
 *  - MockDataAdapter: in-memory, clearly labeled demo data (VITE_DATA_MODE=mock)
 *  - ProductionApiAdapter: REST contract in docs/API_CONTRACT.md (VITE_DATA_MODE=api)
 */
export interface DataAdapter {
  readonly mode: 'mock' | 'api';

  health(opts?: RequestOptions): Promise<HealthStatus>;

  ask(request: AskRequest, opts?: RequestOptions): Promise<AskResponse>;
  search(request: SearchRequest, opts?: RequestOptions): Promise<SearchResponse>;

  listDocuments(request: DocumentListRequest, opts?: RequestOptions): Promise<Paginated<DocumentSummary>>;
  getDocument(id: string, opts?: RequestOptions): Promise<DocumentDetail>;
  getDocumentText(id: string, opts?: RequestOptions): Promise<DocumentPageText[]>;
  getRelatedDocuments(id: string, opts?: RequestOptions): Promise<RelatedDocument[]>;
  /** URL that streams the archived file (GET /api/documents/:id/file). */
  getDocumentFileUrl(id: string, archiveUrl: string | null): string | null;
  getDocumentsByIds(ids: string[], opts?: RequestOptions): Promise<DocumentSummary[]>;

  listMeetings(request: MeetingListRequest, opts?: RequestOptions): Promise<Paginated<MeetingSummary>>;
  getMeeting(id: string, opts?: RequestOptions): Promise<Meeting>;

  listGovernmentBodies(opts?: RequestOptions): Promise<GovernmentBody[]>;
  getGovernmentBody(id: string, opts?: RequestOptions): Promise<GovernmentBody>;

  listCategories(opts?: RequestOptions): Promise<Category[]>;
  getBrowseFacets(opts?: RequestOptions): Promise<BrowseFacets>;

  listSources(opts?: RequestOptions): Promise<SourceRegistryEntry[]>;
  getSource(id: string, opts?: RequestOptions): Promise<SourceRegistryEntry>;

  getStatistics(opts?: RequestOptions): Promise<ArchiveStatistics>;
  getSuggestions(opts?: RequestOptions): Promise<SuggestedQuery[]>;

  listTopics(opts?: RequestOptions): Promise<Topic[]>;
  getTopic(id: string, opts?: RequestOptions): Promise<TopicDetail>;

  getMunicipalCode(opts?: RequestOptions): Promise<CodeNode[]>;

  submitIssueReport(report: IssueReport, opts?: RequestOptions): Promise<IssueReportReceipt>;
}
