/**
 * Full-text index builder.
 *
 * Primary: SQLite FTS5 via the built-in node:sqlite module (verified working on Node 22.22 with
 * FTS5 and the porter/unicode61 tokenizers). Output: data/index.sqlite, built into a temp file
 * and atomically renamed so readers never see a half-built index.
 *
 * Fallback (when node:sqlite is unavailable, e.g. older Node): a compact JSON inverted index
 * (data/index.json) — adequate for small archives and tests, not for 20k+ documents.
 *
 * The semantic index is separate and optional (scripts/lib/embeddings.ts).
 */
import { createRequire } from 'node:module';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { writeJsonAtomic } from './cli';
import type { ArchiveRecord, SourceSeed } from './types';

type SqliteModule = typeof import('node:sqlite');
type Database = InstanceType<SqliteModule['DatabaseSync']>;

const require = createRequire(import.meta.url);

/** Load node:sqlite if available (silencing its one-time ExperimentalWarning). */
export function loadSqlite(): SqliteModule | null {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (/SQLite is an experimental feature/i.test(text)) return;
    (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    const mod = require('node:sqlite') as SqliteModule;
    const probe = new mod.DatabaseSync(':memory:');
    probe.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='porter unicode61')");
    probe.close();
    return mod;
  } catch {
    return null;
  } finally {
    process.emitWarning = original;
  }
}

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sources (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT, source_type TEXT, authority TEXT, json TEXT NOT NULL
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, slug TEXT, title TEXT NOT NULL, document_type TEXT NOT NULL, document_number TEXT,
  date TEXT, year INTEGER, government_body_id TEXT, meeting_id TEXT, source_id TEXT, currency TEXT,
  duplicate_of TEXT, is_canonical INTEGER NOT NULL, page_count INTEGER, ocr_required INTEGER NOT NULL,
  current_version INTEGER NOT NULL, json TEXT NOT NULL
);
CREATE INDEX documents_date ON documents(date);
CREATE INDEX documents_type ON documents(document_type);
CREATE INDEX documents_source ON documents(source_id);
CREATE INDEX documents_number ON documents(document_number);
CREATE TABLE document_sources (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), source_id TEXT NOT NULL,
  original_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE TABLE versions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), version_number INTEGER NOT NULL,
  checksum TEXT NOT NULL, change_status TEXT NOT NULL, retrieved_at TEXT NOT NULL, json TEXT NOT NULL
);
CREATE TABLE pages (
  document_id TEXT NOT NULL REFERENCES documents(id), page INTEGER NOT NULL, text TEXT NOT NULL, ocr INTEGER NOT NULL,
  PRIMARY KEY (document_id, page)
);
CREATE TABLE chunks (
  rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, document_id TEXT NOT NULL REFERENCES documents(id),
  page_start INTEGER NOT NULL, page_end INTEGER NOT NULL, section_title TEXT, text TEXT NOT NULL,
  token_estimate INTEGER NOT NULL, embedding_reference TEXT
);
CREATE INDEX chunks_document ON chunks(document_id);
CREATE TABLE relationships (
  id TEXT PRIMARY KEY, from_document_id TEXT NOT NULL REFERENCES documents(id), relationship_type TEXT NOT NULL,
  to_kind TEXT NOT NULL, to_id TEXT NOT NULL, to_title TEXT, basis TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX relationships_from ON relationships(from_document_id);
CREATE INDEX relationships_to ON relationships(to_id);
-- Chunk-level full text. rowid = chunks.rowid.
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, section_title, title, document_number,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
-- Document-level fields (titles/numbers), so records without extracted text are still findable
-- and title-only search (title=1) is cheap.
CREATE VIRTUAL TABLE documents_fts USING fts5(
  document_id UNINDEXED, title, document_number, description,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
`;

export interface IndexBuildStats {
  engine: 'sqlite-fts5' | 'json-inverted-index';
  output: string;
  documents: number;
  canonicalDocuments: number;
  chunks: number;
  pages: number;
  relationships: number;
  sources: number;
}

export function buildSqliteIndex(sqlite: SqliteModule, records: Iterable<ArchiveRecord>, sources: SourceSeed[], outFile: string): IndexBuildStats {
  const tmp = `${outFile}.building-${process.pid}`;
  rmSync(tmp, { force: true });
  const db: Database = new sqlite.DatabaseSync(tmp);
  const stats: IndexBuildStats = { engine: 'sqlite-fts5', output: outFile, documents: 0, canonicalDocuments: 0, chunks: 0, pages: 0, relationships: 0, sources: 0 };
  try {
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
    db.exec(SCHEMA_SQL);
    db.exec('BEGIN');
    const insSource = db.prepare('INSERT OR REPLACE INTO sources (id, name, base_url, source_type, authority, json) VALUES (?, ?, ?, ?, ?, ?)');
    for (const s of sources) {
      insSource.run(s.id, s.name, s.baseUrl, s.sourceType, s.authority, JSON.stringify(s));
      stats.sources += 1;
    }
    const insDoc = db.prepare(
      `INSERT INTO documents (id, slug, title, document_type, document_number, date, year, government_body_id, meeting_id,
        source_id, currency, duplicate_of, is_canonical, page_count, ocr_required, current_version, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insDocFts = db.prepare('INSERT INTO documents_fts (document_id, title, document_number, description) VALUES (?, ?, ?, ?)');
    const insDocSource = db.prepare('INSERT OR REPLACE INTO document_sources (id, document_id, source_id, original_url, retrieved_at, json) VALUES (?, ?, ?, ?, ?, ?)');
    const insVersion = db.prepare('INSERT INTO versions (id, document_id, version_number, checksum, change_status, retrieved_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insPage = db.prepare('INSERT INTO pages (document_id, page, text, ocr) VALUES (?, ?, ?, ?)');
    const insChunk = db.prepare(
      'INSERT INTO chunks (id, document_id, page_start, page_end, section_title, text, token_estimate, embedding_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insChunkFts = db.prepare('INSERT INTO chunks_fts (rowid, text, section_title, title, document_number) VALUES (?, ?, ?, ?, ?)');
    const insRel = db.prepare('INSERT OR REPLACE INTO relationships (id, from_document_id, relationship_type, to_kind, to_id, to_title, basis, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

    for (const r of records) {
      const d = r.document;
      insDoc.run(
        d.id, d.slug, d.title, d.documentType, d.documentNumber, d.date, d.year, d.governmentBodyId, d.meetingId, d.sourceId,
        d.currency, r.duplicateOf, r.duplicateOf ? 0 : 1, d.pageCount, d.ocrRequired ? 1 : 0, d.currentVersion, JSON.stringify(d),
      );
      insDocFts.run(d.id, d.title, d.documentNumber ?? '', d.description ?? '');
      stats.documents += 1;
      if (!r.duplicateOf) stats.canonicalDocuments += 1;
      for (const s of r.sources) insDocSource.run(s.id, d.id, s.sourceId, s.originalUrl, s.retrievedAt, JSON.stringify(s));
      for (const v of r.versions) insVersion.run(v.id, d.id, v.versionNumber, v.checksum, v.changeStatus, v.retrievedAt, JSON.stringify(v));
      for (const p of r.pages) {
        insPage.run(d.id, p.page, p.text, p.ocr ? 1 : 0);
        stats.pages += 1;
      }
      for (const c of r.chunks) {
        const info = insChunk.run(c.id, d.id, c.pageStart, c.pageEnd, c.sectionTitle, c.text, c.tokenEstimate, c.embeddingReference);
        insChunkFts.run(Number(info.lastInsertRowid), c.text, c.sectionTitle ?? '', d.title, d.documentNumber ?? '');
        stats.chunks += 1;
      }
      for (const rel of r.relationships) {
        insRel.run(rel.id, rel.fromDocumentId, rel.relationshipType, rel.toKind, rel.toId, rel.toTitle, rel.basis, JSON.stringify(rel));
        stats.relationships += 1;
      }
    }
    const insMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    insMeta.run('schemaVersion', String(SCHEMA_VERSION));
    insMeta.run('builtAt', new Date().toISOString());
    insMeta.run('documentCount', String(stats.documents));
    insMeta.run('chunkCount', String(stats.chunks));
    insMeta.run('semanticIndex', 'none');
    db.exec('COMMIT');
    db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES ('optimize'); INSERT INTO documents_fts(documents_fts) VALUES ('optimize');");
  } catch (error) {
    db.close();
    rmSync(tmp, { force: true });
    throw error;
  }
  db.close();
  renameSync(tmp, outFile);
  return stats;
}

/**
 * Convert user input into a safe FTS5 MATCH expression. Every token is double-quoted, so FTS5
 * operators/column filters typed by users are treated as plain words.
 */
export function toFtsQuery(input: string, mode: 'all' | 'any' | 'phrase' = 'all'): string | null {
  const tokens = input.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!tokens.length) return null;
  if (mode === 'phrase') return `"${tokens.join(' ')}"`;
  return tokens.map((t) => `"${t}"`).join(mode === 'any' ? ' OR ' : ' ');
}

export interface ChunkHit {
  chunkId: string;
  documentId: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  snippet: string;
  score: number;
}

/** Smoke-test / reference query: BM25-ranked chunk hits over canonical documents. */
export function searchSqliteIndex(sqlite: SqliteModule, dbFile: string, query: string, options: { mode?: 'all' | 'any' | 'phrase'; limit?: number } = {}): ChunkHit[] {
  const match = toFtsQuery(query, options.mode);
  if (!match || !existsSync(dbFile)) return [];
  const db = new sqlite.DatabaseSync(dbFile, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT c.id AS chunkId, c.document_id AS documentId, d.title AS title, c.page_start AS pageStart, c.page_end AS pageEnd,
                snippet(chunks_fts, 0, '[', ']', ' … ', 16) AS snippet, bm25(chunks_fts, 1.0, 2.0, 4.0, 8.0) AS score
           FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid JOIN documents d ON d.id = c.document_id
          WHERE chunks_fts MATCH ? AND d.is_canonical = 1
          ORDER BY score LIMIT ?`,
      )
      .all(match, options.limit ?? 10) as unknown as ChunkHit[];
    return rows;
  } finally {
    db.close();
  }
}

/* ------------------------------ JSON fallback ------------------------------ */

export interface JsonIndex {
  engine: 'json-inverted-index';
  builtAt: string;
  chunks: Array<{ id: string; documentId: string; title: string; pageStart: number; pageEnd: number }>;
  /** term → [[chunkIndex, termFrequency], ...] */
  postings: Record<string, Array<[number, number]>>;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1);
}

export function buildJsonIndexData(records: Iterable<ArchiveRecord>): JsonIndex {
  const index: JsonIndex = { engine: 'json-inverted-index', builtAt: new Date().toISOString(), chunks: [], postings: {} };
  for (const r of records) {
    if (r.duplicateOf) continue;
    for (const c of r.chunks) {
      const i = index.chunks.length;
      index.chunks.push({ id: c.id, documentId: r.document.id, title: r.document.title, pageStart: c.pageStart, pageEnd: c.pageEnd });
      const tf = new Map<string, number>();
      for (const t of tokenize(`${r.document.title} ${c.sectionTitle ?? ''} ${c.text}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, n] of tf) (index.postings[t] ??= []).push([i, n]);
    }
  }
  return index;
}

