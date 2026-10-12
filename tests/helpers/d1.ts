/** A small in-memory stand-in for D1 and R2 (node:sqlite), enough to run Worker handlers in tests. */
import { DatabaseSync } from 'node:sqlite';
import catalogSql from '../../migrations/catalog/0001_catalog.sql';
import searchSql from '../../migrations/search/0001_search.sql';
import { splitSql } from '../../worker/lib/sql';
import type { Env } from '../../worker/env';

type Value = string | number | null | bigint | Uint8Array;

function norm(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v as Value;
}

const plain = (r: unknown) => (r ? { ...(r as Record<string, unknown>) } : null);

class Stmt {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Value[] = [],
  ) {}
  bind(...p: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, p.map(norm));
  }
  private reads(): boolean {
    return /^\s*(select|with|pragma)\b/i.test(this.sql) || /\breturning\b/i.test(this.sql);
  }
  runSync(): { results: Record<string, unknown>[]; success: true; meta: Record<string, number> } {
    const st = this.db.prepare(this.sql);
    if (this.reads()) {
      const rows = st.all(...this.params).map((r) => plain(r)!);
      const changes = /^\s*(select|with|pragma)\b/i.test(this.sql) ? 0 : rows.length;
      return { results: rows, success: true, meta: { changes, rows_written: changes, size_after: 0 } };
    }
    const r = st.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), rows_written: Number(r.changes), last_row_id: Number(r.lastInsertRowid), size_after: 0 } };
  }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.runSync().results[0] ?? null;
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
  async all<T>() {
    return this.runSync() as unknown as { results: T[]; success: true; meta: Record<string, number> };
  }
  async run() {
    return this.runSync();
  }
}

export class D1Shim {
  readonly db = new DatabaseSync(':memory:');
  prepare(sql: string): Stmt {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    this.db.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.runSync());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
}

export class R2Shim {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
  /** Multipart uploads in progress: uploadId -> key and parts. */
  readonly uploads = new Map<string, { key: string; contentType: string | null; parts: Map<number, Uint8Array> }>();
  /** Every get, with the range asked for (to check that files are served by range, not whole). */
  readonly gets: Array<{ key: string; range?: unknown }> = [];
  /** Check put's sha256 like R2 does (off by default: most tests use made-up hashes). */
  verifySha = false;
  async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream, opts?: { httpMetadata?: { contentType?: string }; sha256?: string }) {
    const bytes = value instanceof ReadableStream ? new Uint8Array(await new Response(value).arrayBuffer()) : value instanceof Uint8Array ? value : new Uint8Array(value);
    if (opts?.sha256 && this.verifySha) {
      const d = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
      if (d !== opts.sha256) throw new Error('put: The SHA-256 checksum you specified did not match what we received.');
    }
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType: opts?.httpMetadata?.contentType ?? null });
    return { key, size: bytes.byteLength, etag: 'e' };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.bytes.byteLength, etag: 'e', httpMetadata: { contentType: o.contentType } } : null;
  }
  async get(key: string, opts?: { range?: { offset?: number; length?: number; suffix?: number } }) {
    this.gets.push({ key, range: opts?.range });
    const o = this.objects.get(key);
    if (!o) return null;
    const size = o.bytes.byteLength;
    const r = opts?.range;
    const offset = r ? (r.suffix != null ? size - r.suffix : (r.offset ?? 0)) : 0;
    const length = r ? (r.suffix != null ? r.suffix : (r.length ?? size - offset)) : size;
    const part = o.bytes.subarray(offset, offset + length);
    return { key, size, etag: 'e', httpMetadata: { contentType: o.contentType }, ...(r ? { range: r } : {}), arrayBuffer: async () => part.slice().buffer, body: new Blob([part]).stream() };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async createMultipartUpload(key: string, opts?: { httpMetadata?: { contentType?: string } }) {
    const uploadId = `up${this.uploads.size + 1}${'x'.repeat(8)}`;
    this.uploads.set(uploadId, { key, contentType: opts?.httpMetadata?.contentType ?? null, parts: new Map() });
    return this.resumeMultipartUpload(key, uploadId);
  }
  resumeMultipartUpload(key: string, uploadId: string) {
    const find = () => {
      const u = this.uploads.get(uploadId);
      if (!u || u.key !== key) throw new Error('NoSuchUpload');
      return u;
    };
    return {
      key,
      uploadId,
      uploadPart: async (partNumber: number, value: ArrayBuffer | Uint8Array) => {
        find().parts.set(partNumber, new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)));
        return { partNumber, etag: `etag${partNumber}` };
      },
      complete: async (parts: Array<{ partNumber: number; etag: string }>) => {
        const u = find();
        const chunks = parts.map((p) => {
          const b = u.parts.get(p.partNumber);
          if (!b || p.etag !== `etag${p.partNumber}`) throw new Error('InvalidPart');
          return b;
        });
        const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
        let at = 0;
        for (const c of chunks) {
          bytes.set(c, at);
          at += c.byteLength;
        }
        this.objects.set(key, { bytes, contentType: u.contentType });
        this.uploads.delete(uploadId);
        return { key, size: bytes.byteLength, etag: 'e' };
      },
      abort: async () => {
        this.uploads.delete(uploadId);
      },
    };
  }
}

/** A fresh environment: catalog with the real schema, one search shard, an R2 bucket. */
export function testEnv(): Env & { CATALOG_DB: D1Shim; SEARCH_DB_0: D1Shim; ARCHIVE: R2Shim } {
  const catalog = new D1Shim();
  for (const q of splitSql(catalogSql)) catalog.db.exec(q);
  const shard = new D1Shim();
  for (const q of splitSql(searchSql)) shard.db.exec(q);
  return { CATALOG_DB: catalog, SEARCH_DB_0: shard, SEARCH_SHARDS: '0', SEARCH_WRITE_SHARDS: '0', ARCHIVE: new R2Shim() } as unknown as Env & { CATALOG_DB: D1Shim; SEARCH_DB_0: D1Shim; ARCHIVE: R2Shim };
}
