/**
 * npm run source-health [-- --sources id,id] [--include-discovered] [--out file] [--strict] [--delay-ms N] [--dry-run]
 *
 * Checks every registry source and writes data/source-health.json with
 * status active | degraded | unreachable | changed | authentication_required | blocked | unknown
 * and lastSuccessfulCheckAt (carried over from the previous report when the check fails).
 * --strict exits 1 when any checked source is not "active".
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { adapterFor, createAdapters } from './adapters/index';
import { parsePositiveInt, readJsonIfExists, relativeToCwd, runCli, writeJsonAtomic } from './lib/cli';
import { loadSeedsConfig } from './lib/config';
import { httpOptionsFromPolicy, PoliteHttpClient } from './lib/http';
import { PATHS } from './lib/paths';
import { buildRegistry } from './lib/registry';
import type { DiscoveryManifest, SourceHealthRecord, SourceHealthReport } from './lib/types';

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      sources: { type: 'string' },
      'include-discovered': { type: 'boolean', default: false },
      out: { type: 'string' },
      config: { type: 'string' },
      strict: { type: 'boolean', default: false },
      'delay-ms': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: npm run source-health -- [--sources id,id] [--include-discovered] [--out file] [--strict] [--delay-ms N] [--dry-run]');
    return 0;
  }
  const config = loadSeedsConfig(values.config ?? PATHS.sourceSeeds);
  const out = path.resolve(values.out ?? PATHS.sourceHealth);
  const previous = readJsonIfExists<SourceHealthReport>(out);
  const registry = buildRegistry(config, values['include-discovered'] ? readJsonIfExists<DiscoveryManifest>(PATHS.discoveredSources) : null);
  const only = values.sources ? new Set(values.sources.split(',').map((s) => s.trim())) : null;
  const http = new PoliteHttpClient(
    httpOptionsFromPolicy(config.crawlPolicy, { requestDelayMs: parsePositiveInt(values['delay-ms'], 'delay-ms') ?? config.crawlPolicy.requestDelayMs, maxRetries: 1 }),
  );
  const adapters = createAdapters();
  const results: SourceHealthRecord[] = [];

  console.log(`Checking ${only ? only.size : registry.length} source(s)...\n`);
  for (const source of registry) {
    if (only && !only.has(source.id)) continue;
    const adapter = adapterFor(adapters, source.adapter, source.baseUrl);
    const prev = previous?.sources.find((s) => s.sourceId === source.id) ?? null;
    const result = await adapter.health(
      { source, config, http, log: () => undefined, maxPages: 1, maxDepth: 0, extraAllowedHosts: [], now: () => new Date() },
      prev,
    );
    results.push(result);
  }

  console.log(`${pad('SOURCE', 32)} ${pad('STATUS', 24)} ${pad('HTTP', 5)} ${pad('LAST SUCCESS', 21)} MESSAGE`);
  for (const r of results) {
    console.log(`${pad(r.sourceId, 32)} ${pad(r.status, 24)} ${pad(r.httpStatus === null ? '-' : String(r.httpStatus), 5)} ${pad(r.lastSuccessfulCheckAt ?? 'never', 21)} ${r.message}`);
  }
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  console.log(`\n${[...counts.entries()].map(([s, n]) => `${n} ${s}`).join(', ')}`);
  if (results.some((r) => r.message.startsWith('Local network policy'))) {
    console.log('Note: "blocked" results marked "Local network policy" come from this machine\'s egress proxy, not from the sources.');
  }

  if (!values['dry-run']) {
    const report: SourceHealthReport = { generatedAt: new Date().toISOString(), sources: results };
    writeJsonAtomic(out, report);
    console.log(`Output: ${relativeToCwd(out)}`);
  }
  return values.strict && results.some((r) => r.status !== 'active') ? 1 : 0;
}

runCli(main);
