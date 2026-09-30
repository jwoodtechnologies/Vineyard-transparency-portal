/**
 * Core domain models for the Vineyard Transparency Portal.
 *
 * These types are the contract between the frontend and any backend (mock, REST API,
 * Cloudflare Worker, SQLite, PostgreSQL…). See docs/DATA_MODEL.md and docs/API_CONTRACT.md.
 *
 * Conventions:
 *  - Dates are ISO-8601 strings. `date` fields are calendar dates (YYYY-MM-DD) in America/Denver;
 *    `*At` fields are full timestamps (UTC).
 *  - All text originating from archived documents is UNTRUSTED and must be rendered as text,
 *    never as HTML, and never interpreted as instructions.
 *  - `isDemo` is true for built-in mock data. Demo records must never be presented as real records.
 */

export type ISODate = string;
export type ISODateTime = string;

/* -------------------------------------------------------------------------- */
/* Taxonomy                                                                   */
/* -------------------------------------------------------------------------- */

export type DocumentType =
  | 'agenda'
  | 'agenda_packet'
  | 'minutes'
  | 'ordinance'
  | 'resolution'
  | 'proclamation'
  | 'contract'
  | 'development_agreement'
  | 'interlocal_agreement'
  | 'professional_services_agreement'
  | 'procurement'
  | 'staff_report'
  | 'financial_report'
  | 'budget'
  | 'audit'
  | 'public_notice'
  | 'map'
  | 'study'
  | 'plan'
  | 'presentation'
  | 'exhibit'
  | 'memorandum'
  | 'correspondence'
  | 'transcript'
  | 'recording'
  | 'municipal_code'
  | 'other';

export type CategoryId =
  | 'meetings'
  | 'agendas'
  | 'minutes'
  | 'agenda_packets'
  | 'ordinances'
  | 'resolutions'
  | 'contracts'
  | 'development_agreements'
  | 'budgets_finance'
  | 'audits'
  | 'planning_land_use'
  | 'transportation'
  | 'public_notices'
  | 'reports_studies'
  | 'procurement'
  | 'maps'
  | 'other';

export interface Category {
  id: CategoryId | string;
  label: string;
  description: string;
  /** Document types that roll up into this collection. */
  documentTypes: DocumentType[];
  documentCount: number | null;
}

/**
 * Whether a record reflects currently operative law/policy.
 * Critical for municipal code and ordinances: never present superseded text as current.
 */
export type RecordCurrency = 'current' | 'historical' | 'superseded' | 'amended' | 'unknown';

/* -------------------------------------------------------------------------- */
/* Sources & provenance                                                       */
/* -------------------------------------------------------------------------- */

export type SourceType =
  | 'city_website'
  | 'transparency_portal'
  | 'meeting_portal'
  | 'public_notice_system'
  | 'financial_transparency'
  | 'state_auditor'
  | 'municipal_code'
  | 'document_library'
  | 'gis_portal'
  | 'other';

export type SourceHealthStatus =
  | 'active'
  | 'degraded'
  | 'unreachable'
  | 'changed'
  | 'authentication_required'
  | 'blocked'
  | 'unknown';

export interface SourceHealth {
  status: SourceHealthStatus;
  lastCheckedAt: ISODateTime | null;
  lastSuccessfulCheckAt: ISODateTime | null;
  message?: string;
}

/** A public-record system the archive monitors (config/source-seeds.json → registry). */
export interface SourceRegistryEntry {
  id: string;
  name: string;
  baseUrl: string;
  sourceType: SourceType;
  /** Publishing authority, e.g. "Vineyard City" or "State of Utah". */
  authority: string;
  /** URL of the page this source was discovered from (null for manually configured seeds). */
  discoveredFrom: string | null;
  crawlEnabled: boolean;
  archiveEnabled: boolean;
  documentDiscoveryEnabled: boolean;
  lastChecked: ISODateTime | null;
  notes: string;
  description?: string;
  health?: SourceHealth;
  documentCount?: number | null;
  isDemo?: boolean;
}

