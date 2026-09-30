import { describe, expect, it } from 'vitest';
import { findDuplicate, normalizeTitle, type IncomingFingerprint } from '../scripts/lib/dedupe';
import type { ArchiveFingerprint } from '../scripts/lib/types';

const existing: ArchiveFingerprint[] = [
  {
    documentId: 'doc_aaaaaaaaaaaaaaaa',
    checksums: ['1'.repeat(64), '2'.repeat(64)],
    normalizedUrls: ['https://www.example.org/files/ordinance-2026-07.pdf'],
    documentNumber: 'Ordinance 2026-07',
    documentType: 'ordinance',
    fileName: 'ordinance-2026-07.pdf',
    fileSize: 1000,
    title: 'Ordinance 2026-07: Fictional Sign Standards',
    date: '2026-01-05',
  },
  {
    documentId: 'doc_bbbbbbbbbbbbbbbb',
    checksums: ['3'.repeat(64)],
    normalizedUrls: ['https://www.example.org/files/agenda.pdf'],
    documentNumber: null,
    documentType: 'agenda',
    fileName: 'agenda.pdf',
    fileSize: 5000,
    title: 'Regular Meeting Agenda',
    date: '2026-02-02',
  },
];

function incoming(over: Partial<IncomingFingerprint>): IncomingFingerprint {
  return {
    checksum: 'f'.repeat(64),
    normalizedUrl: 'https://mirror.example.net/new.pdf',
    documentNumber: null,
    documentType: 'other',
    fileName: 'new.pdf',
    fileSize: 1,
    title: 'Something else entirely',
    date: null,
    ...over,
  };
}

describe('findDuplicate', () => {
  it('matches identical bytes first (exact duplicate → add source reference)', () => {
    expect(findDuplicate(incoming({ checksum: '2'.repeat(64) }), existing)).toEqual({ kind: 'checksum', strength: 'exact', documentId: 'doc_aaaaaaaaaaaaaaaa' });
  });

  it('matches the same normalized URL with different bytes (→ new version)', () => {
    expect(findDuplicate(incoming({ normalizedUrl: 'https://www.example.org/files/agenda.pdf' }), existing)).toEqual({ kind: 'url', strength: 'same_url', documentId: 'doc_bbbbbbbbbbbbbbbb' });
  });

  it('flags probable duplicates by document number + type', () => {
    expect(findDuplicate(incoming({ documentNumber: 'Ordinance 2026-07', documentType: 'ordinance' }), existing)).toMatchObject({ kind: 'document_number', strength: 'probable' });
    // Same number but different type is not a duplicate (e.g. an agenda that mentions the ordinance).
    expect(findDuplicate(incoming({ documentNumber: 'Ordinance 2026-07', documentType: 'agenda' }), existing)).toBeNull();
  });

  it('flags probable duplicates by file name + size', () => {
    expect(findDuplicate(incoming({ fileName: 'Agenda.pdf', fileSize: 5000 }), existing)).toMatchObject({ kind: 'filename_size', documentId: 'doc_bbbbbbbbbbbbbbbb' });
    expect(findDuplicate(incoming({ fileName: 'agenda.pdf', fileSize: 5001 }), existing)).toBeNull();
  });

  it('flags probable duplicates by normalized title + date', () => {
    expect(findDuplicate(incoming({ title: 'regular meeting  AGENDA!', date: '2026-02-02' }), existing)).toMatchObject({ kind: 'title_date', documentId: 'doc_bbbbbbbbbbbbbbbb' });
    expect(findDuplicate(incoming({ title: 'Regular Meeting Agenda', date: '2026-02-03' }), existing)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(findDuplicate(incoming({}), existing)).toBeNull();
  });

  it('normalizes titles', () => {
    expect(normalizeTitle('  Résumé — Café  Plan! ')).toBe('resume cafe plan');
  });
});
