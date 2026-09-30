/**
 * Shared types for the ingestion tooling (scripts/).
 *
 * Domain types (Document, DocumentChunk, DocumentVersion, ...) come from src/types/models.ts so the
 * archive records written here are the same shapes the frontend and API contract use.
 */
import type {
  DocumentChunk,
  DocumentPageText,
  DocumentRelationship,
  DocumentSource,
  DocumentType,
  DocumentVersion,
  Document,
  ISODate,
  ISODateTime,
  SourceHealthStatus,
  SourceRegistryEntry,
  SourceType,
} from '../../src/types/models';

export type {
  DocumentChunk,
  DocumentPageText,
  DocumentRelationship,
  DocumentSource,
  DocumentType,
  DocumentVersion,
  Document,
  ISODate,
  ISODateTime,
  SourceHealthStatus,
  SourceRegistryEntry,
  SourceType,
};

/* -------------------------------------------------------------------------- */
/* config/source-seeds.json                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Host pattern syntax used throughout config/source-seeds.json:
 *  - "example.org"      matches example.org and any subdomain (www.example.org, a.b.example.org)
 *  - "=www.example.org" matches exactly that host only
 * Matching is case-insensitive and ignores a trailing dot.
 */
export type HostPattern = string;

export type AdapterId =
  | 'generic-html'
  | 'suiteone'
  | 'utah-pmn'
  | 'transparent-utah'
  | 'state-auditor'
  | 'municipal-code';

/** One configured public-record system. Superset of SourceRegistryEntry (frontend type). */
export interface SourceSeed extends Omit<SourceRegistryEntry, 'health' | 'documentCount' | 'isDemo'> {
  /** Adapter used by discover-documents / source-health. */
  adapter: AdapterId;
  /** Exactly one seed is the primary crawl seed. */
  primary?: boolean;
  /**
   * Restrict this seed to a path prefix on its host (e.g. "/pmn/" on www.utah.gov). Used to decide
   * which source a URL belongs to. Omit for the whole host.
   */
  pathPrefix?: string;
  /** Crawl depth limit for this source's own pages (overrides crawlPolicy.defaultMaxDepth). */
  maxDepth?: number;
  /**
   * Hints used ONLY for classification when the real URL is not yet known. These are patterns,
   * not facts about where a record lives.
   */
  discoveryHints?: {
    hostPatterns?: HostPattern[];
    linkTextPatterns?: string[];
    note?: string;
  };
  /** Adapter-specific options (e.g. the entity name to match on the Utah Public Notice Website). */
  adapterOptions?: Record<string, string | number | boolean>;
}

export interface ApprovedDomain {
  pattern: HostPattern;
  /**
   * full         — child pages may be crawled (depth-limited, relevance-filtered)
   * landing_only — only the first page reached on this host is fetched (to confirm the system)
   * documents_only — pages are not crawled; directly linked documents may be probed/downloaded
   */
  crawl: 'full' | 'landing_only' | 'documents_only';
  /** Optional path prefixes that bound crawling on this host. */
  pathPrefixes?: string[];
  maxDepth?: number;
  reason: string;
}

export interface DeniedDomain {
  pattern: HostPattern;
  category: 'social' | 'marketing' | 'advertising' | 'analytics' | 'news' | 'other';
}

export type FileKind = 'pdf' | 'spreadsheet' | 'word' | 'csv' | 'text' | 'presentation' | 'image' | 'archive' | 'audio' | 'video' | 'html';

export interface FileExtensionRule {
  fileKind: FileKind;
  mimeTypes: string[];
  /** Whether ingest may download this kind of file. */
  archivable: boolean;
}

export interface CrawlPolicy {
  defaultMaxDepth: number;
  /** Minimum delay between requests to the same host. */
  requestDelayMs: number;
  /** Upper bound applied to a robots.txt Crawl-delay directive. */
  maxCrawlDelayMs: number;
  userAgent: string;
  /** Product token matched against robots.txt User-agent lines. */
  robotsUserAgentToken: string;
  respectRobotsTxt: boolean;
  timeoutMs: number;
  maxRetries: number;
  maxRedirects: number;
  maxHtmlBytes: number;
  maxDocumentBytes: number;
  maxPagesPerRun: number;
  /** Max distinct query-string variants followed per path (crawler-trap guard). */
  maxQueryVariantsPerPath: number;
  /** Tracking parameters stripped during URL normalization (exact names or prefix*). */
  stripQueryParams: string[];
  /** Case-insensitive regex sources; matching URLs are never crawled. */
  skipUrlPatterns: string[];
  /** Keywords that make a child page "relevant" for crawling (URL or link text). */
  relevantKeywords: string[];
  /** Probe (HEAD, then ranged GET) document links to learn content-type/length. */
  probeDocuments: boolean;
  maxDocumentProbes: number;
}

