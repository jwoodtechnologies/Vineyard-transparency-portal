/**
 * npm run reindex [-- --archive-dir dir] [--out file] [--engine sqlite|json] [--query "text"]
 *
 * Builds the full-text index from archive records:
 *   sqlite (default when node:sqlite is available): data/index.sqlite with FTS5 tables
 *   json   (fallback): data/index.json inverted index
 * Semantic (vector) indexing runs only when an EmbeddingProvider is configured (none by default).
 * --query runs a smoke-test search against the freshly built index.
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ArchiveStore } from './lib/archive';
import { readJsonIfExists, relativeToCwd, runCli } from './lib/cli';
import { loadSeedsConfig } from './lib/config';
import { getEmbeddingProvider } from './lib/embeddings';
import { buildJsonIndex, buildSqliteIndex, loadSqlite, searchJsonIndex, searchSqliteIndex, type JsonIndex } from './lib/indexer';
import { PATHS } from './lib/paths';
import { buildRegistry } from './lib/registry';
import type { DiscoveryManifest } from './lib/types';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'archive-dir': { type: 'string' },
      out: { type: 'string' },
      engine: { type: 'string' },
      query: { type: 'string' },
      config: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: npm run reindex -- [--archive-dir dir] [--out file] [--engine sqlite|json] [--query "text"]');
    return 0;
  }
  const archive = new ArchiveStore(path.resolve(values['archive-dir'] ?? PATHS.archiveDir));
  if (!archive.hasRecords()) {
    console.log(`The archive is empty (${relativeToCwd(archive.layout.recordsDir)} has no records). Nothing to index.`);
    console.log('Run `npm run ingest` first. (The frontend works without an index in VITE_DATA_MODE=mock.)');
    return 0;
  }
  const config = loadSeedsConfig(values.config ?? PATHS.sourceSeeds);
  const registry = buildRegistry(config, readJsonIfExists<DiscoveryManifest>(PATHS.discoveredSources));
  const embedding = getEmbeddingProvider();

  const engine = values.engine ?? 'sqlite';
  if (engine !== 'sqlite' && engine !== 'json') throw new Error('--engine must be sqlite or json');
  const sqlite = engine === 'sqlite' ? loadSqlite() : null;
  if (engine === 'sqlite' && !sqlite) console.log('node:sqlite with FTS5 is not available in this Node runtime; falling back to the JSON index.');

  const started = Date.now();
  const stats = sqlite
    ? buildSqliteIndex(sqlite, archive.records(), registry, path.resolve(values.out ?? PATHS.indexSqlite))
    : buildJsonIndex(archive.records(), path.resolve(values.out ?? PATHS.indexJson));
  console.log(`Full-text index built (${stats.engine}) in ${Date.now() - started} ms → ${relativeToCwd(stats.output)}`);
  console.log(`  documents ${stats.documents} (canonical ${stats.canonicalDocuments}), chunks ${stats.chunks}, pages ${stats.pages}, relationships ${stats.relationships}, sources ${stats.sources}`);
  console.log(`  semantic index: ${embedding ? `${embedding.id}/${embedding.model}` : 'disabled (no EmbeddingProvider configured; see docs/INDEXING_ARCHITECTURE.md)'}`);

  if (values.query) {
    console.log(`\nSmoke-test query: ${JSON.stringify(values.query)}`);
    const hits = sqlite
      ? searchSqliteIndex(sqlite, stats.output, values.query, { limit: 5 }).map((h) => `${h.documentId} p.${h.pageStart}-${h.pageEnd}  ${h.title}\n      ${h.snippet}`)
      : searchJsonIndex(JSON.parse(readFileSync(stats.output, 'utf8')) as JsonIndex, values.query, 5).map((h) => `${h.documentId} (${h.chunkId}) score ${h.score.toFixed(2)}`);
    if (!hits.length) console.log('  no matches');
    for (const h of hits) console.log(`  - ${h}`);
  }
  return 0;
}

runCli(main);
