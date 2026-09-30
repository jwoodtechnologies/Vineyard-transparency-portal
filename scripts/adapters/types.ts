/**
 * Source adapter contract. One adapter per public-record system family. Adapters:
 *  - never assume sequential or guessable IDs (meeting/document IDs are read from real links)
 *  - avoid brittle CSS selectors: they work from the full link list (scripts/lib/html.ts) plus
 *    URL/link-text heuristics, so a cosmetic redesign degrades gracefully instead of silently
 *    returning nothing; health() reports "changed" when expected structure disappears
 *  - only use the shared polite HTTP client (robots.txt, rate limits, size limits)
 *  - declare honestly whether their assumptions have been verified against the live system
 */
import type { HttpClientLike } from '../lib/http';
import type { RegistrySource } from '../lib/registry';
import type {
  AdapterId,
  CandidateDocument,
  CandidateMeeting,
  CodeOutlineEntry,
  DiscoveryError,
  SourceHealthRecord,
  SourceSeedsConfig,
} from '../lib/types';

export interface AdapterContext {
  source: RegistrySource;
  config: SourceSeedsConfig;
  http: HttpClientLike;
  log: (message: string) => void;
  /** Maximum HTML pages this adapter may fetch for the source in one run. */
  maxPages: number;
  maxDepth: number;
  extraAllowedHosts: string[];
  now: () => Date;
}

export interface AdapterDiscoveryResult {
  candidates: CandidateDocument[];
  meetings: CandidateMeeting[];
  codeOutline: CodeOutlineEntry[];
  errors: DiscoveryError[];
  notes: string[];
  status: 'ok' | 'not_configured' | 'error';
}

export interface SourceAdapter {
  readonly id: AdapterId;
  readonly description: string;
  /**
   * verified   — selectors/URL patterns have been checked against the live system
   * unverified — written from general knowledge of the platform; TODOs mark what to verify
   */
  readonly verification: 'verified' | 'unverified';
  canHandle(url: string): boolean;
  discoverDocuments(ctx: AdapterContext): Promise<AdapterDiscoveryResult>;
  discoverMeetings?(ctx: AdapterContext): Promise<CandidateMeeting[]>;
  health(ctx: AdapterContext, previous: SourceHealthRecord | null): Promise<SourceHealthRecord>;
}

export function emptyResult(status: AdapterDiscoveryResult['status'] = 'ok'): AdapterDiscoveryResult {
  return { candidates: [], meetings: [], codeOutline: [], errors: [], notes: [], status };
}