export interface SourceSystemPattern {
  systemKind: SourceSystemKind;
  /** Host patterns (see HostPattern). */
  hostPatterns?: HostPattern[];
  /** Case-insensitive regex sources matched against the URL path (+ query). */
  pathPatterns?: string[];
  label: string;
}

export interface SourceSeedsConfig {
  $comment?: string;
  version: number;
  primarySourceSeed: string;
  sources: SourceSeed[];
  approvedDomains: ApprovedDomain[];
  deniedDomains: DeniedDomain[];
  /** Media hosts (video/audio). Links are recorded, never crawled. */
  mediaDomains: HostPattern[];
  crawlPolicy: CrawlPolicy;
  fileExtensions: Record<string, FileExtensionRule>;
  /** Patterns used to recognise public-record systems. Patterns, not facts. */
  sourceSystemPatterns: SourceSystemPattern[];
}

/* -------------------------------------------------------------------------- */
/* Discovery output (data/discovered-sources.json)                            */
/* -------------------------------------------------------------------------- */

/** Source-system kinds used for grouping. Superset of SourceType. */
export type SourceSystemKind =
  | SourceType
  | 'meeting_media'
  | 'utah_gov_database';

export type LinkKind = 'document' | 'page' | 'media' | 'denied' | 'unsupported' | 'external';

export interface LinkClassification {
  linkKind: LinkKind;
  fileKind: FileKind | null;
  extension: string | null;
  /** Public-record system the URL belongs to, if recognised. */
  systemKind: SourceSystemKind | null;
  /** Configured seed the URL belongs to, if any. */
  seedId: string | null;
  documentTypeHint: DocumentType | null;
  hostApproved: boolean;
  hostDenied: boolean;
  isExternal: boolean;
  reasons: string[];
}

export interface RedirectHop {
  from: string;
  to: string;
  status: number;
}

export interface RedirectRecord {
  requestedUrl: string;
  finalUrl: string;
  chain: RedirectHop[];
}

export interface DocumentProbe {
  method: 'HEAD' | 'GET';
  status: number;
  contentType: string | null;
  contentLength: number | null;
  finalUrl: string;
  checkedAt: ISODateTime;
}

export interface DiscoveredDocumentLink {
  url: string;
  normalizedUrl: string;
  fileKind: FileKind | null;
  extension: string | null;
  documentTypeHint: DocumentType | null;
  systemKind: SourceSystemKind | null;
  sourceId: string | null;
  hostApproved: boolean;
  isExternal: boolean;
  linkTexts: string[];
  foundOn: string[];
  probe: DocumentProbe | null;
}

export interface DiscoveredSource {
  /** Stable id: configured seed id, or a slug derived from the system kind + host. */
  id: string;
  name: string;
  systemKind: SourceSystemKind;
  sourceType: SourceType;
  host: string;
  baseUrl: string;
  discoveredFrom: string | null;
  configuredSeedId: string | null;
  hostApproved: boolean;
  /** configured = matches config/source-seeds.json; needs_review = new system, human review required. */
  reviewStatus: 'configured' | 'needs_review';
  /** A page on this system was fetched successfully during this run. */
  reached: boolean;
  linkCount: number;
  documentLinkCount: number;
  sampleLinkTexts: string[];
}

export interface DiscoveredPage {
  url: string;
  depth: number;
  status: number | null;
  title: string | null;
  contentType: string | null;
  linkCount: number;
  fetchedAt: ISODateTime;
}

export type DiscoveryErrorKind =
  | 'network'
  | 'timeout'
  | 'http_status'
  | 'blocked_by_network_policy'
  | 'robots_disallowed'
  | 'too_many_redirects'
  | 'redirect_to_unapproved_host'
  | 'too_large'
  | 'parse';

export interface DiscoveryError {
  url: string;
  kind: DiscoveryErrorKind;
  message: string;
  status?: number | null;
}

export interface DiscoverySummaryCounts {
  sourceSystems: number;
  directDocumentLinks: number;
  meetingOrPublicNoticeSystems: number;
  financialReportingSystems: number;
  municipalCodeSystems: number;
  documentLibraries: number;
  sourcesNeedingReview: number;
}

export interface DiscoveryStats {
  pagesFetched: number;
  pagesFailed: number;
  linksSeen: number;
  uniqueLinks: number;
  skippedDenied: number;
  skippedNotRelevant: number;
  skippedDepth: number;
  skippedRobots: number;
  skippedTrap: number;
  mediaLinks: number;
  documentProbes: number;
}

