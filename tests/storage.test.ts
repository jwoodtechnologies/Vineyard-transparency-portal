import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { contentKey, fileNameFromContentDisposition, isSafeKey, sanitizeFileName } from '../scripts/lib/storage/keys';
import { LocalFilesystemStorage } from '../scripts/lib/storage/LocalFilesystemStorage';
import { sha256Hex } from '../scripts/lib/hash';

const dir = mkdtempSync(path.join(tmpdir(), 'vtp-storage-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('file name sanitization', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32.dll', 'system32.dll'],
    ['Agenda Packet (Final) 1-5-2026.PDF', 'Agenda_Packet_Final_1-5-2026.pdf'],
    ['.hidden', 'hidden'],
    ['résumé.pdf', 'resume.pdf'],
    ['a\u0000b<>:"|?*.pdf', 'ab.pdf'],
    ['', 'document'],
    ['....pdf', 'document.pdf'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('limits length but keeps the extension', () => {
    const name = sanitizeFileName(`${'x'.repeat(500)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('parses Content-Disposition file names', () => {
    expect(fileNameFromContentDisposition('attachment; filename="Budget FY26.pdf"')).toBe('Budget FY26.pdf');
    expect(fileNameFromContentDisposition("inline; filename*=UTF-8''Caf%C3%A9%20plan.pdf")).toBe('Café plan.pdf');
    expect(fileNameFromContentDisposition(null)).toBeNull();
  });
});

describe('storage keys and LocalFilesystemStorage', () => {
  it('builds content-addressed keys', () => {
    const sha = sha256Hex('x');
    expect(contentKey(sha, '../evil name.pdf')).toBe(`documents/${sha.slice(0, 2)}/${sha}/evil_name.pdf`);
    expect(() => contentKey('not-a-hash', 'a.pdf')).toThrow();
  });

  it('rejects unsafe keys', () => {
    for (const key of ['../x', 'a/../../b', '/abs', 'a//b', 'a\\b', 'a/./b', '', 'a/b\u0000']) expect(isSafeKey(key)).toBe(false);
    expect(isSafeKey('documents/ab/abc/file.pdf')).toBe(true);
  });

  it('stores, reads, lists, and refuses traversal or silent overwrite', async () => {
    const storage = new LocalFilesystemStorage(dir);
    const data = new TextEncoder().encode('hello');
    const stored = await storage.put('documents/aa/file.txt', data, { contentType: 'text/plain' });
    expect(stored.size).toBe(5);
    expect(new TextDecoder().decode((await storage.get('documents/aa/file.txt')) ?? new Uint8Array())).toBe('hello');
    expect(await storage.put('documents/aa/file.txt', data, { contentType: 'text/plain' })).toMatchObject({ size: 5 });
    await expect(storage.put('documents/aa/file.txt', new TextEncoder().encode('changed!'), { contentType: 'text/plain' })).rejects.toThrow(/Refusing to overwrite/);
    await expect(storage.put('../outside.txt', data, { contentType: 'text/plain' })).rejects.toThrow(/Unsafe storage key/);
    expect(await storage.list('documents')).toEqual(['documents/aa/file.txt']);
    expect(await storage.stat('documents/missing')).toBeNull();
  });
});
