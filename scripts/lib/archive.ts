/**
 * Archive record store: one JSON file per canonical document in <archive>/records/, plus a
 * lightweight fingerprint manifest (<archive>/manifest.json) used for duplicate detection so ingest
 * does not have to load every record (with its text) at start-up.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './cli';
import { archiveLayout } from './paths';
import type { ArchiveFingerprint, ArchiveManifest, ArchiveRecord } from './types';

const RECORD_ID_RE = /^doc_[a-f0-9]{16}$/;

export function isValidRecordId(id: string): boolean {
  return RECORD_ID_RE.test(id);
}

export function fingerprintOf(record: ArchiveRecord): ArchiveFingerprint {
  const d = record.document;
  return {
    documentId: d.id,
    checksums: [...new Set(record.versions.map((v) => v.checksum))],
    normalizedUrls: [...new Set(record.normalizedUrls)],
    documentNumber: d.documentNumber,
    documentType: d.documentType,
    fileName: d.fileName,
    fileSize: d.fileSize,
    title: d.title,
    date: d.date,
  };
}

export class ArchiveStore {
  readonly layout: ReturnType<typeof archiveLayout>;

  constructor(archiveDir: string) {
    this.layout = archiveLayout(path.resolve(archiveDir));
  }

  hasRecords(): boolean {
    return this.listRecordIds().length > 0;
  }

  ensureDirs(): void {
    mkdirSync(this.layout.recordsDir, { recursive: true });
    mkdirSync(this.layout.filesDir, { recursive: true });
  }

  /** Record files present on disk (including any with invalid names, so validation can report them). */
  listRecordFiles(): string[] {
    if (!existsSync(this.layout.recordsDir)) return [];
    return readdirSync(this.layout.recordsDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  }

  listRecordIds(): string[] {
    return this.listRecordFiles()
      .map((f) => f.replace(/\.json$/, ''))
      .filter(isValidRecordId);
  }

  recordPath(id: string): string {
    if (!isValidRecordId(id)) throw new Error(`Invalid record id: ${id}`);
    return path.join(this.layout.recordsDir, `${id}.json`);
  }

  readRecord(id: string): ArchiveRecord | null {
    const file = this.recordPath(id);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as ArchiveRecord;
  }

  *records(): Generator<ArchiveRecord> {
    for (const id of this.listRecordIds()) {
      const record = this.readRecord(id);
      if (record) yield record;
    }
  }

  writeRecord(record: ArchiveRecord): void {
    this.ensureDirs();
    writeJsonAtomic(this.recordPath(record.document.id), record);
  }

  /** Load the fingerprint manifest, rebuilding it from records when missing or stale. */
  loadManifest(): ArchiveManifest {
    const ids = this.listRecordIds();
    if (existsSync(this.layout.manifest)) {
      const manifest = JSON.parse(readFileSync(this.layout.manifest, 'utf8')) as ArchiveManifest;
      if (manifest.documents.length === ids.length) return manifest;
    }
    return this.rebuildManifest();
  }

  rebuildManifest(): ArchiveManifest {
    const manifest: ArchiveManifest = { updatedAt: new Date().toISOString(), documents: [...this.records()].map(fingerprintOf) };
    if (manifest.documents.length) this.saveManifest(manifest);
    return manifest;
  }

  saveManifest(manifest: ArchiveManifest): void {
    this.ensureDirs();
    writeJsonAtomic(this.layout.manifest, { ...manifest, updatedAt: new Date().toISOString() });
  }
}
