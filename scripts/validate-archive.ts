/**
 * npm run validate-archive [-- --archive-dir dir] [--skip-checksums] [--json]
 *
 * Verifies stored files (existence, size, SHA-256), chunk→document links, version sequences,
 * duplicate canonical records, provenance, and orphan files. Exit code 1 when any error is found.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ArchiveStore } from './lib/archive';
import { relativeToCwd, runCli } from './lib/cli';
import { PATHS } from './lib/paths';
import { LocalFilesystemStorage } from './lib/storage/LocalFilesystemStorage';
import { validateArchive } from './lib/validate';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'archive-dir': { type: 'string' },
      'skip-checksums': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Usage: npm run validate-archive -- [--archive-dir dir] [--skip-checksums] [--json]');
    return 0;
  }
  const archive = new ArchiveStore(path.resolve(values['archive-dir'] ?? PATHS.archiveDir));
  if (!archive.listRecordFiles().length) {
    console.log(`The archive is empty (${relativeToCwd(archive.layout.recordsDir)} has no records). Nothing to validate.`);
    console.log('Run `npm run ingest` to archive documents first.');
    return 0;
  }
  const report = await validateArchive(archive, new LocalFilesystemStorage(archive.layout.filesDir), { verifyChecksums: !values['skip-checksums'] });
  const errors = report.issues.filter((i) => i.level === 'error');
  const warnings = report.issues.filter((i) => i.level === 'warning');
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Archive validation report');
    console.log(`  records ${report.records}, versions ${report.versions}, files checksummed ${report.filesChecked}, chunks ${report.chunks}`);
    console.log(`  errors ${errors.length}, warnings ${warnings.length}`);
    for (const i of [...errors, ...warnings]) console.log(`  ${i.level === 'error' ? 'ERROR' : 'warn '} [${i.code}]${i.documentId ? ` ${i.documentId}` : ''}: ${i.message}`);
    console.log(errors.length ? '\nValidation FAILED.' : '\nValidation passed.');
  }
  return errors.length ? 1 : 0;
}

runCli(main);
