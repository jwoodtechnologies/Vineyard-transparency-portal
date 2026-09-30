/**
 * Source discovery engine.
 *
 * Starting from the primary seed, fetch pages breadth-first, extract every link, classify it, and
 * record (a) public-record systems, (b) direct document links, (c) media links, (d) redirects and
 * (e) errors. Crawling is bounded:
 *
 *  - only hosts in approvedDomains (or --allow-host) are fetched as pages
 *  - "full" hosts: depth-limited, relevance-filtered child pages; "landing_only": one page;
 *    "documents_only": no pages
 *  - denied (social/marketing/news/ads) hosts are never requested
 *  - robots.txt, per-host rate limits, size limits and timeouts are enforced by the HTTP client
 *  - crawler-trap guards: skipUrlPatterns, max query variants per path, maxPagesPerRun
 *
 * Everything is injectable (http client, clock) so discover() can be tested without a network.
 * Nothing in the output is inferred: counts are computed from what was actually fetched/linked.
 */
import { extractLinks } from './html';
import { decodeBody, HttpError, type HttpClientLike } from './http';
import {
  approvedDomainFor,
  classifyLink,
  fileKindForMime,
  isDeniedHost,
  isRelevantPage,
  isSkippedUrl,
  sourceTypeForSystem,
  systemKindForUrl,
} from './classify';
import { hostOf, normalizeUrl } from './url';
import type {
  DiscoveredDocumentLink,
  DiscoveredPage,
  DiscoveredSource,
  DiscoveryError,
  DiscoveryManifest,
  DiscoveryStats,
  RedirectRecord,
  SourceSeed,
  SourceSeedsConfig,
  SourceSystemKind,
} from './types';

export const DISCOVERY_TOOL = { name: 'vineyard-transparency-portal/discover-sources', version: '0.1.0' };

export interface DiscoverOptions {
  config: SourceSeedsConfig;
  http: HttpClientLike;
  /** Defaults to config.primarySourceSeed. */
  seed?: string;
  maxDepth?: number;
  maxPages?: number;
  extraAllowedHosts?: string[];
  probeDocuments?: boolean;
  log?: (message: string) => void;
  now?: () => Date;
}

export const SYSTEM_KIND_LABELS: Record<SourceSystemKind, string> = {
  transparency_portal: 'Transparency portal',
  city_website: 'City website',
  meeting_portal: 'Meeting portal',
  meeting_media: 'Meeting video/audio channel',
  public_notice_system: 'Public notice system',
  financial_transparency: 'Financial transparency portal',
  state_auditor: 'State auditor reporting',
  municipal_code: 'Municipal code',
  document_library: 'Document library',
  gis_portal: 'GIS / mapping portal',
  utah_gov_database: 'Utah state government system',
  other: 'Other public-record system',
};

const MEETING_KINDS = new Set<SourceSystemKind>(['meeting_portal', 'public_notice_system', 'meeting_media']);
const FINANCE_KINDS = new Set<SourceSystemKind>(['financial_transparency', 'state_auditor']);

interface QueueItem {
  url: string;
  depth: number;
  from: string | null;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function firstPathSegment(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ? `/${seg.toLowerCase()}` : '';
  } catch {
    return '';
  }
}

function pathKey(url: string): string {
  const u = new URL(url);
  return `${u.origin}${u.pathname.toLowerCase()}`;
}

