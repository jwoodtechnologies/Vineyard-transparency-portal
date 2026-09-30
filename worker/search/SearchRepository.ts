/**
 * SearchRepository: full-text retrieval over one or more D1 search shards (FTS5).
 *
 * Sharding: a document's shard is chosen once, when it is first indexed, as
 *   writeShards[fnv1a(documentId) % writeShards.length]
 * and recorded in catalog.documents.search_shard. Reads never recompute it, so adding a shard
 * later (append it to SEARCH_SHARDS and SEARCH_WRITE_SHARDS, or retire a full shard from
 * SEARCH_WRITE_SHARDS) never moves existing documents. Queries fan out to every active shard in
 * parallel; bm25 scores from separate shards are comparable enough for merging because every
 * shard uses the same tokenizer, column weights and similar corpus statistics.
 */
import type { Env } from '../env';
import type { ChunkHit, ChunkInput, ShardDocumentInput, ShardFilters } from './types';
import { fnv1a, parseSnippet } from './query';
export type { ChunkHit, ChunkInput, ShardDocumentInput, ShardFilters } from './types';
import { typesForCategories } from '../lib/taxonomy';

/** bm25 column weights: doc_title, section_title, text. */
const BM25 = 'bm25(chunks_fts, 10.0, 4.0, 1.0)';

function parseShardList(value: string | undefined, fallback: number[]): number[] {
  if (!value) return fallback;
  const out = value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 8);
  return out.length ? [...new Set(out)] : fallback;
}

export class SearchRepository {
  private readonly shards: Map<number, D1Database>;
  private readonly writeShards: number[];

  constructor(env: Env) {
    this.shards = new Map();
    const bindings: Array<D1Database | undefined> = [env.SEARCH_DB_0, env.SEARCH_DB_1, env.SEARCH_DB_2, env.SEARCH_DB_3, env.SEARCH_DB_4, env.SEARCH_DB_5, env.SEARCH_DB_6, env.SEARCH_DB_7];
    for (const n of parseShardList(env.SEARCH_SHARDS, [0])) {
      const db = bindings[n];
      if (db) this.shards.set(n, db);
    }
    this.writeShards = parseShardList(env.SEARCH_WRITE_SHARDS, [...this.shards.keys()]).filter((n) => this.shards.has(n));
  }

  get activeShards(): number[] {
    return [...this.shards.keys()];
  }

  get available(): boolean {
    return this.shards.size > 0;
  }

  shard(n: number): D1Database {
    const db = this.shards.get(n);
    if (!db) throw new Error(`Search shard ${n} is not bound or not active.`);
    return db;
  }

  /** Deterministic shard for a document that has not been indexed yet. */
  assignShard(documentId: string): number {
    if (!this.writeShards.length) throw new Error('No writable search shard is configured.');
    return this.writeShards[fnv1a(documentId) % this.writeShards.length];
  }

