/** Archive integrity checks used by scripts/validate-archive.ts. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ArchiveStore, isValidRecordId } from './archive';
import { sha256Hex } from './hash';
import type { StorageProvider } from './storage/StorageProvider';
import type { ArchiveManifest, ArchiveRecord } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code:
    | 'invalid_record_file'
    | 'id_mismatch'
    | 'missing_file'
    | 'checksum_mismatch'
    | 'size_mismatch'
    | 'version_sequence'
    | 'no_provenance'
    | 'bad_provenance'
    | 'chunk_link'
    | 'chunk_pages'
    | 'duplicate_chunk_id'
    | 'duplicate_canonical'
    | 'dangling_duplicate_of'
    | 'relationship_link'
    | 'duplicate_slug'
    | 'ocr_state'
    | 'manifest_stale'
    | 'orphan_file';
  documentId: string | null;
  message: string;
}

export interface ValidationReport {
  records: number;
  versions: number;
  filesChecked: number;
  chunks: number;
  issues: ValidationIssue[];
}

export async function validateArchive(archive: ArchiveStore, storage: StorageProvider, options: { verifyChecksums?: boolean } = {}): Promise<ValidationReport> {
  const verify = options.verifyChecksums ?? true;
  const issues: ValidationIssue[] = [];
  const report: ValidationReport = { records: 0, versions: 0, filesChecked: 0, chunks: 0, issues };
  const add = (level: ValidationIssue['level'], code: ValidationIssue['code'], documentId: string | null, message: string) =>
    issues.push({ level, code, documentId, message });

  const records: ArchiveRecord[] = [];
  for (const file of archive.listRecordFiles()) {
    const id = file.replace(/\.json$/, '');
    if (!isValidRecordId(id)) {
      add('error', 'invalid_record_file', null, `Unexpected record file name: ${file}`);
      continue;
    }
    try {
      const record = JSON.parse(readFileSync(path.join(archive.layout.recordsDir, file), 'utf8')) as ArchiveRecord;
      if (record.document?.id !== id) add('error', 'id_mismatch', id, `File ${file} contains document id ${record.document?.id}`);
      records.push(record);
    } catch (error) {
      add('error', 'invalid_record_file', id, `Cannot parse ${file}: ${(error as Error).message}`);
    }
  }
  report.records = records.length;

  const ids = new Set(records.map((r) => r.document.id));
  const checksumOwner = new Map<string, string>();
  const slugs = new Map<string, string>();
  const chunkIds = new Set<string>();
  const referencedKeys = new Set<string>();

  for (const r of records) {
    const d = r.document;
    // Provenance
    if (!r.sources?.length) add('error', 'no_provenance', d.id, 'Document has no source references (provenance).');
    for (const s of r.sources ?? []) {
      if (!/^https?:\/\//.test(s.originalUrl ?? '') || !s.retrievedAt || !s.sourceId) {
        add('error', 'bad_provenance', d.id, `Source reference ${s.id} lacks originalUrl/retrievedAt/sourceId.`);
      }
    }
    // Versions + files
    const numbers = r.versions.map((v) => v.versionNumber).sort((a, b) => a - b);
    if (!numbers.length || numbers.some((n, i) => n !== i + 1)) add('error', 'version_sequence', d.id, `Version numbers are not 1..n: ${numbers.join(',')}`);
    if (numbers.length && d.currentVersion !== numbers[numbers.length - 1]) add('error', 'version_sequence', d.id, `currentVersion ${d.currentVersion} ≠ latest ${numbers[numbers.length - 1]}`);
    const current = r.versions.find((v) => v.versionNumber === d.currentVersion);
    if (current && current.checksum !== d.checksum) add('error', 'checksum_mismatch', d.id, 'Document checksum differs from its current version checksum.');
    for (const v of r.versions) {
      report.versions += 1;
      referencedKeys.add(v.storageKey);
      const stat = await storage.stat(v.storageKey);
      if (!stat) {
        add('error', 'missing_file', d.id, `Missing stored file for version ${v.versionNumber}: ${v.storageKey}`);
        continue;
      }
      if (v.fileSize !== null && stat.size !== v.fileSize) add('error', 'size_mismatch', d.id, `Version ${v.versionNumber}: ${stat.size} bytes on disk, ${v.fileSize} recorded`);
      if (verify) {
        const bytes = await storage.get(v.storageKey);
        report.filesChecked += 1;
        if (!bytes || sha256Hex(bytes) !== v.checksum) add('error', 'checksum_mismatch', d.id, `Version ${v.versionNumber}: stored bytes do not match SHA-256 ${v.checksum.slice(0, 12)}…`);
      }
    }
    // Duplicate canonical content across records
    if (!r.duplicateOf && d.checksum) {
      const owner = checksumOwner.get(d.checksum);
      if (owner && owner !== d.id) add('error', 'duplicate_canonical', d.id, `Same content (SHA-256) as canonical record ${owner}; merge the records.`);
      else checksumOwner.set(d.checksum, d.id);
    }
    if (r.duplicateOf && !ids.has(r.duplicateOf)) add('error', 'dangling_duplicate_of', d.id, `duplicateOf points to missing record ${r.duplicateOf}`);
    const slugOwner = slugs.get(d.slug);
    if (slugOwner) add('warning', 'duplicate_slug', d.id, `Slug "${d.slug}" also used by ${slugOwner}`);
    else slugs.set(d.slug, d.id);
    // Chunks
    for (const c of r.chunks) {
      report.chunks += 1;
      if (c.documentId !== d.id) add('error', 'chunk_link', d.id, `Chunk ${c.id} is linked to ${c.documentId}`);
      if (chunkIds.has(c.id)) add('error', 'duplicate_chunk_id', d.id, `Duplicate chunk id ${c.id}`);
      chunkIds.add(c.id);
      if (c.pageStart < 1 || c.pageEnd < c.pageStart || (d.pageCount !== null && c.pageEnd > d.pageCount)) {
        add('error', 'chunk_pages', d.id, `Chunk ${c.id} has invalid page range ${c.pageStart}-${c.pageEnd} (pageCount ${d.pageCount})`);
      }
    }
    for (const rel of r.relationships) {
      if (rel.fromDocumentId !== d.id) add('error', 'relationship_link', d.id, `Relationship ${rel.id} has fromDocumentId ${rel.fromDocumentId}`);
      if (rel.toKind === 'document' && !ids.has(rel.toId)) add('warning', 'relationship_link', d.id, `Relationship ${rel.id} points to a document not in the archive (${rel.toId})`);
    }
    if (d.ocrRequired && d.ocrStatus === 'not_required') add('error', 'ocr_state', d.id, 'ocrRequired=true but ocrStatus=not_required');
  }

  // Manifest consistency
  let manifest: ArchiveManifest | null;
  try {
    manifest = JSON.parse(readFileSync(archive.layout.manifest, 'utf8')) as ArchiveManifest;
  } catch {
    manifest = null;
  }
  if (records.length && (!manifest || manifest.documents.length !== records.length)) {
    add('warning', 'manifest_stale', null, 'manifest.json is missing or out of date (it is rebuilt automatically by the next ingest).');
  }

  // Orphan files
  for (const key of await storage.list('documents')) {
    if (!referencedKeys.has(key)) add('warning', 'orphan_file', null, `Stored file not referenced by any record: ${key}`);
  }
  return report;
}
