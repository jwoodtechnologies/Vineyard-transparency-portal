/**
 * Tables for panel accounts (owner and invited uploaders), staff uploads, resident submissions and
 * their logs. Created on first use, like the activity tables (worker/panel/store.ts).
 */
import type { Env } from '../env';
import { ensureActivityTables } from '../panel/store';

export const CONTRIB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS panel_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'uploader')),
    created_at TEXT NOT NULL, disabled_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS panel_invites (
    token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT, created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, used_at TEXT, used_by INTEGER, revoked_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, document_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, doc_type TEXT NOT NULL,
    doc_date TEXT, body TEXT, url TEXT, status_text TEXT, location TEXT, meeting_id TEXT, project_id TEXT,
    file_key TEXT, file_name TEXT, mime TEXT, file_size INTEGER, sha256 TEXT, file_text TEXT, index_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS idx_uploads_account ON uploads(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_uploads_document ON uploads(document_id)',
  `CREATE TABLE IF NOT EXISTS upload_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, account_id INTEGER, account_name TEXT, action TEXT NOT NULL,
    upload_id TEXT, document_id TEXT, title TEXT)`,
  'CREATE TABLE IF NOT EXISTS portal_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS resident_submissions (
    id TEXT PRIMARY KEY, document_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, url TEXT, status_text TEXT, location TEXT,
    file_key TEXT, file_name TEXT, mime TEXT, file_size INTEGER, sha256 TEXT, ip_hash TEXT NOT NULL, day TEXT NOT NULL,
    reports INTEGER NOT NULL DEFAULT 0, index_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, hidden_at TEXT, removed_at TEXT,
    status TEXT NOT NULL DEFAULT 'approved')`,
  'CREATE INDEX IF NOT EXISTS idx_resident_day ON resident_submissions(day)',
  'CREATE INDEX IF NOT EXISTS idx_resident_document ON resident_submissions(document_id)',
  `CREATE TABLE IF NOT EXISTS resident_reports (
    submission_id TEXT NOT NULL, ip_hash TEXT NOT NULL, day TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (submission_id, ip_hash))`,
  'CREATE INDEX IF NOT EXISTS idx_resident_reports_day ON resident_reports(day, ip_hash)',
  `CREATE TABLE IF NOT EXISTS resident_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, submission_id TEXT, ip_hash TEXT, detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS contrib_queue (
    document_id TEXT PRIMARY KEY, origin TEXT NOT NULL, item_id TEXT NOT NULL, queued_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)`,
];

const ready = new WeakMap<D1Database, Promise<void>>();

/** Creates the tables, links passkeys to accounts, and makes sure the owner has account 1 (once per isolate and database). */
export function ensureContribTables(env: Env): Promise<void> {
  const key = env.CATALOG_DB;
  const known = ready.get(key);
  if (known) return known;
  const p = (async () => {
    await ensureActivityTables(env);
    const db = env.CATALOG_DB;
    await db.batch(CONTRIB_SCHEMA.map((s) => db.prepare(s)));
    // Passkeys belong to an account (existing ones are the owner's).
    await db
      .prepare('ALTER TABLE panel_passkeys ADD COLUMN account_id INTEGER')
      .run()
      .catch(() => undefined);
    // Resident submissions wait for the owner's approval (rows from before that are approved).
    await db
      .prepare("ALTER TABLE resident_submissions ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'")
      .run()
      .catch(() => undefined);
    await syncOwnerAccount(env);
  })().catch((e: unknown) => {
    ready.delete(key);
    throw e;
  });
  ready.set(key, p);
  return p;
}

/** The owner (panel_owner, created with the one-time setup code) is always account 1. */
export async function syncOwnerAccount(env: Env): Promise<void> {
  const db = env.CATALOG_DB;
  const owner = await db.prepare('SELECT created_at FROM panel_owner WHERE id = 1').first<{ created_at: string }>();
  if (!owner) return;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO panel_accounts (id, name, role, created_at) VALUES (1, 'Owner', 'owner', ?)").bind(owner.created_at),
    db.prepare('UPDATE panel_passkeys SET account_id = 1 WHERE account_id IS NULL'),
  ]);
}

/** A stored setting, or the fallback. */
export async function getSetting(env: Env, key: string, fallback: string): Promise<string> {
  const r = await env.CATALOG_DB.prepare('SELECT value FROM portal_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? fallback;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.CATALOG_DB.prepare('INSERT INTO portal_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, new Date().toISOString())
    .run();
}

/** Registers the two portal collections in the sources table (once per isolate). */
const sourcesDone = new WeakSet<D1Database>();
export async function ensurePortalSources(env: Env): Promise<void> {
  if (sourcesDone.has(env.CATALOG_DB)) return;
  const now = new Date().toISOString();
  const db = env.CATALOG_DB;
  const row = (id: string, name: string, description: string) =>
    db
      .prepare(
        `INSERT INTO sources (id, name, base_url, source_type, authority, crawl_enabled, archive_enabled, document_discovery_enabled, description, notes, status, created_at, updated_at)
         VALUES (?, ?, 'https://vineyardportal.org/', 'other', 'Vineyard Transparency Portal', 0, 1, 0, ?, '', 'ok', ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description`,
      )
      .bind(id, name, description, now, now);
  await db.batch([row('portal-staff', 'Added by portal staff', 'Records added by portal staff.'), row('resident-submitted', 'Resident submitted', 'Added by residents. Not city records.')]);
  sourcesDone.add(env.CATALOG_DB);
}
