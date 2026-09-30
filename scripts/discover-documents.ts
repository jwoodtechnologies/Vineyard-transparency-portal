/**
 * npm run discover-documents [-- --sources id,id] [--max-pages N] [--max-depth N] [--out file]
 *                              [--allow-host h]... [--delay-ms N] [--no-discovered-links] [--dry-run] [--verbose]
 *
 * Runs each enabled source's adapter (scripts/adapters/) over the source registry
 * (config/source-seeds.json + reviewed systems from data/discovered-sources.json) and writes
 * candidate documents to data/discovered-documents.json for `npm run ingest`.
 *
 * Exit codes: 0 success, 1 usage/config error, 2 every enabled source failed (nothing written).
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { adapterFor, createAdapters } from './adapters/index';
import { mergeCandidates } from './adapters/common';
import { parsePositiveInt, readJsonIfExists, relativeToCwd, runCli, writeJsonAtomic } from './lib/cli';
import { loadSeedsConfig, userAgentWarning } from './lib/config';
import { extractDates, extractDocumentNumbers } from './lib/metadata';
import { httpOptionsFromPolicy, PoliteHttpClient } from './lib/http';
import { PATHS } from './lib/paths';
import { buildRegistry, resolveSourceForUrl } from './lib/registry';
import type { CandidateDocument, DiscoveryManifest, DocumentDiscoveryManifest, PerSourceDiscoveryResult } from './lib/types';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      sources: { type: 'string' },
      'max-pages': { type: 'string' },
      'max-depth': { type: 'string' },
      out: { type: 'string' },
      config: { type: 'string' },
      discovered: { type: 'string' },
      'allow-host': { type: 'string', multiple: true },
      'delay-ms': { type: 'string' },
      'no-discovered-links': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: npm run discover-documents -- [--sources id,id] [--max-pages N] [--max-depth N] [--out file] [--allow-host h] [--delay-ms N] [--no-discovered-links] [--dry-run] [--verbose]');
    return 0;
  }
  const config = loadSeedsConfig(values.config ?? PATHS.sourceSeeds);
  const uaWarning = userAgentWarning(config);
  if (uaWarning) console.warn(`Warning: ${uaWarning}\n`);
  const discoveredPath = values.discovered ?? PATHS.discoveredSources;
  const discovered = readJsonIfExists<DiscoveryManifest>(discoveredPath);
  if (!discovered) {
    console.log(`Note: ${relativeToCwd(discoveredPath)} not found — run \`npm run discover-sources\` first to include newly discovered systems and directly linked documents. Continuing with configured seeds only.\n`);
  }
  const registry = buildRegistry(config, discovered);
  const only = values.sources ? new Set(values.sources.split(',').map((s) => s.trim())) : null;
  const out = path.resolve(values.out ?? PATHS.discoveredDocuments);
  const maxPages = parsePositiveInt(values['max-pages'], 'max-pages') ?? 100;
  const maxDepthOverride = parsePositiveInt(values['max-depth'], 'max-depth');
  const log = values.verbose ? (m: string) => console.log(m) : () => undefined;
  const http = new PoliteHttpClient(
    httpOptionsFromPolicy(config.crawlPolicy, { requestDelayMs: parsePositiveInt(values['delay-ms'], 'delay-ms') ?? config.crawlPolicy.requestDelayMs, log }),
  );
  const adapters = createAdapters();

  const manifest: DocumentDiscoveryManifest = { generatedAt: new Date().toISOString(), candidates: [], meetings: [], codeOutline: [], perSource: [], errors: [] };
  let attempted = 0;
  let failed = 0;

  for (const source of registry) {
    if (only && !only.has(source.id)) continue;
    const adapter = adapterFor(adapters, source.adapter, source.baseUrl);
    const record = (status: PerSourceDiscoveryResult['status'], message: string | null, candidateCount = 0, meetingCount = 0) =>
      manifest.perSource.push({ sourceId: source.id, adapterId: adapter.id, status, candidateCount, meetingCount, message });

    if (!source.baseUrl) {
      record('not_configured', 'No baseUrl yet (must be discovered and reviewed).');
      continue;
    }
    if (!source.documentDiscoveryEnabled) {
      record('skipped', source.reviewStatus === 'needs_review' ? 'Discovered system awaiting review; not crawled.' : 'documentDiscoveryEnabled=false');
      continue;
    }
    attempted += 1;
    console.log(`→ ${source.id} (${adapter.id}${adapter.verification === 'unverified' ? ', unverified structure' : ''})`);
    try {
      const result = await adapter.discoverDocuments({
        source,
        config,
        http,
        log,
        maxPages,
        maxDepth: maxDepthOverride ?? source.maxDepth ?? config.crawlPolicy.defaultMaxDepth,
        extraAllowedHosts: values['allow-host'] ?? [],
        now: () => new Date(),
      });
      manifest.candidates.push(...result.candidates);
      manifest.meetings.push(...result.meetings);
      manifest.codeOutline.push(...result.codeOutline);
      manifest.errors.push(...result.errors);
      if (result.status === 'error') failed += 1;
      const msg = [...result.notes, ...result.errors.slice(0, 2).map((e) => `[${e.kind}] ${e.message}`)].join('; ') || null;
      record(result.status, msg, result.candidates.length, result.meetings.length);
      console.log(`   ${result.status}: ${result.candidates.length} candidates, ${result.meetings.length} meetings${msg ? ` — ${msg}` : ''}`);
    } catch (error) {
      failed += 1;
      record('error', (error as Error).message);
      console.log(`   error: ${(error as Error).message}`);
    }
  }

  // Documents linked directly from pages crawled by discover-sources.
  if (discovered && !values['no-discovered-links']) {
    const fromDiscovery: CandidateDocument[] = discovered.documents.map((d) => {
      const text = d.linkTexts[0] ?? null;
      const source = resolveSourceForUrl(config, registry, d.url, d.sourceId);
      return {
        url: d.url,
        normalizedUrl: d.normalizedUrl,
        title: text,
        linkText: text,
        documentTypeHint: d.documentTypeHint,
        fileKind: d.fileKind,
        sourceId: source.id,
        adapterId: 'generic-html',
        foundOn: d.foundOn,
        hostApproved: d.hostApproved,
        dateHint: text ? extractDates(text)[0]?.iso ?? null : null,
        documentNumberHint: text ? extractDocumentNumbers(text)[0]?.label ?? null : null,
        meeting: null,
        contentType: d.probe?.contentType ?? null,
        contentLength: d.probe?.contentLength ?? null,
      };
    });
    manifest.candidates.push(...fromDiscovery);
    console.log(`\n+ ${fromDiscovery.length} documents linked directly from pages crawled by discover-sources`);
  }
  manifest.candidates = mergeCandidates(manifest.candidates);

  if (attempted > 0 && failed === attempted && manifest.candidates.length === 0) {
    console.error('\nDocument discovery FAILED: every enabled source failed and no candidates were found.');
    for (const e of manifest.errors.slice(0, 8)) console.error(`  - [${e.kind}] ${e.url}: ${e.message}`);
    if (manifest.errors.some((e) => e.kind === 'blocked_by_network_policy')) {
      console.error('\nResponses came from a local network egress policy, not from the sources. Allow outbound HTTPS to the hosts in config/source-seeds.json.');
    } else {
      console.error('\nCheck network access to the source hosts and re-run.');
    }
    console.error('Nothing was written.');
    return 2;
  }

  console.log(`\nDocument discovery complete: ${manifest.candidates.length} candidate documents, ${manifest.meetings.length} meetings, ${manifest.codeOutline.length} code outline entries, ${manifest.errors.length} errors.`);
  if (!values['dry-run']) {
    writeJsonAtomic(out, manifest);
    console.log(`Output: ${relativeToCwd(out)}`);
  } else {
    console.log('(dry run: no files written)');
  }
  return 0;
}

runCli(main);