export interface DiscoveryManifest {
  generatedAt: ISODateTime;
  seed: string;
  tool: { name: string; version: string };
  options: { maxDepth: number; maxPages: number; probeDocuments: boolean; respectRobotsTxt: boolean };
  seedReachable: boolean;
  summary: DiscoverySummaryCounts;
  stats: DiscoveryStats;
  /** Source systems grouped by kind. */
  sources: Partial<Record<SourceSystemKind, DiscoveredSource[]>>;
  /** Configured seeds that were not linked from any crawled page this run. */
  configuredSeedsNotObserved: string[];
  documents: DiscoveredDocumentLink[];
  mediaLinks: Array<{ url: string; linkTexts: string[]; foundOn: string[] }>;
  pages: DiscoveredPage[];
  redirects: RedirectRecord[];
  errors: DiscoveryError[];
}

/* -------------------------------------------------------------------------- */
/* Document discovery output (data/discovered-documents.json)                 */
/* -------------------------------------------------------------------------- */

export interface CandidateMeetingRef {
  /** Identifier as it appears in the source system's URL. Never generated or incremented. */
  externalId: string | null;
  title: string | null;
  date: ISODate | null;
  bodyName: string | null;
  url: string | null;
}

export interface CandidateDocument {
  url: string;
  normalizedUrl: string;
  title: string | null;
  linkText: string | null;
  documentTypeHint: DocumentType | null;
  fileKind: FileKind | null;
  sourceId: string;
  adapterId: AdapterId;
  foundOn: string[];
  hostApproved: boolean;
  dateHint: ISODate | null;
  documentNumberHint: string | null;
  meeting: CandidateMeetingRef | null;
  contentType: string | null;
  contentLength: number | null;
}

export interface CandidateMeeting {
  sourceId: string;
  externalId: string | null;
  title: string | null;
  date: ISODate | null;
  bodyName: string | null;
  url: string;
  documentUrls: string[];
  mediaUrls: string[];
}

/** Municipal-code outline entry (CodeNode-compatible subset); currency stays "unknown" until verified. */
export interface CodeOutlineEntry {
  sourceId: string;
  level: 'title' | 'chapter' | 'article' | 'section';
  number: string;
  heading: string;
  url: string;
  currency: 'unknown';
}

export interface PerSourceDiscoveryResult {
  sourceId: string;
  adapterId: AdapterId;
  status: 'ok' | 'skipped' | 'error' | 'not_configured';
  candidateCount: number;
  meetingCount: number;
  message: string | null;
}

export interface DocumentDiscoveryManifest {
  generatedAt: ISODateTime;
  candidates: CandidateDocument[];
  meetings: CandidateMeeting[];
  codeOutline: CodeOutlineEntry[];
  perSource: PerSourceDiscoveryResult[];
  errors: DiscoveryError[];
}

/* -------------------------------------------------------------------------- */
/* Archive records (data/archive/records/<documentId>.json)                   */
/* -------------------------------------------------------------------------- */

export interface ArchivedVersion extends DocumentVersion {
  /** StorageProvider key of this version's bytes. Keys are content-addressed. */
  storageKey: string;
  mimeType: string;
}

export interface ArchiveRecord {
  schemaVersion: 1;
  document: Document;
  versions: ArchivedVersion[];
  sources: DocumentSource[];
  /** Normalized forms of every source URL (identity keys for URL-based dedupe/versioning). */
  normalizedUrls: string[];
  relationships: DocumentRelationship[];
  pages: DocumentPageText[];
  chunks: DocumentChunk[];
  /** Other document numbers printed in the record (references, not identity). */
  referencedDocumentNumbers: string[];
  /** Id of the canonical record when this one is a probable duplicate (metadata match). */
  duplicateOf: string | null;
  ingest: {
    pipelineVersion: string;
    processedAt: ISODateTime;
    textExtractor: string | null;
    classifier: string;
    warnings: string[];
  };
}

/** Lightweight fingerprint list used for duplicate detection (data/archive/manifest.json). */
export interface ArchiveFingerprint {
  documentId: string;
  checksums: string[];
  normalizedUrls: string[];
  documentNumber: string | null;
  documentType: DocumentType;
  fileName: string;
  fileSize: number | null;
  title: string;
  date: ISODate | null;
}

export interface ArchiveManifest {
  updatedAt: ISODateTime;
  documents: ArchiveFingerprint[];
}

export interface SourceHealthRecord {
  sourceId: string;
  name: string;
  baseUrl: string;
  adapterId: AdapterId;
  status: SourceHealthStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  lastCheckedAt: ISODateTime;
  lastSuccessfulCheckAt: ISODateTime | null;
  /** Hash of the page's link structure; a change marks the source "changed". */
  fingerprint: string | null;
  message: string;
}

export interface SourceHealthReport {
  generatedAt: ISODateTime;
  sources: SourceHealthRecord[];
}
