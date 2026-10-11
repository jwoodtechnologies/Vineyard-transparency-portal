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
  async put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType: opts?.httpMetadata?.contentType ?? null });
    return { key, size: bytes.byteLength, etag: 'e' };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.bytes.byteLength, etag: 'e', httpMetadata: { contentType: o.contentType } } : null;
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return { key, size: o.bytes.byteLength, etag: 'e', httpMetadata: { contentType: o.contentType }, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength), body: new Blob([o.bytes]).stream() };
  }
  async delete(key: string) {
    this.objects.delete(key);
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
