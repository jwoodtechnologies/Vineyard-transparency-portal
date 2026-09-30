/**
 * Source registry = configured seeds (config/source-seeds.json) + systems found by discovery
 * (data/discovered-sources.json). Newly discovered systems are registered as "needs_review" with
 * crawling and document discovery DISABLED until a maintainer reviews them and adds them to the
 * config (see docs/SOURCE_DISCOVERY.md → Review process).
 */
import type { DocumentSource, SourceType } from '../../src/types/models';
import { seedForUrl } from './classify';
import { shortId } from './hash';
import { hostMatches, hostOf } from './url';
import type { AdapterId, DiscoveredSource, DiscoveryManifest, SourceSeed, SourceSeedsConfig, SourceSystemKind } from './types';

export interface RegistrySource extends SourceSeed {
  origin: 'configured' | 'discovered';
  reviewStatus: 'configured' | 'needs_review';
}

export function adapterForSystem(kind: SourceSystemKind, host: string): AdapterId {
  switch (kind) {
    case 'meeting_portal':
      return hostMatches(host, 'suiteonemedia.com') ? 'suiteone' : 'generic-html';
    case 'public_notice_system':
      return 'utah-pmn';
    case 'financial_transparency':
      return 'transparent-utah';
    case 'state_auditor':
      return 'state-auditor';
    case 'municipal_code':
      return 'municipal-code';
    default:
      return 'generic-html';
  }
}

function fromDiscovered(d: DiscoveredSource): RegistrySource {
  return {
    id: d.id,
    name: d.name,
    baseUrl: d.baseUrl,
    sourceType: d.sourceType,
    authority: 'Unverified — review required',
    discoveredFrom: d.discoveredFrom,
    crawlEnabled: false,
    archiveEnabled: false,
    documentDiscoveryEnabled: false,
    lastChecked: null,
    notes: `Discovered automatically (${d.systemKind}). Review before enabling.`,
    adapter: adapterForSystem(d.systemKind, d.host),
    origin: 'discovered',
    reviewStatus: 'needs_review',
  };
}

export function buildRegistry(config: SourceSeedsConfig, discovered: DiscoveryManifest | null): RegistrySource[] {
  const registry: RegistrySource[] = config.sources.map((s) => ({ ...s, origin: 'configured', reviewStatus: 'configured' }));
  if (!discovered) return registry;
  const known = new Set(registry.map((r) => r.id));
  for (const group of Object.values(discovered.sources)) {
    for (const d of group ?? []) {
      if (d.configuredSeedId || known.has(d.id)) continue;
      registry.push(fromDiscovered(d));
      known.add(d.id);
    }
  }
  return registry;
}

/** Find the registry entry a URL belongs to; synthesize an "external" entry when unknown. */
export function resolveSourceForUrl(config: SourceSeedsConfig, registry: RegistrySource[], url: string, preferredId?: string | null): RegistrySource {
  if (preferredId) {
    const preferred = registry.find((r) => r.id === preferredId);
    if (preferred) return preferred;
  }
  const seed = seedForUrl(config, url);
  if (seed) return registry.find((r) => r.id === seed.id) ?? { ...seed, origin: 'configured', reviewStatus: 'configured' };
  const host = hostOf(url) ?? 'unknown';
  const discovered = registry.find((r) => r.baseUrl && hostOf(r.baseUrl) === host);
  if (discovered) return discovered;
  const type: SourceType = 'other';
  return {
    id: `external-${host.replace(/[^a-z0-9]+/g, '-')}`,
    name: host,
    baseUrl: `https://${host}/`,
    sourceType: type,
    authority: 'Unverified — external host',
    discoveredFrom: null,
    crawlEnabled: false,
    archiveEnabled: false,
    documentDiscoveryEnabled: false,
    lastChecked: null,
    notes: 'Synthesized for a document linked from an approved source page.',
    adapter: 'generic-html',
    origin: 'discovered',
    reviewStatus: 'needs_review',
  };
}

export function toDocumentSource(source: RegistrySource, documentId: string, originalUrl: string, retrievedAt: string, httpStatus: number | null): DocumentSource {
  return {
    id: `src_${shortId(`${documentId}|${source.id}|${originalUrl}`)}`,
    sourceId: source.id,
    name: source.name,
    baseUrl: source.baseUrl,
    sourceType: source.sourceType,
    authority: source.authority,
    originalUrl,
    retrievedAt,
    lastVerifiedAt: retrievedAt,
    originalAvailable: true,
    httpStatusAtLastCheck: httpStatus,
  };
}
