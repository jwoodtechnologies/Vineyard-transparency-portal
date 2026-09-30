/** Helpers shared by source adapters. */
import { classifyLink } from '../lib/classify';
import { extractLinks, type ExtractedLink, type ExtractedPage } from '../lib/html';
import { decodeBody, HttpError } from '../lib/http';
import { extractDates, extractDocumentNumbers } from '../lib/metadata';
import { hostOf, normalizeUrl } from '../lib/url';
import type { CandidateDocument, CandidateMeetingRef, DiscoveryError, LinkClassification } from '../lib/types';
import type { AdapterContext } from './types';

export interface FetchedPage extends ExtractedPage {
  url: string;
  status: number;
}

/**
 * Fetch and parse an HTML page. Returns null (and records an error) on failure, so one bad page
 * never aborts a whole source.
 */
export async function fetchHtmlPage(ctx: AdapterContext, url: string, errors: DiscoveryError[]): Promise<FetchedPage | null> {
  try {
    const res = await ctx.http.request(url, { maxBytes: ctx.config.crawlPolicy.maxHtmlBytes, onTooLarge: 'truncate' });
    if (res.networkPolicyBlock) {
      errors.push({ url, kind: 'blocked_by_network_policy', message: res.networkPolicyBlock, status: res.status });
      return null;
    }
    if (!res.ok) {
      errors.push({ url, kind: 'http_status', message: `HTTP ${res.status}`, status: res.status });
      return null;
    }
    if (res.contentType && res.contentType !== 'text/html' && res.contentType !== 'application/xhtml+xml') {
      errors.push({ url, kind: 'parse', message: `expected HTML, got ${res.contentType}`, status: res.status });
      return null;
    }
    const page = extractLinks(decodeBody(res.body ?? new Uint8Array(0), res.headers.get('content-type')), res.url);
    return { ...page, url: res.url, status: res.status };
  } catch (error) {
    const e = error as HttpError;
    errors.push({ url, kind: e instanceof HttpError ? e.kind : 'network', message: e.message, status: e instanceof HttpError ? e.status : null });
    return null;
  }
}

export function sameHost(a: string, b: string): boolean {
  return hostOf(a) !== null && hostOf(a) === hostOf(b);
}

export function classify(ctx: AdapterContext, link: ExtractedLink, pageUrl: string): LinkClassification | null {
  if (!link.url) return null;
  return classifyLink(ctx.config, { url: link.url, text: link.text, pageUrl, extraAllowedHosts: ctx.extraAllowedHosts });
}

export function toCandidate(
  ctx: AdapterContext,
  link: ExtractedLink,
  pageUrl: string,
  c: LinkClassification,
  extra: { meeting?: CandidateMeetingRef | null; title?: string | null } = {},
): CandidateDocument | null {
  if (!link.url) return null;
  const normalized = normalizeUrl(link.url, { stripParams: ctx.config.crawlPolicy.stripQueryParams });
  if (!normalized) return null;
  const text = link.text || null;
  return {
    url: link.url,
    normalizedUrl: normalized,
    title: extra.title ?? text,
    linkText: text,
    documentTypeHint: c.documentTypeHint,
    fileKind: c.fileKind,
    sourceId: ctx.source.id,
    adapterId: ctx.source.adapter,
    foundOn: [pageUrl],
    hostApproved: c.hostApproved,
    dateHint: text ? extractDates(text)[0]?.iso ?? extra.meeting?.date ?? null : extra.meeting?.date ?? null,
    documentNumberHint: text ? extractDocumentNumbers(text)[0]?.label ?? null : null,
    meeting: extra.meeting ?? null,
    contentType: null,
    contentLength: null,
  };
}

/** Merge candidates by normalized URL, keeping every page they were found on. */
export function mergeCandidates(list: CandidateDocument[]): CandidateDocument[] {
  const map = new Map<string, CandidateDocument>();
  for (const c of list) {
    const existing = map.get(c.normalizedUrl);
    if (!existing) {
      map.set(c.normalizedUrl, { ...c, foundOn: [...c.foundOn] });
      continue;
    }
    for (const f of c.foundOn) if (!existing.foundOn.includes(f)) existing.foundOn.push(f);
    existing.title ??= c.title;
    existing.linkText ??= c.linkText;
    existing.documentTypeHint ??= c.documentTypeHint;
    existing.fileKind ??= c.fileKind;
    existing.dateHint ??= c.dateHint;
    existing.documentNumberHint ??= c.documentNumberHint;
    existing.meeting ??= c.meeting;
  }
  return [...map.values()];
}

/** Identifier embedded in a URL (query param such as id/eventId/meetingId, or a numeric path segment). */
export function externalIdFromUrl(url: string, paramNames: string[] = ['id', 'eventid', 'event_id', 'meetingid', 'meeting_id', 'mid', 'itemid']): string | null {
  try {
    const u = new URL(url);
    for (const [k, v] of u.searchParams) if (paramNames.includes(k.toLowerCase()) && v) return v;
    const numeric = u.pathname.split('/').filter((s) => /^\d{2,}$/.test(s)).pop();
    return numeric ?? null;
  } catch {
    return null;
  }
}

/** Entity filter used by statewide systems (PMN, Transparent Utah, State Auditor). */
export function mentionsEntity(text: string, entityName: string | undefined): boolean {
  if (!entityName) return true;
  return text.toLowerCase().includes(entityName.toLowerCase());
}

export function entityNameOf(ctx: AdapterContext): string | undefined {
  const v = ctx.source.adapterOptions?.entityName;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
