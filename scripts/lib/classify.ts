/**
 * Deterministic link classification (no AI). Every decision records a human-readable reason so the
 * discovery report can be audited.
 *
 * Inputs: a resolved URL, the link text, the URL of the page it was found on, and the seeds config.
 * Outputs: file kind, whether it is a document / crawlable page / media / denied / external,
 * the public-record system it belongs to, and a document-type hint from URL + link text.
 */
import type { DocumentType } from '../../src/types/models';
import { extensionOf, hostMatches, hostMatchesAny, hostOf, pathAndQuery } from './url';
import type {
  ApprovedDomain,
  FileKind,
  LinkClassification,
  SourceSeed,
  SourceSeedsConfig,
  SourceSystemKind,
  SourceType,
} from './types';

/** Ordered: the first matching rule wins (packet before agenda, etc.). */
const DOCUMENT_TYPE_RULES: Array<{ type: DocumentType; pattern: RegExp }> = [
  { type: 'agenda_packet', pattern: /\b(agenda\s*)?packets?\b|\bmeeting\s+packet\b/i },
  { type: 'minutes', pattern: /\bminutes\b/i },
  { type: 'transcript', pattern: /\btranscripts?\b/i },
  { type: 'recording', pattern: /\b(audio|video|recording|livestream|watch\s+(the\s+)?meeting|listen)\b/i },
  { type: 'agenda', pattern: /\bagendas?\b/i },
  { type: 'ordinance', pattern: /\bordinances?\b|\bord\.?\s*(no\.?\s*)?\d{2,4}[-–]\d+/i },
  { type: 'resolution', pattern: /\bresolutions?\b|\bres\.?\s*(no\.?\s*)?\d{2,4}[-–]\d+/i },
  { type: 'public_notice', pattern: /\b(public\s+)?notices?\b|\bhearing\s+notice\b/i },
  { type: 'staff_report', pattern: /\bstaff\s+reports?\b/i },
  { type: 'audit', pattern: /\baudits?\b|\bacfr\b|\bcafr\b|\bsingle\s+audit\b/i },
  { type: 'budget', pattern: /\bbudgets?\b/i },
  { type: 'financial_report', pattern: /\bfinancial\s+(report|statement)s?\b|\btreasurer'?s?\s+report\b/i },
  { type: 'development_agreement', pattern: /\bdevelopment\s+agreements?\b/i },
  { type: 'interlocal_agreement', pattern: /\binterlocal\b/i },
  { type: 'contract', pattern: /\bcontracts?\b|\bagreements?\b/i },
  { type: 'procurement', pattern: /\b(rfp|rfq|request\s+for\s+(proposals?|qualifications)|bids?)\b/i },
  { type: 'proclamation', pattern: /\bproclamations?\b/i },
  { type: 'map', pattern: /\bmaps?\b|\bzoning\s+map\b/i },
  { type: 'plan', pattern: /\b(general|master|capital|strategic)\s+plan\b/i },
  { type: 'study', pattern: /\bstud(y|ies)\b|\banalysis\b/i },
  { type: 'municipal_code', pattern: /\bmunicipal\s+code\b|\bcode\s+of\s+ordinances\b|\bcity\s+code\b/i },
];

/** Text used for heuristics: link text + decoded URL path/query with separators as spaces. */
function heuristicText(url: string, text: string): string {
  let pathText: string;
  try {
    const u = new URL(url);
    pathText = decodeURIComponent(u.pathname + ' ' + u.search).replace(/[_\-+/.=&?]+/g, ' ');
  } catch {
    pathText = '';
  }
  return `${text} ${pathText}`;
}

export function documentTypeHint(url: string, text: string): DocumentType | null {
  const haystack = heuristicText(url, text);
  for (const rule of DOCUMENT_TYPE_RULES) if (rule.pattern.test(haystack)) return rule.type;
  return null;
}

export function fileKindForExtension(config: SourceSeedsConfig, ext: string | null): FileKind | null {
  if (!ext) return null;
  return config.fileExtensions[ext]?.fileKind ?? null;
}

export function fileKindForMime(config: SourceSeedsConfig, mime: string | null): FileKind | null {
  if (!mime) return null;
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  for (const rule of Object.values(config.fileExtensions)) if (rule.mimeTypes.includes(mime)) return rule.fileKind;
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return null;
}

export function isArchivableKind(config: SourceSeedsConfig, kind: FileKind | null): boolean {
  if (!kind) return false;
  return Object.values(config.fileExtensions).some((r) => r.fileKind === kind && r.archivable);
}

export function sourceTypeForSystem(kind: SourceSystemKind): SourceType {
  if (kind === 'meeting_media') return 'meeting_portal';
  if (kind === 'utah_gov_database') return 'other';
  return kind;
}

/** Configured seed a URL belongs to (host + optional path prefix). Longest prefix wins. */
export function seedForUrl(config: SourceSeedsConfig, url: string): SourceSeed | null {
  const host = hostOf(url);
  if (!host) return null;
  const path = pathAndQuery(url);
  let best: SourceSeed | null = null;
  let bestScore = -1;
  for (const seed of config.sources) {
    if (!seed.baseUrl) continue;
    const seedHost = hostOf(seed.baseUrl);
    if (!seedHost || seedHost !== host) continue;
    const prefix = (seed.pathPrefix ?? '/').toLowerCase();
    if (!path.startsWith(prefix) && `${path}/` !== prefix) continue;
    if (prefix.length > bestScore) {
      best = seed;
      bestScore = prefix.length;
    }
  }
  return best;
}

export function approvedDomainFor(config: SourceSeedsConfig, url: string, extraAllowedHosts: readonly string[] = []): ApprovedDomain | null {
  const host = hostOf(url);
  if (!host) return null;
  if (extraAllowedHosts.some((p) => hostMatches(host, p))) {
    return { pattern: host, crawl: 'full', reason: 'allowed via --allow-host' };
  }
  const path = pathAndQuery(url);
  for (const d of config.approvedDomains) {
    if (!hostMatches(host, d.pattern)) continue;
    if (d.pathPrefixes?.length && !d.pathPrefixes.some((p) => path.startsWith(p.toLowerCase()) || `${path}/` === p.toLowerCase())) continue;
    return d;
  }
  return null;
}

export function isDeniedHost(config: SourceSeedsConfig, host: string): boolean {
  return config.deniedDomains.some((d) => hostMatches(host, d.pattern));
}

/** Recognise the public-record system a URL belongs to (configured seeds first, then patterns). */
export function systemKindForUrl(config: SourceSeedsConfig, url: string, text = ''): { kind: SourceSystemKind | null; seed: SourceSeed | null; reason: string | null } {
  const host = hostOf(url);
  if (!host) return { kind: null, seed: null, reason: null };
  const path = pathAndQuery(url);

  // Path-scoped system patterns (document libraries, agenda centers) take precedence over the
  // generic "city website" seed on the same host, but not over a more specific seed prefix.
  const seed = seedForUrl(config, url);
  if (seed?.pathPrefix) return { kind: seed.sourceType, seed, reason: `configured seed ${seed.id}` };

  for (const p of config.sourceSystemPatterns) {
    const hostOk = !p.hostPatterns?.length || hostMatchesAny(host, p.hostPatterns);
    const pathOk = !p.pathPatterns?.length || p.pathPatterns.some((re) => new RegExp(re, 'i').test(path));
    if (!hostOk || !pathOk) continue;
    // Host-less path patterns only apply to hosts we already consider public-record hosts.
    if (!p.hostPatterns?.length && !seed && !config.approvedDomains.some((d) => hostMatches(host, d.pattern))) continue;
    return { kind: p.systemKind, seed, reason: `pattern: ${p.label}` };
  }
  if (seed) return { kind: seed.sourceType, seed, reason: `configured seed ${seed.id}` };

  const municipal = config.sources.find((s) => s.sourceType === 'municipal_code');
  if (municipal?.discoveryHints?.hostPatterns && hostMatchesAny(host, municipal.discoveryHints.hostPatterns)) {
    return { kind: 'municipal_code', seed: null, reason: 'municipal code host pattern (hint)' };
  }
  if (hostMatchesAny(host, config.mediaDomains) && /\b(meeting|council|commission|live|stream|board)\b/i.test(heuristicText(url, text))) {
    return { kind: 'meeting_media', seed: null, reason: 'media host with meeting-related link' };
  }
  return { kind: null, seed: null, reason: null };
}

export interface ClassifyInput {
  url: string;
  text?: string;
  /** Page the link was found on (for internal/external). */
  pageUrl?: string | null;
  /** Content type if already known (e.g. from a probe). */
  contentType?: string | null;
  extraAllowedHosts?: readonly string[];
}

const DOCUMENT_PATH_HINTS = [
  /\/documentcenter\/view\/\d+/i,
  /\/archive\.aspx\?.*\badid=\d+/i,
  /\/agendacenter\/viewfile\//i,
  /\/weblink\/(docview|electronicfile|pdf)/i,
  /[?&](download|attachment)=/i,
  /\/(download|getfile|viewfile|showdocument|fileopen)(\.aspx|\.php|\/|\?|$)/i,
];

export function classifyLink(config: SourceSeedsConfig, input: ClassifyInput): LinkClassification {
  const { url, text = '', pageUrl = null, contentType = null, extraAllowedHosts = [] } = input;
  const reasons: string[] = [];
  const host = hostOf(url) ?? '';
  const ext = extensionOf(url);
  const pageHost = pageUrl ? hostOf(pageUrl) : null;
  const isExternal = pageHost !== null && pageHost !== host;
  const hostDenied = !extraAllowedHosts.some((p) => hostMatches(host, p)) && isDeniedHost(config, host);
  const approved = approvedDomainFor(config, url, extraAllowedHosts);
  const { kind: systemKind, seed, reason: systemReason } = systemKindForUrl(config, url, text);
  if (systemReason) reasons.push(systemReason);

  const base: LinkClassification = {
    linkKind: 'page',
    fileKind: null,
    extension: ext,
    systemKind,
    seedId: seed?.id ?? null,
    documentTypeHint: null,
    hostApproved: approved !== null,
    hostDenied,
    isExternal,
    reasons,
  };

  if (hostDenied) {
    reasons.push('denied domain (social/marketing/news/advertising)');
    return { ...base, linkKind: 'denied' };
  }

  const kindFromMime = fileKindForMime(config, contentType);
  const kindFromExt = fileKindForExtension(config, ext);
  let fileKind: FileKind | null = kindFromMime && kindFromMime !== 'html' ? kindFromMime : kindFromExt;
  if (kindFromMime === 'html' && kindFromExt === null) fileKind = 'html';
  if (kindFromMime) reasons.push(`content-type ${contentType}`);
  else if (kindFromExt) reasons.push(`extension .${ext}`);

  const documentTypeHintValue = documentTypeHint(url, text);
  const isMediaHost = hostMatchesAny(host, config.mediaDomains);

  if (isMediaHost || fileKind === 'audio' || fileKind === 'video') {
    reasons.push(isMediaHost ? 'media host' : 'media file');
    return { ...base, linkKind: 'media', fileKind, documentTypeHint: documentTypeHintValue ?? 'recording' };
  }

  const documentPath = DOCUMENT_PATH_HINTS.some((re) => re.test(url));
  if ((fileKind && fileKind !== 'html') || documentPath) {
    if (documentPath && !fileKind) reasons.push('document-library download path (content type to be probed)');
    return { ...base, linkKind: 'document', fileKind: fileKind && fileKind !== 'html' ? fileKind : null, documentTypeHint: documentTypeHintValue };
  }

  if (!approved) {
    reasons.push(isExternal ? 'external host (not approved for crawling)' : 'host not approved for crawling');
    return { ...base, linkKind: 'external', fileKind, documentTypeHint: documentTypeHintValue };
  }
  return { ...base, linkKind: 'page', fileKind, documentTypeHint: documentTypeHintValue };
}

/** True if a child page is worth crawling (URL or link text mentions a public-records keyword). */
export function isRelevantPage(config: SourceSeedsConfig, url: string, text: string): boolean {
  const haystack = heuristicText(url, text).toLowerCase();
  return config.crawlPolicy.relevantKeywords.some((k) => haystack.includes(k.toLowerCase()));
}

export function isSkippedUrl(config: SourceSeedsConfig, url: string): boolean {
  const pq = pathAndQuery(url);
  return config.crawlPolicy.skipUrlPatterns.some((re) => new RegExp(re, 'i').test(pq));
}