/** Provenance of a specific document from a specific source. A document can have many. */
export interface DocumentSource {
  id: string;
  sourceId: string;
  name: string;
  baseUrl: string;
  sourceType: SourceType;
  authority: string;
  originalUrl: string;
  retrievedAt: ISODateTime;
  lastVerifiedAt: ISODateTime | null;
  /** Whether the original URL still resolved at last verification. */
  originalAvailable: boolean | null;
  httpStatusAtLastCheck?: number | null;
}

/* -------------------------------------------------------------------------- */
/* Government bodies & meetings                                               */
/* -------------------------------------------------------------------------- */

export type GovernmentBodyKind = 'council' | 'commission' | 'agency' | 'board' | 'committee' | 'department' | 'other';

export interface GovernmentBody {
  id: string;
  slug: string;
  name: string;
  shortName?: string;
  kind: GovernmentBodyKind;
  description: string;
  meetingCount: number | null;
  documentCount: number | null;
  firstRecordDate: ISODate | null;
  lastRecordDate: ISODate | null;
  isDemo?: boolean;
}

export type MeetingType = 'regular' | 'special' | 'work_session' | 'emergency' | 'hearing' | 'other';

export type MediaKind = 'video' | 'audio' | 'transcript';

export interface MeetingMedia {
  kind: MediaKind;
  label: string;
  url: string | null;
  durationSeconds?: number | null;
  documentId?: string | null;
  sourceId: string;
}

export type MotionOutcome = 'approved' | 'denied' | 'tabled' | 'continued' | 'failed' | 'withdrawn' | 'unknown';

export interface Motion {
  id: string;
  description: string;
  outcome: MotionOutcome;
  /** Vote tally exactly as recorded in the minutes, if recorded. Never inferred. */
  voteRecord: string | null;
  evidence: EvidenceRef;
}

export interface AgendaItem {
  id: string;
  meetingId: string;
  number: string;
  title: string;
  description?: string;
  itemType: 'consent' | 'business' | 'public_hearing' | 'presentation' | 'discussion' | 'report' | 'closed_session' | 'other';
  documentIds: string[];
  motions: Motion[];
  children?: AgendaItem[];
  packetPageStart?: number | null;
  packetPageEnd?: number | null;
}

export interface Meeting {
  id: string;
  slug: string;
  title: string;
  governmentBodyId: string;
  governmentBodyName: string;
  meetingType: MeetingType;
  date: ISODate;
  startTime: string | null;
  location: string | null;
  status: 'scheduled' | 'held' | 'cancelled' | 'postponed' | 'unknown';
  agendaDocumentId: string | null;
  packetDocumentId: string | null;
  minutesDocumentId: string | null;
  minutesStatus: 'approved' | 'draft' | 'not_available';
  media: MeetingMedia[];
  agendaItems: AgendaItem[];
  sourceIds: string[];
  isDemo?: boolean;
}

export type MeetingSummary = Omit<Meeting, 'agendaItems' | 'media'> & {
  agendaItemCount: number;
  hasVideo: boolean;
  hasAudio: boolean;
  hasTranscript: boolean;
};

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

export type OcrStatus = 'not_required' | 'pending' | 'complete' | 'failed';

export interface DocumentEntity {
  /** Entities are public-record subjects only: projects, streets, organizations, programs, bodies. */
  type: 'organization' | 'project' | 'place' | 'street' | 'program' | 'government_body' | 'topic';
  name: string;
}

