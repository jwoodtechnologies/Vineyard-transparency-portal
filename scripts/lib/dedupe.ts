/**
 * Duplicate detection for incoming documents against the archive manifest.
 *
 * Signals, strongest first:
 *   checksum         identical bytes (SHA-256)             -> same record; add the new source reference
 *   url              same normalized URL, different bytes   -> same record; NEW VERSION (changeStatus "replaced")
 *   document_number  same type + printed number             -> probable duplicate (flag, keep both, link DUPLICATE_OF)
 *   filename_size    same sanitized file name + byte size   -> probable duplicate
 *   title_date       same normalized title + same date      -> probable duplicate
 *
 * Probable duplicates are never merged automatically because the bytes differ (e.g. an agenda and
 * an amended agenda). They are recorded with duplicateOf + a DUPLICATE_OF relationship
 * (basis "metadata_match") so search can collapse them and a human can review.
 */
import type { DocumentType, ISODate } from '../../src/types/models';
import type { ArchiveFingerprint } from './types';

export type DuplicateMatchKind = 'checksum' | 'url' | 'document_number' | 'filename_size' | 'title_date';

export interface DuplicateMatch {
  kind: DuplicateMatchKind;
  /** exact: identical content; same_url: new version of the same resource; probable: metadata match. */
  strength: 'exact' | 'same_url' | 'probable';
  documentId: string;
}

export interface IncomingFingerprint {
  checksum: string;
  normalizedUrl: string;
  documentNumber: string | null;
  documentType: DocumentType;
  fileName: string;
  fileSize: number | null;
  title: string;
  date: ISODate | null;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findDuplicate(incoming: IncomingFingerprint, existing: readonly ArchiveFingerprint[]): DuplicateMatch | null {
  const byChecksum = existing.find((e) => e.checksums.includes(incoming.checksum));
  if (byChecksum) return { kind: 'checksum', strength: 'exact', documentId: byChecksum.documentId };

  const byUrl = existing.find((e) => e.normalizedUrls.includes(incoming.normalizedUrl));
  if (byUrl) return { kind: 'url', strength: 'same_url', documentId: byUrl.documentId };

  if (incoming.documentNumber) {
    const byNumber = existing.find((e) => e.documentNumber === incoming.documentNumber && e.documentType === incoming.documentType);
    if (byNumber) return { kind: 'document_number', strength: 'probable', documentId: byNumber.documentId };
  }

  if (incoming.fileSize !== null && incoming.fileName) {
    const name = incoming.fileName.toLowerCase();
    const byFile = existing.find((e) => e.fileSize === incoming.fileSize && e.fileName.toLowerCase() === name);
    if (byFile) return { kind: 'filename_size', strength: 'probable', documentId: byFile.documentId };
  }

  const title = normalizeTitle(incoming.title);
  if (incoming.date && title.length >= 8) {
    const byTitle = existing.find((e) => e.date === incoming.date && normalizeTitle(e.title) === title);
    if (byTitle) return { kind: 'title_date', strength: 'probable', documentId: byTitle.documentId };
  }
  return null;
}
