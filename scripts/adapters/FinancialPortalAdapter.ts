/**
 * Shared base for statewide financial-reporting systems (Transparent Utah, State Auditor).
 *
 * STATUS: UNVERIFIED. These sites are statewide and may be JavaScript applications; HTML scraping
 * may find little. The adapters therefore:
 *   - collect directly linked report FILES (PDF/CSV/XLSX) on the landing page and on same-host
 *     pages whose link text mentions the entity (adapterOptions.entityName, "Vineyard")
 *   - never fabricate FinanceRecord rows. Structured transaction data (FinanceRecord) is a separate
 *     future pipeline built on the systems' official bulk downloads/APIs, kept out of document search.
 */
import { checkSourceHealth } from '../lib/health';
import { normalizeUrl } from '../lib/url';
import type { AdapterId, DocumentType, SourceHealthRecord } from '../lib/types';
import { classify, entityNameOf, fetchHtmlPage, mentionsEntity, mergeCandidates, sameHost, toCandidate } from './common';
import { emptyResult, type AdapterContext, type AdapterDiscoveryResult, type SourceAdapter } from './types';

export abstract class FinancialPortalAdapter implements SourceAdapter {
  abstract readonly id: AdapterId;
  abstract readonly description: string;
  readonly verification = 'unverified' as const;
  protected abstract readonly defaultDocumentType: DocumentType;
  protected abstract readonly hostPattern: RegExp;

  canHandle(url: string): boolean {
    try {
      return this.hostPattern.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  async discoverDocuments(ctx: AdapterContext): Promise<AdapterDiscoveryResult> {
    const result = emptyResult();
    if (!ctx.source.baseUrl) return { ...result, status: 'not_configured' };
    const entity = entityNameOf(ctx);
    const queue: Array<{ url: string; depth: number }> = [{ url: ctx.source.baseUrl, depth: 0 }];
    const seen = new Set<string>();
    let fetched = 0;
    while (queue.length && fetched < ctx.maxPages) {
      const { url, depth } = queue.shift() as { url: string; depth: number };
      const key = normalizeUrl(url) ?? url;
      if (seen.has(key)) continue;
      seen.add(key);
      const page = await fetchHtmlPage(ctx, url, result.errors);
      fetched += 1;
      if (!page) {
        if (depth === 0) result.status = 'error';
        continue;
      }
      for (const link of page.links) {
        const c = classify(ctx, link, page.url);
        if (!c || !link.url || c.linkKind === 'denied') continue;
        if (c.linkKind === 'document') {
          // On statewide systems keep only files that mention the entity (text or URL), except on
          // pages we reached through an entity-specific link (depth > 0).
          if (depth === 0 && !mentionsEntity(`${link.text} ${link.url}`, entity)) continue;
          const cand = toCandidate(ctx, link, page.url, c);
          if (cand) {
            cand.documentTypeHint ??= this.defaultDocumentType;
            result.candidates.push(cand);
          }
        } else if (c.linkKind === 'page' && depth < ctx.maxDepth && sameHost(link.url, ctx.source.baseUrl) && mentionsEntity(link.text, entity)) {
          queue.push({ url: link.url, depth: depth + 1 });
        }
      }
    }
    result.candidates = mergeCandidates(result.candidates);
    if (result.status === 'ok' && !result.candidates.length) {
      result.notes.push('No report files found via HTML. The site may be a JavaScript app; use its official download/API endpoints (TODO: verify).');
    }
    return result;
  }

  health(ctx: AdapterContext, previous: SourceHealthRecord | null): Promise<SourceHealthRecord> {
    return checkSourceHealth(ctx.http, ctx.source, previous, { now: ctx.now });
  }
}

/**
 * Transparent Utah (https://transparent.utah.gov/).
 * TODO(verify): locate the entity search and the official bulk download (CSV) for Vineyard's
 * revenue/expense/payroll data; map rows to FinanceRecord in a separate finance pipeline.
 */
export class TransparentUtahAdapter extends FinancialPortalAdapter {
  readonly id = 'transparent-utah' as const;
  readonly description = 'Transparent Utah public finance site: report files (FinanceRecord datasets later).';
  protected readonly defaultDocumentType: DocumentType = 'financial_report';
  protected readonly hostPattern = /(^|\.)transparent\.utah\.gov$/i;
}

/**
 * Utah State Auditor local-government reporting (https://reporting.auditor.utah.gov/).
 * TODO(verify): confirm how entity reports (audited financial statements, budgets, etc.) are
 * listed and whether a stable per-entity URL or search API exists.
 */
export class StateAuditorAdapter extends FinancialPortalAdapter {
  readonly id = 'state-auditor' as const;
  readonly description = 'Utah State Auditor reporting: audits and financial reports filed by the city.';
  protected readonly defaultDocumentType: DocumentType = 'audit';
  protected readonly hostPattern = /(^|\.)auditor\.utah\.gov$/i;
}