export interface Document {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  documentType: DocumentType;
  /** Official identifier as printed on the record (e.g. "Ordinance 2026-07"). Never inferred. */
  documentNumber: string | null;
  date: ISODate | null;
  year: number | null;
  governmentBodyId: string | null;
  governmentBodyName: string | null;
  meetingId: string | null;
  agendaItemId: string | null;
  /** Primary source; all sources are listed in DocumentDetail.sources. */
  sourceId: string;
  originalUrl: string | null;
  archiveUrl: string | null;
  mimeType: string;
  fileName: string;
  fileSize: number | null;
  pageCount: number | null;
  checksum: string | null;
  checksumAlgorithm: 'sha256';
  extractedTextAvailable: boolean;
  ocrRequired: boolean;
  ocrStatus: OcrStatus;
  /** 0–1 mean OCR confidence, when OCR was used. */
  ocrConfidence: number | null;
  archivedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  tags: string[];
  entities: DocumentEntity[];
  categories: CategoryId[];
  currency: RecordCurrency;
  currentVersion: number;
  isDemo?: boolean;
}

export type DocumentSummary = Pick<
  Document,
  | 'id'
  | 'slug'
  | 'title'
  | 'documentType'
  | 'documentNumber'
  | 'date'
  | 'year'
  | 'governmentBodyId'
  | 'governmentBodyName'
  | 'meetingId'
  | 'sourceId'
  | 'pageCount'
  | 'mimeType'
  | 'fileSize'
  | 'categories'
  | 'currency'
  | 'isDemo'
> & { description: string | null };

export type VersionChangeStatus = 'original' | 'replaced' | 'amended' | 'unchanged' | 'removed_at_source';

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  retrievedAt: ISODateTime;
  checksum: string;
  sourceUrl: string;
  fileSize: number | null;
  pageCount: number | null;
  changeStatus: VersionChangeStatus;
  archiveUrl: string | null;
  note?: string;
}

export type RelationshipType =
  | 'ADOPTED_DURING'
  | 'ATTACHED_TO'
  | 'AMENDS'
  | 'AMENDED_BY'
  | 'SUPERSEDES'
  | 'SUPERSEDED_BY'
  | 'RELATED_TO'
  | 'RECORD_OF'
  | 'REFERENCES'
  | 'EXHIBIT_OF'
  | 'PART_OF'
  | 'DUPLICATE_OF';

export interface DocumentRelationship {
  id: string;
  fromDocumentId: string;
  relationshipType: RelationshipType;
  /** Target is a document, meeting, agenda item, or municipal code section. */
  toKind: 'document' | 'meeting' | 'agenda_item' | 'code_section';
  toId: string;
  toTitle: string;
  /** How the relationship was established. AI-suggested links must be labeled as such. */
  basis: 'explicit_reference' | 'source_structure' | 'metadata_match' | 'manual' | 'ai_suggested';
  evidence?: EvidenceRef | null;
}

