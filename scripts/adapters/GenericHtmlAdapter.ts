/**
 * GenericHtmlAdapter — works for any server-rendered HTML source (city website, transparency
 * portal, CivicPlus DocumentCenter/Archive pages). It reuses the discovery crawler: bounded,
 * relevance-filtered crawl from the source's baseUrl; every document link becomes a candidate.
 *
 * Verified: the link extraction/classification logic (unit tests over a fictional fixture site).
 * Not verified here: the live Vineyard pages (network access to vineyardutah.gov was blocked in
 * the development environment). Nothing in this adapter depends on a specific page layout.
 */
import { discover } from '../lib/discover';
import { checkSourceHealth } from '../lib/health';
import { extractDates, extractDocumentNumbers } from '../lib/metadata';
import type { CandidateDocument, SourceHealthRecord } from '../lib/types';
import { hostOf } from '../lib/url';
import { emptyResult, type AdapterContext, type AdapterDiscoveryResult, type SourceAdapter } from './types';

export class GenericHtmlAdapter implements SourceAdapter {
  readonly id = 'generic-html' as const;
  readonly description = 'Bounded crawl of server-rendered HTML pages; collects directly linked documents.';
  readonly verification = 'unverified' as const;

  canHandle(url: string): boolean {
    return hostOf(url) !== null;
  }

  async discoverDocuments(ctx: AdapterContext): Promise<AdapterDiscoveryResult> {
    if (!ctx.source.baseUrl) return { ...emptyResult('not_configured'), notes: ['No baseUrl configured.'] };
    const manifest = await discover({
      config: ctx.config,
      http: ctx.http,
      seed: ctx.source.baseUrl,
      maxDepth: ctx.maxDepth,
      maxPages: ctx.maxPages,
      extraAllowedHosts: ctx.extraAllowedHosts,
      probeDocuments: false,
      log: ctx.log,
      now: ctx.now,
    });
    const result = emptyResult(manifest.seedReachable ? 'ok' : 'error');
    result.errors.push(...manifest.errors);
    result.notes.push(`${manifest.stats.pagesFetched} pages fetched, ${manifest.documents.length} document links`);
    for (const d of manifest.documents) {
      const text = d.linkTexts[0] ?? null;
      const candidate: CandidateDocument = {
        url: d.url,
        normalizedUrl: d.normalizedUrl,
        title: text,
        linkText: text,
        documentTypeHint: d.documentTypeHint,
        fileKind: d.fileKind,
        sourceId: d.sourceId ?? ctx.source.id,
        adapterId: this.id,
        foundOn: d.foundOn,
        hostApproved: d.hostApproved,
        dateHint: text ? extractDates(text)[0]?.iso ?? null : null,
        documentNumberHint: text ? extractDocumentNumbers(text)[0]?.label ?? null : null,
        meeting: null,
        contentType: d.probe?.contentType ?? null,
        contentLength: d.probe?.contentLength ?? null,
      };
      result.candidates.push(candidate);
    }
    return result;
  }

  health(ctx: AdapterContext, previous: SourceHealthRecord | null): Promise<SourceHealthRecord> {
    return checkSourceHealth(ctx.http, ctx.source, previous, { now: ctx.now });
  }
}
