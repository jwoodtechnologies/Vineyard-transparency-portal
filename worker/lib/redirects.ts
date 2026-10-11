/**
 * Old record ids keep working. A record folded into another (a second copy of the same meeting's minutes)
 * or taken out of the archive (a capital project dropped from the budget, a county tax year withdrawn, an
 * empty code site entry) leaves a row here, so a link printed on a page, cited by a chat answer or saved by a
 * reader opens the record that replaced it, or says plainly why it is gone, instead of a dead end.
 *
 * Records folded into another before this table existed are still found: their source rows moved to the
 * record they were folded into and keep the old id's first eight characters in their own id
 * (src_<key>_<id chars 4..12>, see upsertDocument).
 */
import type { Env } from '../env';

const DDL = 'CREATE TABLE IF NOT EXISTS document_redirects (old_id TEXT PRIMARY KEY, new_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL)';
let ready: Promise<unknown> | null = null;

/** Creates the table once per isolate (it is also in migrations/catalog/0001_catalog.sql). */
export function ensureRedirects(env: Env): Promise<unknown> {
  ready ??= env.CATALOG_DB.prepare(DDL)
    .run()
    .catch((e: unknown) => {
      ready = null;
      throw e;
    });
  return ready;
}

/** The statement that records one old id: moved to `newId`, or removed (`newId` null) for `reason`. */
export function redirectStatement(env: Env, oldId: string, newId: string | null, reason: string): D1PreparedStatement {
  return env.CATALOG_DB.prepare(
    `INSERT INTO document_redirects (old_id, new_id, reason, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, reason = excluded.reason, created_at = excluded.created_at`,
  ).bind(oldId, newId, reason.slice(0, 200), new Date().toISOString());
}

export type Moved = { kind: 'moved'; id: string } | { kind: 'removed'; reason: string };

const RECORD_ID = /^doc_[0-9a-f]{16}$/;

/** Where an id that is not in the catalog went, following up to five moves; null when nothing is known. */
export async function resolveMoved(env: Env, id: string): Promise<Moved | null> {
  if (!RECORD_ID.test(id)) return null;
  const db = env.CATALOG_DB;
  let current = id;
  let removed: string | null = null;
  for (let hop = 0; hop < 5; hop++) {
    const r = await db
      .prepare('SELECT new_id, reason FROM document_redirects WHERE old_id = ?')
      .bind(current)
      .first<{ new_id: string | null; reason: string }>()
      .catch(() => null);
    if (!r) break;
    if (!r.new_id) {
      removed = r.reason;
      break;
    }
    const exists = await db.prepare('SELECT id FROM documents WHERE id = ?').bind(r.new_id).first<{ id: string }>();
    if (exists) return { kind: 'moved', id: exists.id };
    current = r.new_id;
  }
  // Folded into another record before this table existed: its source rows carry the old id's first characters.
  const suffix = current.slice(4, 12);
  const src = await db
    .prepare("SELECT ds.document_id AS id FROM document_sources ds JOIN documents d ON d.id = ds.document_id WHERE ds.id LIKE ? ESCAPE '\\' LIMIT 1")
    .bind(`src\\_%\\_${suffix}`)
    .first<{ id: string }>()
    .catch(() => null);
  if (src && src.id !== id) return { kind: 'moved', id: src.id };
  return removed ? { kind: 'removed', reason: removed } : null;
}