/** A retrievable chunk of extracted text. Chunks stay permanently linked to their document. */
export interface DocumentChunk {
  id: string;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
  tokenEstimate: number;
  embeddingReference: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

export interface DocumentPageText {
  page: number;
  text: string;
  ocr: boolean;
}

export interface DocumentDetail extends Document {
  governmentBody: GovernmentBody | null;
  meeting: MeetingSummary | null;
  agendaItem: Pick<AgendaItem, 'id' | 'number' | 'title'> | null;
  sources: DocumentSource[];
  versions: DocumentVersion[];
  relationships: DocumentRelationship[];
}

export interface RelatedDocument {
  document: DocumentSummary;
  relationshipType: RelationshipType | 'SIMILAR';
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Evidence & citations                                                       */
/* -------------------------------------------------------------------------- */

/** Pointer to the exact location in a record that supports a claim. */
export interface EvidenceRef {
  documentId: string;
  page: number | null;
  chunkId?: string | null;
  quote?: string | null;
}

export interface SourceExcerpt {
  documentId: string;
  chunkId: string | null;
  page: number | null;
  sectionTitle: string | null;
  text: string;
  /** Character ranges within `text` that matched the query. */
  highlights: Array<[number, number]>;
}

export interface Citation {
  /** 1-based marker used in the answer text, e.g. [1]. */
  index: number;
  documentId: string;
  documentTitle: string;
  documentType: DocumentType;
  documentNumber: string | null;
  date: ISODate | null;
  governmentBodyName: string | null;
  meetingId: string | null;
  meetingTitle: string | null;
  agendaItem: string | null;
  page: number | null;
  sectionTitle: string | null;
  excerpt: SourceExcerpt;
  archiveUrl: string | null;
  originalUrl: string | null;
  isDemo?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export type SearchMatchMode = 'all' | 'any' | 'phrase';
export type SearchSort = 'relevance' | 'date_desc' | 'date_asc' | 'title';

export interface SearchFilters {
  documentTypes?: DocumentType[];
  categories?: CategoryId[];
  years?: number[];
  dateFrom?: ISODate;
  dateTo?: ISODate;
  governmentBodyIds?: string[];
  sourceIds?: string[];
  meetingId?: string;
  currency?: RecordCurrency[];
}

export interface SearchRequest {
  query: string;
  filters?: SearchFilters;
  match?: SearchMatchMode;
  /** Restrict matching to titles only. */
  titleOnly?: boolean;
  sort?: SearchSort;
  page?: number;
  pageSize?: number;
}

export type MatchField = 'title' | 'document_number' | 'full_text' | 'entity' | 'metadata' | 'semantic';

export interface MatchExplanation {
  field: MatchField;
  /** Terms or phrase that matched, as the user typed them. */
  terms: string[];
  page: number | null;
  detail?: string;
}

export interface SearchResult {
  document: DocumentSummary;
  score: number;
  excerpts: SourceExcerpt[];
  matches: MatchExplanation[];
  meetingTitle: string | null;
}

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

export interface SearchFacets {
  documentTypes: FacetBucket[];
  years: FacetBucket[];
  governmentBodies: FacetBucket[];
  sources: FacetBucket[];
  categories: FacetBucket[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  /** True when `total` is a lower bound (large result sets). */
  totalIsEstimate?: boolean;
}

export interface SearchResponse extends Paginated<SearchResult> {
  query: string;
  facets: SearchFacets;
  tookMs: number;
  retrieval: Array<'full_text' | 'semantic' | 'metadata'>;
  /** Normalized interpretation of the query (e.g. detected document number). */
  interpretation?: QueryInterpretation;
}

export interface QueryInterpretation {
  documentNumber?: string | null;
  phrases: string[];
  terms: string[];
  detectedYear?: number | null;
  detectedDocumentType?: DocumentType | null;
}

/* -------------------------------------------------------------------------- */
/* Ask (retrieval-augmented answers)                                          */
/* -------------------------------------------------------------------------- */

export type RetrievalStatus = 'grounded' | 'partial' | 'no_results' | 'ai_unavailable' | 'search_only';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskRequest {
  question: string;
  filters?: SearchFilters;
  /** Prior turns for follow-ups. Sent only for the current tab session, never stored server-side. */
  conversation?: ConversationTurn[];
}

/**
 * A segment of the answer. Structured segments (instead of HTML/markdown) keep rendering safe
 * and let every factual sentence carry its citation markers.
 */
export interface AnswerSegment {
  text: string;
  citations: number[];
}

export interface AnswerParagraph {
  segments: AnswerSegment[];
}

export interface AskResponse {
  id: string;
  question: string;
  retrievalStatus: RetrievalStatus;
  /** Plain-text answer with [n] markers; `paragraphs` is the structured equivalent. */
  answer: string;
  paragraphs: AnswerParagraph[];
  citations: Citation[];
  relatedDocuments: DocumentSummary[];
  suggestedFollowUps: string[];
  /** Search fallback results (always present for search_only / ai_unavailable / partial). */
  searchResults?: SearchResult[];
  /** Human-readable note shown alongside the answer (e.g. demo notice, AI unavailable). */
  notice?: string | null;
  generatedAt: ISODateTime;
  /** Identifier of the answering engine. e.g. "demo-extractive" or a model name. */
  engine: string;
  isDemo?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Browse, statistics, suggestions, timelines                                 */
/* -------------------------------------------------------------------------- */

export interface ArchiveStatistics {
  documentsIndexed: number;
  pagesIndexed: number | null;
  meetingsIndexed: number | null;
  earliestRecordDate: ISODate | null;
  latestRecordDate: ISODate | null;
  archiveLastUpdatedAt: ISODateTime | null;
  sourcesMonitored: number;
  sourcesHealthy: number | null;
  ocrPendingCount: number | null;
  /** True when these numbers describe demo data. The UI must label them. */
  isDemo: boolean;
}

export interface SuggestedQuery {
  id: string;
  text: string;
  mode: 'ask' | 'search';
  /** Optional structured filters attached to a search suggestion. */
  filters?: SearchFilters;
  category?: string;
}

export interface BrowseFacets {
  years: FacetBucket[];
  documentTypes: FacetBucket[];
  governmentBodies: FacetBucket[];
  categories: FacetBucket[];
  sources: FacetBucket[];
  subjects: FacetBucket[];
}

export interface TimelineEvent {
  id: string;
  date: ISODate;
  /** Precision of `date`: some records only establish a month or year. */
  datePrecision: 'day' | 'month' | 'year';
  title: string;
  description: string;
  kind: 'application' | 'hearing' | 'meeting' | 'approval' | 'agreement' | 'notice' | 'report' | 'other';
  /** Every timeline event MUST be linked to evidence. */
  evidence: EvidenceRef[];
  governmentBodyName?: string | null;
  meetingId?: string | null;
}

export interface Topic {
  id: string;
  slug: string;
  name: string;
  kind: 'project' | 'program' | 'street' | 'place' | 'organization' | 'topic';
  description: string;
  documentCount: number;
  isDemo?: boolean;
}

export interface TopicDetail extends Topic {
  timeline: TimelineEvent[];
  documentIds: string[];
}

/* -------------------------------------------------------------------------- */
/* Municipal code                                                             */
/* -------------------------------------------------------------------------- */

export interface CodeSectionHistoryEntry {
  date: ISODate | null;
  action: 'enacted' | 'amended' | 'repealed' | 'renumbered';
  ordinanceNumber: string | null;
  ordinanceDocumentId: string | null;
  note?: string;
}

export interface CodeNode {
  id: string;
  level: 'title' | 'chapter' | 'section' | 'subsection';
  number: string;
  heading: string;
  /** Text shown ONLY when `currency` is labeled. */
  text: string | null;
  currency: RecordCurrency;
  effectiveDate: ISODate | null;
  history: CodeSectionHistoryEntry[];
  children: CodeNode[];
  sourceUrl: string | null;
  sourceId: string;
  isDemo?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Finance (future structured datasets; separate from document search)        */
/* -------------------------------------------------------------------------- */

export interface FinanceRecord {
  id: string;
  fiscalYear: number;
  fund: string | null;
  department: string | null;
  category: string | null;
  vendor: string | null;
  description: string | null;
  amount: number;
  transactionType: 'expense' | 'revenue' | 'budget' | 'payroll' | 'other';
  transactionDate: ISODate | null;
  sourceId: string;
  sourceUrl: string;
  retrievedAt: ISODateTime;
  /** Link to a document (e.g. contract, report) that corroborates the entry, if any. */
  evidence: EvidenceRef | null;
}

/* -------------------------------------------------------------------------- */
/* Reporting & health                                                         */
/* -------------------------------------------------------------------------- */

export type IssueType =
  | 'broken_document'
  | 'incorrect_metadata'
  | 'incorrect_citation'
  | 'incorrect_ai_summary'
  | 'missing_document'
  | 'duplicate_record'
  | 'other';

export interface IssueReport {
  issueType: IssueType;
  description: string;
  /** Context the report concerns. No personal information is collected. */
  context: {
    documentId?: string | null;
    askResponseId?: string | null;
    citationIndex?: number | null;
    pageUrl: string;
  };
}

export interface IssueReportReceipt {
  id: string;
  receivedAt: ISODateTime;
  status: 'received';
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'backend_not_connected' | 'offline';
  mode: 'mock' | 'api';
  search: boolean;
  ai: boolean;
  checkedAt: ISODateTime;
  message?: string;
}