  private filterSql(f: ShardFilters): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const types = [...(f.documentTypes ?? []), ...(f.categories?.length ? typesForCategories(f.categories) : [])];
    if (types.length) {
      clauses.push('d.document_type IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(types));
    }
    if (f.years?.length) {
      clauses.push('d.year IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(f.years));
    }
    if (f.dateFrom) {
      clauses.push('d.document_date >= ?');
      params.push(f.dateFrom);
    }
    if (f.dateTo) {
      clauses.push('d.document_date <= ?');
      params.push(f.dateTo);
    }
    if (f.governmentBodyIds?.length) {
      clauses.push('d.government_body_id IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(f.governmentBodyIds));
    }
    if (f.sourceIds?.length) {
      clauses.push('d.source_id IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(f.sourceIds));
    }
    if (f.meetingId) {
      clauses.push('d.meeting_id = ?');
      params.push(f.meetingId);
    }
    if (f.currency?.length) {
      clauses.push('d.currency IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify(f.currency));
    }
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
  }

  /** Top chunks for an FTS expression across all active shards, merged best-first. */
  async searchChunks(fts: string, filters: ShardFilters, limit: number, withText = false, withSnippet = true): Promise<ChunkHit[]> {
    const { sql: where, params } = this.filterSql(filters);
    const sql =
      `SELECT c.id AS chunk_id, c.document_id, c.page_start, c.page_end, c.section_title, ${BM25} AS rank, ` +
      `${withSnippet ? "snippet(chunks_fts, 2, char(2), char(3), '…', 40)" : "''"} AS snip, ${withText ? 'c.text,' : ''} ` +
      `d.title, d.document_type, d.document_number, d.document_date, d.year, d.government_body_id, d.source_id, d.categories_json ` +
      `FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid JOIN shard_documents d ON d.document_id = c.document_id ` +
      `WHERE chunks_fts MATCH ?${where} ORDER BY rank LIMIT ?`;
    const perShard = await Promise.all(
      [...this.shards.entries()].map(async ([n, db]) => {
        const res = await db.prepare(sql).bind(fts, ...params, limit).all<Record<string, unknown>>();
        return (res.results ?? []).map((r): ChunkHit => {
          const snip = parseSnippet(String(r.snip ?? ''));
          return {
            shard: n,
            chunkId: String(r.chunk_id),
            documentId: String(r.document_id),
            pageStart: r.page_start == null ? null : Number(r.page_start),
            pageEnd: r.page_end == null ? null : Number(r.page_end),
            sectionTitle: r.section_title == null ? null : String(r.section_title),
            score: -Number(r.rank),
            excerpt: snip.text,
            highlights: snip.highlights,
            ...(withText ? { text: String(r.text ?? '') } : {}),
            title: String(r.title),
            documentType: String(r.document_type),
            documentNumber: r.document_number == null ? null : String(r.document_number),
            documentDate: r.document_date == null ? null : String(r.document_date),
            year: r.year == null ? null : Number(r.year),
            governmentBodyId: r.government_body_id == null ? null : String(r.government_body_id),
            sourceId: String(r.source_id),
            categoriesJson: String(r.categories_json ?? '[]'),
          };
        });
      }),
    );
    return perShard.flat().sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Snippets for specific chunks only. Building a snippet reads the chunk text, so the candidate
   * query skips them and only the chunks shown on the current page get one.
   */
  async snippets(fts: string, refs: Array<{ shard: number; chunkId: string }>): Promise<Map<string, { text: string; highlights: Array<[number, number]> }>> {
    const byShard = new Map<number, string[]>();
    for (const r of refs) byShard.set(r.shard, [...(byShard.get(r.shard) ?? []), r.chunkId]);
    const out = new Map<string, { text: string; highlights: Array<[number, number]> }>();
    const sql =
      `SELECT c.id AS chunk_id, snippet(chunks_fts, 2, char(2), char(3), '…', 40) AS snip FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid ` +
      `WHERE chunks_fts MATCH ? AND chunks_fts.rowid IN (SELECT rowid FROM chunks WHERE id IN (SELECT value FROM json_each(?)))`;
    await Promise.all(
      [...byShard.entries()].map(async ([n, ids]) => {
        const db = this.shards.get(n);
        if (!db) return;
        const res = await db.prepare(sql).bind(fts, JSON.stringify(ids)).all<{ chunk_id: string; snip: string }>();
        for (const r of res.results ?? []) out.set(String(r.chunk_id), parseSnippet(String(r.snip ?? '')));
      }),
    );
    return out;
  }

  /** Exact number of distinct documents matching (documents live in exactly one shard). */
  async countDocuments(fts: string, filters: ShardFilters): Promise<number> {
    const { sql: where, params } = this.filterSql(filters);
    const sql =
      `SELECT count(DISTINCT c.document_id) AS n FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid ` +
      `JOIN shard_documents d ON d.document_id = c.document_id WHERE chunks_fts MATCH ?${where}`;
    const counts = await Promise.all([...this.shards.values()].map((db) => db.prepare(sql).bind(fts, ...params).first<{ n: number }>()));
    return counts.reduce((sum, r) => sum + Number(r?.n ?? 0), 0);
  }

  async documentChunks(shard: number, documentId: string): Promise<Array<{ id: string; pageStart: number | null; pageEnd: number | null; sectionTitle: string | null; text: string; ocr: boolean }>> {
    const res = await this.shard(shard)
      .prepare('SELECT id, page_start, page_end, section_title, text, ocr FROM chunks WHERE document_id = ? ORDER BY page_start, rowid')
      .bind(documentId)
      .all<Record<string, unknown>>();
    return (res.results ?? []).map((r) => ({
      id: String(r.id),
      pageStart: r.page_start == null ? null : Number(r.page_start),
      pageEnd: r.page_end == null ? null : Number(r.page_end),
      sectionTitle: r.section_title == null ? null : String(r.section_title),
      text: String(r.text),
      ocr: Number(r.ocr) === 1,
    }));
  }

  /** Chunks by id (used to resolve citation evidence). */
  async chunksById(ids: Array<{ shard: number; id: string }>): Promise<Map<string, string>> {
    const byShard = new Map<number, string[]>();
    for (const x of ids) byShard.set(x.shard, [...(byShard.get(x.shard) ?? []), x.id]);
    const out = new Map<string, string>();
    await Promise.all(
      [...byShard.entries()].map(async ([n, list]) => {
        const res = await this.shard(n).prepare('SELECT id, text FROM chunks WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(list)).all<{ id: string; text: string }>();
        for (const r of res.results ?? []) out.set(r.id, r.text);
      }),
    );
    return out;
  }

  /**
   * Replaces a document's chunks in its shard inside one D1 batch (one transaction), so the FTS5
   * index is written as a single segment. Returns D1's own rows_written accounting.
   */
  async replaceDocument(shard: number, doc: ShardDocumentInput, chunks: ChunkInput[], append = false): Promise<number> {
    const db = this.shard(shard);
    const now = new Date().toISOString();
    const payload = JSON.stringify(
      chunks.map((c) => ({
        id: c.id,
        p0: c.pageStart,
        p1: c.pageEnd,
        s: c.sectionTitle,
        t: c.text,
        n: c.text.length,
        o: c.ocr ? 1 : 0,
      })),
    );
    const statements: D1PreparedStatement[] = [];
    if (!append) {
      statements.push(
        db
          .prepare("INSERT INTO chunks_fts(chunks_fts, rowid, doc_title, section_title, text) SELECT 'delete', rowid, doc_title, section_title, text FROM chunks WHERE document_id = ?")
          .bind(doc.documentId),
        db.prepare('DELETE FROM chunks WHERE document_id = ?').bind(doc.documentId),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO shard_documents (document_id, title, document_type, document_number, document_date, year, government_body_id, source_id, meeting_id, categories_json, currency, chunk_count, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(document_id) DO UPDATE SET title = excluded.title, document_type = excluded.document_type, document_number = excluded.document_number,
             document_date = excluded.document_date, year = excluded.year, government_body_id = excluded.government_body_id, source_id = excluded.source_id,
             meeting_id = excluded.meeting_id, categories_json = excluded.categories_json, currency = excluded.currency, indexed_at = excluded.indexed_at`,
        )
        .bind(doc.documentId, doc.title, doc.documentType, doc.documentNumber, doc.documentDate, doc.year, doc.governmentBodyId, doc.sourceId, doc.meetingId, JSON.stringify(doc.categories), doc.currency, now),
      db
        .prepare(
          `INSERT INTO chunks (id, document_id, doc_title, page_start, page_end, section_title, text, character_count, ocr, created_at)
           SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.p0'), json_extract(value, '$.p1'), json_extract(value, '$.s'),
                  json_extract(value, '$.t'), json_extract(value, '$.n'), json_extract(value, '$.o'), ?
           FROM json_each(?) WHERE true
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(doc.documentId, doc.title, now, payload),
      db
        .prepare(
          `INSERT INTO chunks_fts(rowid, doc_title, section_title, text)
           SELECT rowid, doc_title, section_title, text FROM chunks WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`,
        )
        .bind(payload),
      db.prepare('UPDATE shard_documents SET chunk_count = (SELECT count(*) FROM chunks WHERE document_id = ?) WHERE document_id = ?').bind(doc.documentId, doc.documentId),
    );
    const results = await db.batch(statements);
    return results.reduce((sum, r) => sum + Number(r.meta?.rows_written ?? 0), 0);
  }

  async chunkCount(shard: number, documentId: string): Promise<number> {
    const r = await this.shard(shard).prepare('SELECT chunk_count FROM shard_documents WHERE document_id = ?').bind(documentId).first<{ chunk_count: number }>();
    return Number(r?.chunk_count ?? 0);
  }

  /** Merges FTS5 b-tree segments; run after large ingestion batches to keep query reads low. */
  async optimize(shard: number): Promise<number> {
    const r = await this.shard(shard).prepare("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize')").run();
    return Number(r.meta?.rows_written ?? 0);
  }
}
