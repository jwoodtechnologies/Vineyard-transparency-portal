/**
 * What staff set by hand on a record or a meeting, which the automated reads must leave alone. The value itself is saved in
 * the row's own column (so every page shows it with no join), and `manual_json` lists which columns staff locked; every ingest
 * write checks it with `unlocked()`. A record staff hid is moved whole into `document_holds`, so it drops out of every page,
 * search and answer at once, and the ingest refuses to file it again.
 */
import type { Env } from '../env';

const HOLDS_DDL = `CREATE TABLE IF NOT EXISTS document_holds (
  document_id TEXT PRIMARY KEY, sha256 TEXT, reason TEXT NOT NULL, row_json TEXT NOT NULL, shard INTEGER, shard_row_json TEXT,
  meeting_refs_json TEXT NOT NULL DEFAULT '[]', held_by TEXT, held_at TEXT NOT NULL)`;

const ready = new WeakMap<object, Promise<void>>();

/** Adds the columns and table once per worker. Safe to call on every request that needs them. */
export function ensureManual(env: Env): Promise<void> {
  const have = ready.get(env.CATALOG_DB);
  if (have) return have;
  const p = (async () => {
    for (const q of ['ALTER TABLE documents ADD COLUMN manual_json TEXT', 'ALTER TABLE meetings ADD COLUMN manual_json TEXT']) {
      await env.CATALOG_DB.prepare(q)
        .run()
        .catch(() => undefined); // already there
    }
    await env.CATALOG_DB.prepare(HOLDS_DDL).run();
    await env.CATALOG_DB.prepare('CREATE INDEX IF NOT EXISTS idx_holds_sha ON document_holds(sha256)').run();
  })().catch((e) => {
    ready.delete(env.CATALOG_DB);
    throw e;
  });
  ready.set(env.CATALOG_DB, p);
  return p;
}

/** SQL that is true when staff have not locked this column of the row being written. */
export const unlocked = (col: string, table = 'documents'): string => `json_type(${table}.manual_json, '$.${col}') IS NULL`;
