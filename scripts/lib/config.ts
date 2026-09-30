/** Loading and validation of config/source-seeds.json. */
import { readFileSync } from 'node:fs';
import { PATHS } from './paths';
import type { SourceSeed, SourceSeedsConfig } from './types';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const SOURCE_TYPES = new Set([
  'city_website',
  'transparency_portal',
  'meeting_portal',
  'public_notice_system',
  'financial_transparency',
  'state_auditor',
  'municipal_code',
  'document_library',
  'gis_portal',
  'other',
]);
const ADAPTERS = new Set(['generic-html', 'suiteone', 'utah-pmn', 'transparent-utah', 'state-auditor', 'municipal-code']);

/** Structural validation. Returns a list of problems (empty = valid). */
export function validateSeedsConfig(config: SourceSeedsConfig): string[] {
  const problems: string[] = [];
  if (!config || typeof config !== 'object') return ['config is not an object'];
  if (typeof config.primarySourceSeed !== 'string' || !/^https?:\/\//.test(config.primarySourceSeed)) {
    problems.push('primarySourceSeed must be an http(s) URL');
  }
  if (!Array.isArray(config.sources) || config.sources.length === 0) problems.push('sources must be a non-empty array');
  const ids = new Set<string>();
  let primaryCount = 0;
  for (const [i, s] of (config.sources ?? []).entries()) {
    const where = `sources[${i}] (${s?.id ?? '?'})`;
    if (!s.id || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) problems.push(`${where}: id must be a lower-case slug`);
    if (ids.has(s.id)) problems.push(`${where}: duplicate id`);
    ids.add(s.id);
    if (!SOURCE_TYPES.has(s.sourceType)) problems.push(`${where}: unknown sourceType ${s.sourceType}`);
    if (!ADAPTERS.has(s.adapter)) problems.push(`${where}: unknown adapter ${s.adapter}`);
    if (typeof s.baseUrl !== 'string') problems.push(`${where}: baseUrl must be a string ("" when not yet discovered)`);
    if (s.baseUrl && !/^https?:\/\//.test(s.baseUrl)) problems.push(`${where}: baseUrl must be http(s) or ""`);
    if (!s.baseUrl && (s.crawlEnabled || s.documentDiscoveryEnabled)) {
      problems.push(`${where}: crawl/documentDiscovery cannot be enabled without a baseUrl`);
    }
    for (const key of ['crawlEnabled', 'archiveEnabled', 'documentDiscoveryEnabled'] as const) {
      if (typeof s[key] !== 'boolean') problems.push(`${where}: ${key} must be boolean`);
    }
    if (s.primary) primaryCount += 1;
  }
  if (primaryCount !== 1) problems.push(`exactly one source must have primary: true (found ${primaryCount})`);
  const primary = config.sources?.find((s) => s.primary);
  if (primary && primary.baseUrl !== config.primarySourceSeed) {
    problems.push('the primary source baseUrl must equal primarySourceSeed');
  }
  for (const [i, pattern] of (config.crawlPolicy?.skipUrlPatterns ?? []).entries()) {
    try {
      new RegExp(pattern, 'i');
    } catch {
      problems.push(`crawlPolicy.skipUrlPatterns[${i}] is not a valid regex`);
    }
  }
  for (const [i, p] of (config.sourceSystemPatterns ?? []).entries()) {
    for (const re of p.pathPatterns ?? []) {
      try {
        new RegExp(re, 'i');
      } catch {
        problems.push(`sourceSystemPatterns[${i}] pathPattern ${re} is not a valid regex`);
      }
    }
  }
  if (!config.crawlPolicy?.userAgent) problems.push('crawlPolicy.userAgent is required');
  return problems;
}

export function loadSeedsConfig(file: string = PATHS.sourceSeeds): SourceSeedsConfig {
  let parsed: SourceSeedsConfig;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as SourceSeedsConfig;
  } catch (error) {
    throw new ConfigError(`Could not read ${file}: ${(error as Error).message}`);
  }
  const problems = validateSeedsConfig(parsed);
  if (problems.length) throw new ConfigError(`Invalid ${file}:\n  - ${problems.join('\n  - ')}`);
  return parsed;
}

export function primarySeed(config: SourceSeedsConfig): SourceSeed {
  const seed = config.sources.find((s) => s.primary);
  if (!seed) throw new ConfigError('No primary source configured');
  return seed;
}

/** Warn when the crawler identifies itself with the placeholder contact URL. */
export function userAgentWarning(config: SourceSeedsConfig): string | null {
  return /example\.invalid/.test(config.crawlPolicy.userAgent)
    ? 'crawlPolicy.userAgent still contains the placeholder contact URL (example.invalid). Replace it with a real project contact page before crawling government sites.'
    : null;
}
