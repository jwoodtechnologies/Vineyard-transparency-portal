/**
 * MunicipalCodeAdapter — municipal code (titles → chapters → sections).
 *
 * STATUS: NOT CONFIGURED BY DESIGN. The code's URL is not hard-coded; it must be discovered from
 * official Vineyard pages (npm run discover-sources), reviewed, and then set as the baseUrl of the
 * "vineyard-municipal-code" source in config/source-seeds.json.
 *
 * Once configured, discovery builds an OUTLINE from links whose text looks like
 * "Title 15", "Chapter 15.04", "Article 3", "Section 15.04.010" / "§ 15.04.010".
 *
 * Currency rules (critical — never present superseded law as current):
 *   - every outline entry is emitted with currency "unknown"
 *   - an entry may be marked "current" only when the code host states the codification/effective
 *     date for that version; historical versions (many hosts publish dated snapshots) must be
 *     marked "historical" and superseded sections "superseded", each linked to the amending
 *     ordinance (CodeSectionHistoryEntry) when the ordinance number is printed.
 *
 * Caveat: common code-hosting platforms render content with JavaScript; if the HTML has no outline
 * links, use the provider's official export/API (subject to its terms) instead of scraping.
 */
import { checkSourceHealth } from '../lib/health';
import { hostMatchesAny, hostOf } from '../lib/url';
import type { CodeOutlineEntry, SourceHealthRecord } from '../lib/types';
import { fetchHtmlPage, sameHost } from './common';
import { emptyResult, type AdapterContext, type AdapterDiscoveryResult, type SourceAdapter } from './types';

const OUTLINE_RE = /^(title|chapter|article|section|§)\s*([0-9]+[0-9A-Za-z.-]*)\s*[.:–—-]?\s*(.*)$/i;

export function parseOutlineLinkText(text: string): Pick<CodeOutlineEntry, 'level' | 'number' | 'heading'> | null {
  const m = OUTLINE_RE.exec(text.trim());
  if (!m) return null;
  const word = m[1].toLowerCase();
  const level: CodeOutlineEntry['level'] = word === '§' ? 'section' : (word as CodeOutlineEntry['level']);
  return { level, number: m[2].replace(/[.-]+$/, ''), heading: m[3].trim() };
}

export class MunicipalCodeAdapter implements SourceAdapter {
  readonly id = 'municipal-code' as const;
  readonly description = 'Municipal code outline (titles/chapters/sections) with explicit currency labels.';
  readonly verification = 'unverified' as const;

  canHandle(url: string): boolean {
    const host = hostOf(url);
    return host !== null && hostMatchesAny(host, ['library.municode.com', 'municode.com', 'codelibrary.amlegal.com', 'codepublishing.com', 'ecode360.com', 'encodeplus.com']);
  }

  async discoverDocuments(ctx: AdapterContext): Promise<AdapterDiscoveryResult> {
    if (!ctx.source.baseUrl) {
      return {
        ...emptyResult('not_configured'),
        notes: ['Municipal code URL not configured. Run discover-sources, review the municipal_code system found, and set its baseUrl in config/source-seeds.json.'],
      };
    }
    const result = emptyResult();
    const queue: Array<{ url: string; depth: number }> = [{ url: ctx.source.baseUrl, depth: 0 }];
    const seen = new Set<string>();
    let fetched = 0;
    while (queue.length && fetched < ctx.maxPages) {
      const { url, depth } = queue.shift() as { url: string; depth: number };
      if (seen.has(url)) continue;
      seen.add(url);
      const page = await fetchHtmlPage(ctx, url, result.errors);
      fetched += 1;
      if (!page) {
        if (depth === 0) result.status = 'error';
        continue;
      }
      for (const link of page.links) {
        if (!link.url || !sameHost(link.url, ctx.source.baseUrl)) continue;
        const parsed = parseOutlineLinkText(link.text);
        if (!parsed) continue;
        if (!result.codeOutline.some((e) => e.url === link.url)) {
          result.codeOutline.push({ sourceId: ctx.source.id, ...parsed, url: link.url, currency: 'unknown' });
        }
        if (parsed.level !== 'section' && depth < ctx.maxDepth) queue.push({ url: link.url, depth: depth + 1 });
      }
    }
    if (result.status === 'ok' && !result.codeOutline.length) {
      result.notes.push('No outline links found in server HTML; the code host is likely JavaScript-rendered. Use its official export/API.');
    }
    return result;
  }

  health(ctx: AdapterContext, previous: SourceHealthRecord | null): Promise<SourceHealthRecord> {
    return checkSourceHealth(ctx.http, ctx.source, previous, { now: ctx.now });
  }
}
