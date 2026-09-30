/** Default filesystem locations used by the CLI scripts (all relative to the repo root). */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  sourceSeeds: path.join(REPO_ROOT, 'config', 'source-seeds.json'),
  dataDir: path.join(REPO_ROOT, 'data'),
  discoveredSources: path.join(REPO_ROOT, 'data', 'discovered-sources.json'),
  discoveredSourcesSummary: path.join(REPO_ROOT, 'data', 'discovered-sources.summary.txt'),
  discoveredDocuments: path.join(REPO_ROOT, 'data', 'discovered-documents.json'),
  sourceHealth: path.join(REPO_ROOT, 'data', 'source-health.json'),
  archiveDir: path.join(REPO_ROOT, 'data', 'archive'),
  indexSqlite: path.join(REPO_ROOT, 'data', 'index.sqlite'),
  indexJson: path.join(REPO_ROOT, 'data', 'index.json'),
} as const;

/** Layout inside an archive directory. */
export function archiveLayout(archiveDir: string) {
  return {
    root: archiveDir,
    filesDir: path.join(archiveDir, 'files'),
    recordsDir: path.join(archiveDir, 'records'),
    manifest: path.join(archiveDir, 'manifest.json'),
  };
}
