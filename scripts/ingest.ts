/**
 * npm run ingest [-- --from <file>] [--limit N] [--archive-dir dir] [--max-bytes N]
 *                  [--allow-host h]... [--include-unapproved-hosts] [--delay-ms N] [--dry-run] [--verbose]
 *
 * Downloads candidate documents, hashes, de-duplicates, stores, extracts text, chunks, and writes
 * archive records (data/archive/records/*.json). See docs/INDEXING_ARCHITECTURE.md.
 *
 * --from accepts: data/discovered-documents.json (default), data/discovered-sources.json, or a
 * JSON array of {"url": "...", "title"?: "...", "sourceId"?: "..."}.
 */
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ArchiveStore } from './lib/archive';
import { parsePositiveInt, readJsonIfExists, relativeToCwd, runCli } from './lib/cli';
import { NoopClassifier } from './lib/classifier';
import { loadSeedsConfig, userAgentWarning } from './lib/config';
import { httpOptionsFromPolicy, PoliteHttpClient } from './lib/http';
import { candidatesFromInput, ingestAll, type IngestStatus } from './lib/ingest';
import { NoopOcrProvider } from './lib/ocr';
import { PATHS } from './lib/paths';
import { buildRegistry } from './lib/registry';
import { LocalFilesystemStorage } from './lib/storage/LocalFilesystemStorage';
import type { DiscoveryManifest } from './lib/types';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      limit: { type: 'string' },
      'archive-dir': { type: 'string' },
      'max-bytes': { type: 'string' },
      config: { type: 'string' },
      'allow-host': { type: 'string', multiple: true },
      'include-unapproved-hosts': { type: 'boolean', default: false },
      'delay-ms': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: npm run ingest -- [--from file] [--limit N] [--archive-dir dir] [--max-bytes N] [--allow-host h] [--include-unapproved-hosts] [--delay-ms N] [--dry-run] [--verbose]');
    return 0;
  }
  const config = loadSeedsConfig(values.config ?? PATHS.sourceSeeds);

  let from = values.from;
  if (!from) {
    if (existsSync(PATHS.discoveredDocuments)) from = PATHS.discoveredDocuments;
    else if (existsSync(PATHS.discoveredSources)) from = PATHS.discoveredSources;
  }
  if (!from || !existsSync(from)) {
    console.log(
      from
        ? `Input file not found: ${from}`
        : 'Nothing to ingest: no candidate list found (data/discovered-documents.json or data/discovered-sources.json).',
    );
    console.log('Run `npm run discover-sources` and `npm run discover-documents` first, or pass --from <file>.');
    return 0;
  }
  let candidates = candidatesFromInput(JSON.parse(readFileSync(from, 'utf8')));
  const limit = parsePositiveInt(values.limit, 'limit');
  if (limit !== undefined) candidates = candidates.slice(0, limit);
  console.log(`Ingesting ${candidates.length} candidate document(s) from ${relativeToCwd(path.resolve(from))}`);
  if (!candidates.length) {
    console.log('The candidate list is empty. Nothing to do.');
    return 0;
  }
  if (values['dry-run']) {
    for (const c of candidates) console.log(`  would fetch ${c.url}${c.title ? `  (${c.title})` : ''}`);
    console.log('(dry run: nothing downloaded)');
    return 0;
  }
  const uaWarning = userAgentWarning(config);
  if (uaWarning) console.warn(`Warning: ${uaWarning}\n`);

  const archiveDir = path.resolve(values['archive-dir'] ?? PATHS.archiveDir);
  const archive = new ArchiveStore(archiveDir);
  const log = (m: string) => console.log(m);
  const outcomes = await ingestAll(candidates, {
    config,
    http: new PoliteHttpClient(
      httpOptionsFromPolicy(config.crawlPolicy, {
        requestDelayMs: parsePositiveInt(values['delay-ms'], 'delay-ms') ?? config.crawlPolicy.requestDelayMs,
        log: values.verbose ? log : undefined,
      }),
    ),
    storage: new LocalFilesystemStorage(archive.layout.filesDir),
    archive,
    registry: buildRegistry(config, readJsonIfExists<DiscoveryManifest>(PATHS.discoveredSources)),
    ocr: new NoopOcrProvider(),
    classifier: new NoopClassifier(),
    extraAllowedHosts: values['allow-host'] ?? [],
    maxBytes: parsePositiveInt(values['max-bytes'], 'max-bytes') ?? config.crawlPolicy.maxDocumentBytes,
    includeUnapprovedHosts: values['include-unapproved-hosts'] ?? false,
    now: () => new Date(),
    log,
  });

  const counts = new Map<IngestStatus, number>();
  for (const o of outcomes) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
  console.log('\nIngest complete.');
  for (const status of ['created', 'new_version', 'source_added', 'unchanged', 'probable_duplicate', 'skipped', 'failed'] as IngestStatus[]) {
    if (counts.get(status)) console.log(`  ${status.padEnd(18)} ${counts.get(status)}`);
  }
  console.log(`Archive: ${relativeToCwd(archiveDir)}  (next: npm run reindex && npm run validate-archive)`);
  const failures = counts.get('failed') ?? 0;
  return failures > 0 && failures === outcomes.length ? 1 : 0;
}

runCli(main);