export async function discover(options: DiscoverOptions): Promise<DiscoveryManifest> {
  const { config, http } = options;
  const policy = config.crawlPolicy;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const seedUrl = options.seed ?? config.primarySourceSeed;
  const maxDepth = options.maxDepth ?? policy.defaultMaxDepth;
  const maxPages = options.maxPages ?? policy.maxPagesPerRun;
  const probeDocuments = options.probeDocuments ?? policy.probeDocuments;
  const extraAllowedHosts = options.extraAllowedHosts ?? [];
  const norm = (u: string) => normalizeUrl(u, { stripParams: policy.stripQueryParams });

  const stats: DiscoveryStats = {
    pagesFetched: 0,
    pagesFailed: 0,
    linksSeen: 0,
    uniqueLinks: 0,
    skippedDenied: 0,
    skippedNotRelevant: 0,
    skippedDepth: 0,
    skippedRobots: 0,
    skippedTrap: 0,
    mediaLinks: 0,
    documentProbes: 0,
  };
  const errors: DiscoveryError[] = [];
  const redirects: RedirectRecord[] = [];
  const pages: DiscoveredPage[] = [];
  const documents = new Map<string, DiscoveredDocumentLink>();
  const media = new Map<string, { url: string; linkTexts: string[]; foundOn: string[] }>();
  const systems = new Map<string, DiscoveredSource>();
  const seen = new Set<string>();
  const queued = new Set<string>();
  const uniqueLinks = new Set<string>();
  const queryVariants = new Map<string, Set<string>>();
  const pagesPerHost = new Map<string, number>();
  let seedReachable = false;

  const seedNorm = norm(seedUrl);
  if (!seedNorm) throw new Error(`Seed is not an http(s) URL: ${seedUrl}`);
  const seedPathPrefix = (() => {
    const p = new URL(seedUrl).pathname;
    return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1);
  })();
  const seedHost = hostOf(seedUrl);

  function registerSystem(
    url: string,
    info: { kind: SourceSystemKind | null; seed: SourceSeed | null },
    ctx: { discoveredFrom: string | null; text: string; reached: boolean; isDocument: boolean },
  ): void {
    const kind = info.kind;
    if (!kind) return;
    const host = hostOf(url);
    if (!host) return;
    const seed = info.seed && info.seed.sourceType === kind ? info.seed : null;
    const root = kind === 'document_library' || (kind === 'meeting_portal' && !seed && firstPathSegment(url) === '/agendacenter') ? firstPathSegment(url) : '';
    const key = seed ? `seed:${seed.id}` : `${kind}:${host}${root}`;
    let entry = systems.get(key);
    if (!entry) {
      const origin = new URL(url).origin;
      entry = {
        id: seed ? seed.id : slug(`${kind}-${host}${root}`),
        name: seed ? seed.name : `${SYSTEM_KIND_LABELS[kind]} (${host}${root})`,
        systemKind: kind,
        sourceType: sourceTypeForSystem(kind),
        host,
        baseUrl: seed ? seed.baseUrl : `${origin}${root || '/'}`,
        discoveredFrom: ctx.discoveredFrom,
        configuredSeedId: seed?.id ?? null,
        hostApproved: approvedDomainFor(config, url, extraAllowedHosts) !== null,
        reviewStatus: seed ? 'configured' : 'needs_review',
        reached: false,
        linkCount: 0,
        documentLinkCount: 0,
        sampleLinkTexts: [],
      };
      systems.set(key, entry);
    }
    if (ctx.reached) entry.reached = true;
    if (ctx.discoveredFrom !== null) {
      entry.linkCount += 1;
      if (ctx.isDocument) entry.documentLinkCount += 1;
    }
    const text = ctx.text.trim();
    if (text && entry.sampleLinkTexts.length < 5 && !entry.sampleLinkTexts.includes(text)) entry.sampleLinkTexts.push(text);
  }

  function addDocument(url: string, normalized: string, text: string, foundOn: string, c: ReturnType<typeof classifyLink>): void {
    let doc = documents.get(normalized);
    if (!doc) {
      const info = systemKindForUrl(config, url, text);
      doc = {
        url,
        normalizedUrl: normalized,
        fileKind: c.fileKind,
        extension: c.extension,
        documentTypeHint: c.documentTypeHint,
        systemKind: c.systemKind,
        sourceId: info.seed?.id ?? null,
        hostApproved: c.hostApproved,
        isExternal: c.isExternal,
        linkTexts: [],
        foundOn: [],
        probe: null,
      };
      documents.set(normalized, doc);
    }
    if (text && !doc.linkTexts.includes(text) && doc.linkTexts.length < 10) doc.linkTexts.push(text);
    if (!doc.foundOn.includes(foundOn)) doc.foundOn.push(foundOn);
    if (!doc.documentTypeHint && c.documentTypeHint) doc.documentTypeHint = c.documentTypeHint;
  }

  function mayCrawl(url: string, normalized: string, text: string, depth: number): boolean {
    if (seen.has(normalized) || queued.has(normalized)) return false;
    const host = hostOf(url);
    if (!host) return false;
    if (isDeniedHost(config, host) && !extraAllowedHosts.includes(host)) {
      stats.skippedDenied += 1;
      return false;
    }
    const approved = approvedDomainFor(config, url, extraAllowedHosts);
    if (!approved || approved.crawl === 'documents_only') return false;
    if (isSkippedUrl(config, url)) {
      stats.skippedTrap += 1;
      return false;
    }
    const limit = Math.min(maxDepth, approved.maxDepth ?? Number.POSITIVE_INFINITY);
    if (depth > limit) {
      stats.skippedDepth += 1;
      return false;
    }
    if (approved.crawl === 'landing_only') {
      const already = (pagesPerHost.get(host) ?? 0) + [...queued].filter((q) => hostOf(q) === host).length;
      if (already > 0) return false;
      return true;
    }
    // full: same-host children must be under the seed's folder or look relevant.
    const underSeed = host === seedHost && new URL(url).pathname.startsWith(seedPathPrefix);
    if (!underSeed && !isRelevantPage(config, url, text)) {
      stats.skippedNotRelevant += 1;
      return false;
    }
    const key = pathKey(url);
    const search = new URL(normalized).search;
    if (search) {
      const variants = queryVariants.get(key) ?? new Set<string>();
      if (!variants.has(search) && variants.size >= policy.maxQueryVariantsPerPath) {
        stats.skippedTrap += 1;
        return false;
      }
      variants.add(search);
      queryVariants.set(key, variants);
    }
    return true;
  }

  const allowRedirect = (_from: string, to: string): boolean => {
    const host = hostOf(to);
    if (!host) return false;
    if (isDeniedHost(config, host)) return false;
    return approvedDomainFor(config, to, extraAllowedHosts) !== null;
  };

  const queue: QueueItem[] = [{ url: seedUrl, depth: 0, from: null }];
  queued.add(seedNorm);

  while (queue.length && stats.pagesFetched < maxPages) {
    const item = queue.shift() as QueueItem;
    const itemNorm = norm(item.url) as string;
    queued.delete(itemNorm);
    if (seen.has(itemNorm)) continue;
    seen.add(itemNorm);
    log(`[depth ${item.depth}] GET ${item.url}`);

    let res;
    try {
      res = await http.request(item.url, { maxBytes: policy.maxHtmlBytes, onTooLarge: 'truncate', allowRedirect });
    } catch (error) {
      stats.pagesFailed += 1;
      if (error instanceof HttpError) {
        if (error.kind === 'robots_disallowed') stats.skippedRobots += 1;
        errors.push({ url: item.url, kind: error.kind, message: error.message, status: error.status });
      } else {
        errors.push({ url: item.url, kind: 'network', message: (error as Error).message });
      }
      continue;
    }

    if (res.redirectChain.length) redirects.push({ requestedUrl: item.url, finalUrl: res.url, chain: res.redirectChain });
    if (res.redirectRefused) {
      stats.pagesFailed += 1;
      errors.push({
        url: item.url,
        kind: 'redirect_to_unapproved_host',
        message: `redirect to ${res.redirectRefused.to} not followed (host not approved)`,
        status: res.status,
      });
      const target = res.redirectRefused.to;
      registerSystem(target, systemKindForUrl(config, target), { discoveredFrom: item.from ?? item.url, text: '', reached: false, isDocument: false });
      continue;
    }
    if (res.networkPolicyBlock) {
      stats.pagesFailed += 1;
      errors.push({ url: item.url, kind: 'blocked_by_network_policy', message: res.networkPolicyBlock, status: res.status });
      continue;
    }
    if (!res.ok) {
      stats.pagesFailed += 1;
      errors.push({ url: item.url, kind: 'http_status', message: `HTTP ${res.status}`, status: res.status });
      continue;
    }

    const finalNorm = norm(res.url);
    if (finalNorm) seen.add(finalNorm);
    const host = hostOf(res.url) as string;
    pagesPerHost.set(host, (pagesPerHost.get(host) ?? 0) + 1);
    if (item.depth === 0) seedReachable = true;

    const isHtml = res.contentType === null || res.contentType === 'text/html' || res.contentType === 'application/xhtml+xml';
    if (!isHtml) {
      // A "page" link that turned out to be a file: record it as a document.
      const c = classifyLink(config, { url: res.url, pageUrl: item.from, contentType: res.contentType, extraAllowedHosts });
      addDocument(res.url, finalNorm ?? itemNorm, '', item.from ?? item.url, c);
      const doc = documents.get(finalNorm ?? itemNorm);
      if (doc) {
        doc.fileKind = fileKindForMime(config, res.contentType) ?? doc.fileKind;
        doc.probe = { method: 'GET', status: res.status, contentType: res.contentType, contentLength: res.contentLength, finalUrl: res.url, checkedAt: now().toISOString() };
      }
      continue;
    }

    const html = decodeBody(res.body ?? new Uint8Array(0), res.headers.get('content-type'));
    const page = extractLinks(html, res.url);
    stats.pagesFetched += 1;
    pages.push({
      url: res.url,
      depth: item.depth,
      status: res.status,
      title: page.title,
      contentType: res.contentType,
      linkCount: page.links.length,
      fetchedAt: now().toISOString(),
    });
    const selfInfo = systemKindForUrl(config, res.url, page.title ?? '');
    registerSystem(
      res.url,
      { kind: selfInfo.kind ?? (item.depth === 0 ? 'other' : null), seed: selfInfo.seed },
      { discoveredFrom: item.from, text: '', reached: true, isDocument: false },
    );

    for (const link of page.links) {
      stats.linksSeen += 1;
      if (!link.url) continue;
      const normalized = norm(link.url);
      if (!normalized) continue;
      uniqueLinks.add(normalized);
      const c = classifyLink(config, { url: link.url, text: link.text, pageUrl: res.url, extraAllowedHosts });

      if (c.linkKind === 'denied') {
        stats.skippedDenied += 1;
        continue;
      }
      if (c.systemKind) {
        registerSystem(link.url, { kind: c.systemKind, seed: c.seedId ? config.sources.find((s) => s.id === c.seedId) ?? null : null }, {
          discoveredFrom: res.url,
          text: link.text,
          reached: false,
          isDocument: c.linkKind === 'document',
        });
      }
      switch (c.linkKind) {
        case 'media': {
          const m = media.get(normalized) ?? { url: link.url, linkTexts: [], foundOn: [] };
          if (link.text && !m.linkTexts.includes(link.text)) m.linkTexts.push(link.text);
          if (!m.foundOn.includes(res.url)) m.foundOn.push(res.url);
          media.set(normalized, m);
          break;
        }
        case 'document':
          addDocument(link.url, normalized, link.text, res.url, c);
          break;
        case 'page':
          if (mayCrawl(link.url, normalized, link.text, item.depth + 1)) {
            queue.push({ url: link.url, depth: item.depth + 1, from: res.url });
            queued.add(normalized);
          }
          break;
        default:
          break;
      }
    }
  }

  if (probeDocuments && seedReachable) {
    const toProbe = [...documents.values()].filter((d) => d.probe === null).slice(0, policy.maxDocumentProbes);
    for (const doc of toProbe) {
      const host = hostOf(doc.url);
      if (!host || isDeniedHost(config, host)) continue;
      stats.documentProbes += 1;
      try {
        const probe = await http.probe(doc.url, { allowRedirect: (_f, to) => !isDeniedHost(config, hostOf(to) ?? '') });
        if (probe.redirectChain.length) redirects.push({ requestedUrl: doc.url, finalUrl: probe.finalUrl, chain: probe.redirectChain });
        doc.probe = { method: probe.method, status: probe.status, contentType: probe.contentType, contentLength: probe.contentLength, finalUrl: probe.finalUrl, checkedAt: now().toISOString() };
        const kind = fileKindForMime(config, probe.contentType);
        if (kind && (doc.fileKind === null || doc.fileKind !== kind)) doc.fileKind = kind;
        if (probe.status >= 400) errors.push({ url: doc.url, kind: 'http_status', message: `document probe returned HTTP ${probe.status}`, status: probe.status });
      } catch (error) {
        const e = error as HttpError;
        errors.push({ url: doc.url, kind: e.kind ?? 'network', message: e.message, status: e.status ?? null });
      }
    }
  }

  stats.uniqueLinks = uniqueLinks.size;
  stats.mediaLinks = media.size;
  const systemList = [...systems.values()];
  const grouped: DiscoveryManifest['sources'] = {};
  for (const s of systemList.sort((a, b) => a.systemKind.localeCompare(b.systemKind) || a.id.localeCompare(b.id))) {
    (grouped[s.systemKind] ??= []).push(s);
  }
  const observedSeedIds = new Set(systemList.map((s) => s.configuredSeedId).filter(Boolean));
  const documentList = [...documents.values()].sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));

  return {
    generatedAt: now().toISOString(),
    seed: seedUrl,
    tool: DISCOVERY_TOOL,
    options: { maxDepth, maxPages, probeDocuments, respectRobotsTxt: policy.respectRobotsTxt },
    seedReachable,
    summary: {
      sourceSystems: systemList.length,
      directDocumentLinks: documentList.length,
      meetingOrPublicNoticeSystems: systemList.filter((s) => MEETING_KINDS.has(s.systemKind)).length,
      financialReportingSystems: systemList.filter((s) => FINANCE_KINDS.has(s.systemKind)).length,
      municipalCodeSystems: systemList.filter((s) => s.systemKind === 'municipal_code').length,
      documentLibraries: systemList.filter((s) => s.systemKind === 'document_library').length,
      sourcesNeedingReview: systemList.filter((s) => s.reviewStatus === 'needs_review').length,
    },
    stats,
    sources: grouped,
    configuredSeedsNotObserved: config.sources.filter((s) => s.baseUrl && !observedSeedIds.has(s.id)).map((s) => s.id),
    documents: documentList,
    mediaLinks: [...media.values()],
    pages,
    redirects,
    errors,
  };
}
