/**
 * UtahPmnAdapter — Utah Public Notice Website (https://www.utah.gov/pmn/).
 *
 * STATUS: UNVERIFIED (host unreachable from the development environment).
 *
 * The PMN lists notices for every public body in the state, so this adapter is scoped by
 * `adapterOptions.entityName` (config: "Vineyard") and only follows links whose text mentions it.
 *
 * Strategy (link-heuristic, no fixed selectors):
 *   1. Landing page → links mentioning the entity (entity / public body pages). If none are present,
 *      follow same-host "browse"/"entities"/"public bodies" style links one level to find them.
 *   2. Entity/body pages → notice links (URL or text mentions "notice" or carries a date).
 *   3. Notice pages → the notice itself is an HTML record (candidate with fileKind "html",
 *      documentType "public_notice"); attachments (agendas, packets) become separate candidates.
 *
 * TODO(verify against live site):
 *   - [ ] Confirm the URL shapes for entity, public body, and notice pages; prefer any official
 *         feed/API the PMN offers (RSS/JSON) over HTML if available.
 *   - [ ] Confirm whether notice pages carry a stable notice ID in the URL (externalIdFromUrl).
 *   - [ ] Confirm the entity naming used for Vineyard (e.g. whether bodies are listed individually).
 */
import { checkSourceHealth } from '../lib/health';
import { extractDates } from '../lib/metadata';
import { normalizeUrl } from '../lib/url';
import type { CandidateDocument, SourceHealthRecord } from '../lib/types';
import { classify, entityNameOf, fetchHtmlPage, mentionsEntity, mergeCandidates, sameHost, toCandidate } from './common';
import { emptyResult, type AdapterContext, type AdapterDiscoveryResult, type SourceAdapter } from './types';

const BROWSE_TEXT = /(entit|public bod|government|browse|search|all notices|organizations?)/i;
const NOTICE_HINT = /(notice|meeting|hearing)/i;

export class UtahPmnAdapter implements SourceAdapter {
  readonly id = 'utah-pmn' as const;
  readonly description = 'Utah Public Notice Website: entity/public-body notices and attachments.';
  readonly verification = 'unverified' as const;

  canHandle(url: string): boolean {
    try {
      const u = new URL(url);
      return /(^|\.)utah\.gov$/i.test(u.hostname) && u.pathname.toLowerCase().startsWith('/pmn');
    } catch {
      return false;
    }
  }

  async discoverDocuments(ctx: AdapterContext): Promise<AdapterDiscoveryResult> {
    const result = emptyResult();
    const entity = entityNameOf(ctx);
    const norm = (u: string) => normalizeUrl(u) ?? u;
    const inScope = (u: string) => sameHost(u, ctx.source.baseUrl) && this.canHandle(u);
    let fetched = 0;

    const landing = await fetchHtmlPage(ctx, ctx.source.baseUrl, result.errors);
    fetched += 1;
    if (!landing) return { ...result, status: 'error' };

    const entityPages = new Map<string, string>();
    const browsePages: string[] = [];
    for (const link of landing.links) {
      if (!link.url || !inScope(link.url)) continue;
      if (mentionsEntity(link.text, entity)) entityPages.set(norm(link.url), link.url);
      else if (BROWSE_TEXT.test(link.text)) browsePages.push(link.url);
    }
    for (const url of browsePages.slice(0, 5)) {
      if (entityPages.size || fetched >= ctx.maxPages) break;
      const page = await fetchHtmlPage(ctx, url, result.errors);
      fetched += 1;
      for (const link of page?.links ?? []) {
        if (link.url && inScope(link.url) && mentionsEntity(link.text, entity)) entityPages.set(norm(link.url), link.url);
      }
    }
    if (!entityPages.size) {
      result.notes.push(`No links mentioning "${entity ?? '(any)'}" were found; PMN structure may differ from the heuristics (see TODOs).`);
      return result;
    }

    const noticePages = new Map<string, { url: string; text: string }>();
    for (const url of entityPages.values()) {
      if (fetched >= ctx.maxPages) break;
      const page = await fetchHtmlPage(ctx, url, result.errors);
      fetched += 1;
      for (const link of page?.links ?? []) {
        if (!link.url) continue;
        const c = classify(ctx, link, url);
        if (!c) continue;
        if (c.linkKind === 'document') {
          const cand = toCandidate(ctx, link, url, c);
          if (cand) result.candidates.push(cand);
        } else if (inScope(link.url) && (NOTICE_HINT.test(link.text + ' ' + link.url) || extractDates(link.text).length)) {
          noticePages.set(norm(link.url), { url: link.url, text: link.text });
        }
      }
    }

    for (const notice of noticePages.values()) {
      if (fetched >= ctx.maxPages) {
        result.notes.push(`maxPages (${ctx.maxPages}) reached before all notice pages were fetched`);
        break;
      }
      const page = await fetchHtmlPage(ctx, notice.url, result.errors);
      fetched += 1;
      if (!page) continue;
      const title = page.headings[0] ?? page.title ?? notice.text;
      const noticeCandidate: CandidateDocument = {
        url: page.url,
        normalizedUrl: norm(page.url),
        title,
        linkText: notice.text || null,
        documentTypeHint: 'public_notice',
        fileKind: 'html',
        sourceId: ctx.source.id,
        adapterId: this.id,
        foundOn: [notice.url],
        hostApproved: true,
        dateHint: extractDates(`${notice.text} ${title}`)[0]?.iso ?? null,
        documentNumberHint: null,
        meeting: null,
        contentType: 'text/html',
        contentLength: null,
      };
      result.candidates.push(noticeCandidate);
      for (const link of page.links) {
        const c = classify(ctx, link, page.url);
        if (c?.linkKind !== 'document') continue;
        const cand = toCandidate(ctx, link, page.url, c);
        if (cand) result.candidates.push(cand);
      }
    }
    result.candidates = mergeCandidates(result.candidates);
    return result;
  }

  health(ctx: AdapterContext, previous: SourceHealthRecord | null): Promise<SourceHealthRecord> {
    return checkSourceHealth(ctx.http, ctx.source, previous, { now: ctx.now });
  }
}
