/**
 * End-to-end: fictional PDFs served by a local HTTP server → ingest (download, hash, dedupe,
 * versioning, storage, pdf.js extraction, metadata, chunking) → FTS5 index → archive validation.
 * All content is fictional ("Exampleville", year 2099).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArchiveStore } from '../scripts/lib/archive';
import { NoopClassifier } from '../scripts/lib/classifier';
import { loadSeedsConfig } from '../scripts/lib/config';
import { sha256Hex } from '../scripts/lib/hash';
import { PoliteHttpClient } from '../scripts/lib/http';
import { buildJsonIndexData, buildSqliteIndex, loadSqlite, reciprocalRankFusion, searchJsonIndex, searchSqliteIndex, toFtsQuery } from '../scripts/lib/indexer';
import { candidatesFromInput, ingestAll, type IngestContext } from '../scripts/lib/ingest';
import { NoopOcrProvider } from '../scripts/lib/ocr';
import { buildRegistry } from '../scripts/lib/registry';
import { LocalFilesystemStorage } from '../scripts/lib/storage/LocalFilesystemStorage';
import { validateArchive } from '../scripts/lib/validate';

async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = pdf.addPage([612, 792]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 740 - i * 18, size: 11, font }));
  }
  pdf.setTitle('');
  return pdf.save();
}

const LOREM = 'The fictional council of Exampleville considered this measure at a regular public meeting.';

let server: Server;
let baseUrl = '';
const tmp = mkdtempSync(path.join(tmpdir(), 'vtp-pipeline-'));
const routes = new Map<string, { type: string; body: Uint8Array | string; length?: string }>();
let v1: Uint8Array;
let v2: Uint8Array;

beforeAll(async () => {
  v1 = await makePdf([
    ['ORDINANCE NO. 2099-01', 'AN ORDINANCE OF THE FICTIONAL TOWN OF EXAMPLEVILLE', 'ADOPTING SAMPLE SIGN STANDARDS', 'Adopted January 5, 2099', '', LOREM, LOREM],
    ['SECTION 2. EFFECTIVE DATE', 'This ordinance takes effect upon posting. It amends Ordinance 2098-12.', LOREM],
  ]);
  v2 = await makePdf([
    ['ORDINANCE NO. 2099-01', 'AN ORDINANCE OF THE FICTIONAL TOWN OF EXAMPLEVILLE', 'ADOPTING SAMPLE SIGN STANDARDS (CORRECTED)', 'Adopted January 5, 2099', '', LOREM],
    ['SECTION 2. EFFECTIVE DATE', 'This corrected ordinance takes effect upon posting.', LOREM],
  ]);
  const blank = await makePdf([[], []]);
  routes.set('/robots.txt', { type: 'text/plain', body: 'User-agent: *\nDisallow: /private/\n' });
  routes.set('/files/ordinance-2099-01.pdf', { type: 'application/pdf', body: v1 });
  routes.set('/mirror/ordinance-copy.pdf', { type: 'application/pdf', body: v1 });
  routes.set('/files/scan.pdf', { type: 'application/pdf', body: blank });
  routes.set('/files/viewer', { type: 'text/html', body: '<html><body>Viewer</body></html>' });
  routes.set('/files/fake.pdf', { type: 'application/pdf', body: 'not really a pdf' });
  routes.set('/files/huge.pdf', { type: 'application/pdf', body: '%PDF-1.4', length: '999999999' });
  routes.set('/private/secret.pdf', { type: 'application/pdf', body: v1 });
  routes.set('/files/notes.csv', { type: 'text/csv', body: 'item,amount\nSample line,10\n' });

  server = createServer((req, res) => {
    const route = routes.get(req.url ?? '');
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const headers: Record<string, string> = { 'content-type': route.type };
    if (route.length) headers['content-length'] = route.length;
    res.writeHead(200, headers);
    if (req.method === 'HEAD' || route.length) res.end();
    else res.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tmp, { recursive: true, force: true });
});

function context(): IngestContext {
  const config = loadSeedsConfig();
  const archive = new ArchiveStore(path.join(tmp, 'archive'));
  return {
    config,
    http: new PoliteHttpClient({
      userAgent: 'TestBot/1.0',
      robotsUserAgentToken: 'TestBot',
      timeoutMs: 10_000,
      maxRetries: 0,
      maxRedirects: 5,
      requestDelayMs: 0,
      maxCrawlDelayMs: 0,
      respectRobotsTxt: true,
    }),
    storage: new LocalFilesystemStorage(archive.layout.filesDir),
    archive,
    registry: buildRegistry(config, null),
    ocr: new NoopOcrProvider(),
    classifier: new NoopClassifier(),
    extraAllowedHosts: ['127.0.0.1'],
    maxBytes: 1_000_000,
    includeUnapprovedHosts: false,
    now: () => new Date('2099-02-01T12:00:00.000Z'),
    log: () => undefined,
  };
}

describe('ingest → index → validate (local fixture server)', () => {
  it('archives documents with provenance, metadata, OCR flags, and safe failures', async () => {
    const ctx = context();
    const candidates = candidatesFromInput([
      { url: `${baseUrl}/files/ordinance-2099-01.pdf`, title: 'Ordinance No. 2099-01 (Sign Standards)' },
      { url: `${baseUrl}/files/scan.pdf`, title: 'Scanned document' },
      { url: `${baseUrl}/files/viewer`, title: 'Viewer page' },
      { url: `${baseUrl}/files/fake.pdf`, title: 'Fake' },
      { url: `${baseUrl}/files/huge.pdf`, title: 'Huge' },
      { url: `${baseUrl}/private/secret.pdf`, title: 'Disallowed by robots' },
      { url: `${baseUrl}/files/notes.csv`, title: 'Sample CSV' },
      { url: 'https://www.facebook.com/some/file.pdf', title: 'Denied' },
      { url: 'https://unapproved.example.com/a.pdf', title: 'Unapproved host' },
    ]);
    const outcomes = await ingestAll(candidates, ctx);
    const status = Object.fromEntries(outcomes.map((o) => [o.url.replace(baseUrl, ''), o.status]));
    expect(status).toEqual({
      '/files/ordinance-2099-01.pdf': 'created',
      '/files/scan.pdf': 'created',
      '/files/viewer': 'skipped',
      '/files/fake.pdf': 'failed',
      '/files/huge.pdf': 'failed',
      '/private/secret.pdf': 'failed',
      '/files/notes.csv': 'created',
      'https://www.facebook.com/some/file.pdf': 'skipped',
      'https://unapproved.example.com/a.pdf': 'skipped',
    });
    expect(outcomes.find((o) => o.url.endsWith('huge.pdf'))?.message).toContain('too_large');
    expect(outcomes.find((o) => o.url.includes('/private/'))?.message).toContain('robots_disallowed');

    const ord = ctx.archive.readRecord(outcomes[0].documentId as string);
    expect(ord).not.toBeNull();
    const d = ord!.document;
    expect(d).toMatchObject({
      documentType: 'ordinance',
      documentNumber: 'Ordinance 2099-01',
      date: '2099-01-05',
      year: 2099,
      pageCount: 2,
      mimeType: 'application/pdf',
      fileName: 'ordinance-2099-01.pdf',
      checksum: sha256Hex(v1),
      extractedTextAvailable: true,
      ocrRequired: false,
      currency: 'unknown',
      currentVersion: 1,
      categories: ['ordinances'],
    });
    expect(ord!.pages[0].text).toContain('ORDINANCE NO. 2099-01');
    expect(ord!.chunks.length).toBeGreaterThan(0);
    expect(ord!.chunks.every((c) => c.documentId === d.id)).toBe(true);
    // A two-page toy PDF fits in one chunk spanning both pages; headings are preserved in the text.
    expect(ord!.chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 2, sectionTitle: 'ORDINANCE NO. 2099-01' });
    expect(ord!.chunks[0].text).toContain('SECTION 2. EFFECTIVE DATE');
    expect(ord!.referencedDocumentNumbers).toContain('Ordinance 2098-12');
    expect(ord!.sources).toHaveLength(1);
    expect(ord!.sources[0]).toMatchObject({ originalUrl: `${baseUrl}/files/ordinance-2099-01.pdf`, retrievedAt: '2099-02-01T12:00:00.000Z', httpStatusAtLastCheck: 200 });

    const scan = ctx.archive.readRecord(outcomes[1].documentId as string);
    expect(scan!.document).toMatchObject({ ocrRequired: true, ocrStatus: 'pending', extractedTextAvailable: false });
    expect(scan!.chunks).toEqual([]);
  });

  it('keeps every version when the source changes, and merges identical content from other URLs', async () => {
    const ctx = context();
    routes.set('/files/ordinance-2099-01.pdf', { type: 'application/pdf', body: v2 });
    const [changed] = await ingestAll(candidatesFromInput([{ url: `${baseUrl}/files/ordinance-2099-01.pdf` }]), ctx);
    expect(changed.status).toBe('new_version');
    const record = ctx.archive.readRecord(changed.documentId as string)!;
    expect(record.versions.map((v) => [v.versionNumber, v.changeStatus])).toEqual([
      [1, 'original'],
      [2, 'replaced'],
    ]);
    expect(record.document.currentVersion).toBe(2);
    expect(record.document.checksum).toBe(sha256Hex(v2));
    // The original bytes are still archived and intact.
    const oldBytes = await ctx.storage.get(record.versions[0].storageKey);
    expect(oldBytes && sha256Hex(oldBytes)).toBe(sha256Hex(v1));

    const [again] = await ingestAll(candidatesFromInput([{ url: `${baseUrl}/files/ordinance-2099-01.pdf` }]), ctx);
    expect(again.status).toBe('unchanged');

    const [mirror] = await ingestAll(candidatesFromInput([{ url: `${baseUrl}/mirror/ordinance-copy.pdf` }]), ctx);
    expect(mirror).toMatchObject({ status: 'source_added', documentId: record.document.id });
    expect(ctx.archive.readRecord(record.document.id)!.sources.map((s) => s.originalUrl)).toEqual([
      `${baseUrl}/files/ordinance-2099-01.pdf`,
      `${baseUrl}/mirror/ordinance-copy.pdf`,
    ]);
    expect(ctx.archive.listRecordIds()).toHaveLength(3);
  });

  it('builds a searchable FTS5 index and a JSON fallback index', async () => {
    const ctx = context();
    const sqlite = loadSqlite();
    expect(sqlite).not.toBeNull();
    const dbFile = path.join(tmp, 'index.sqlite');
    const stats = buildSqliteIndex(sqlite!, ctx.archive.records(), ctx.config.sources, dbFile);
    expect(stats).toMatchObject({ engine: 'sqlite-fts5', documents: 3, canonicalDocuments: 3 });
    const hits = searchSqliteIndex(sqlite!, dbFile, 'corrected ordinance', { limit: 5 });
    expect(hits[0]?.snippet).toMatch(/\[corrected\]/i);
    expect(searchSqliteIndex(sqlite!, dbFile, 'effective dates', { mode: 'phrase' }).length).toBeGreaterThan(0); // porter stemming
    // User input containing FTS5 syntax is neutralised.
    expect(() => searchSqliteIndex(sqlite!, dbFile, 'NEAR(" OR title: *')).not.toThrow();
    expect(toFtsQuery('sign standards', 'any')).toBe('"sign" OR "standards"');
    expect(toFtsQuery('   ')).toBeNull();

    const json = buildJsonIndexData(ctx.archive.records());
    expect(searchJsonIndex(json, 'corrected ordinance')[0]?.documentId).toBe(hits[0].documentId);
    expect(reciprocalRankFusion([['a', 'b', 'c'], ['b', 'a'], ['b']]).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('validates the archive and detects tampering', async () => {
    const ctx = context();
    const clean = await validateArchive(ctx.archive, ctx.storage);
    expect(clean.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(clean.records).toBe(3);

    const victim = [...ctx.archive.records()][0];
    writeFileSync(ctx.storage.describe(victim.versions[0].storageKey), 'tampered');
    const tampered = await validateArchive(ctx.archive, ctx.storage);
    expect(tampered.issues.some((i) => i.level === 'error' && (i.code === 'checksum_mismatch' || i.code === 'size_mismatch'))).toBe(true);
  });
});