export function buildJsonIndex(records: Iterable<ArchiveRecord>, outFile: string): IndexBuildStats {
  const data = buildJsonIndexData(records);
  writeJsonAtomic(outFile, data);
  return {
    engine: 'json-inverted-index',
    output: outFile,
    documents: new Set(data.chunks.map((c) => c.documentId)).size,
    canonicalDocuments: new Set(data.chunks.map((c) => c.documentId)).size,
    chunks: data.chunks.length,
    pages: 0,
    relationships: 0,
    sources: 0,
  };
}

/** TF-IDF search over the JSON fallback index (all terms required). */
export function searchJsonIndex(index: JsonIndex, query: string, limit = 10): Array<{ chunkId: string; documentId: string; score: number }> {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const n = index.chunks.length;
  const scores = new Map<number, { score: number; hits: number }>();
  for (const t of terms) {
    const postings = index.postings[t] ?? [];
    const idf = Math.log(1 + n / (1 + postings.length));
    for (const [i, tf] of postings) {
      const s = scores.get(i) ?? { score: 0, hits: 0 };
      s.score += (1 + Math.log(tf)) * idf;
      s.hits += 1;
      scores.set(i, s);
    }
  }
  return [...scores.entries()]
    .filter(([, s]) => s.hits === terms.length)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([i, s]) => ({ chunkId: index.chunks[i].id, documentId: index.chunks[i].documentId, score: s.score }));
}

/**
 * Reciprocal rank fusion for hybrid retrieval (full-text + semantic + metadata lists).
 * score(d) = Σ 1 / (k + rank_i(d)), k = 60 by convention.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
