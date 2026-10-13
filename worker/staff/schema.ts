/**
 * Tables for the staff portal. Created on first use (like the owner panel's), and by the migrate job.
 * Nothing here is read by the public site; in later stages the override tables that hold what staff
 * changed are added beside these.
 */
import type { Env } from '../env';

export const STAFF_SCHEMA = [
  // One-time passkey challenges are shared with the owner panel (same table, same five-minute life).
  'CREATE TABLE IF NOT EXISTS panel_challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, expires_at TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS staff_users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, department TEXT, role TEXT NOT NULL,
    areas TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 0, pass_hash TEXT, salt TEXT, iterations INTEGER,
    created_at TEXT NOT NULL, created_by TEXT, last_login_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS staff_passkeys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
    name TEXT, created_at TEXT NOT NULL, last_used_at TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_staff_passkeys_user ON staff_passkeys(user_id)',
  `CREATE TABLE IF NOT EXISTS staff_sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, agent TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions(user_id)',
  `CREATE TABLE IF NOT EXISTS staff_invites (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_staff_invites_user ON staff_invites(user_id)',
  // Single-use recovery codes. Only a salted hash is kept; the person saw the codes once.
  'CREATE TABLE IF NOT EXISTS staff_recovery (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_staff_recovery_user ON staff_recovery(user_id)',
  'CREATE TABLE IF NOT EXISTS staff_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, email TEXT, at TEXT NOT NULL, ok INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_staff_attempts_at ON staff_attempts(at)',
  'CREATE TABLE IF NOT EXISTS staff_pow (challenge TEXT PRIMARY KEY, bits INTEGER NOT NULL, expires_at TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS staff_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_id TEXT, user_name TEXT, area TEXT NOT NULL, action TEXT NOT NULL,
    entity TEXT NOT NULL, entity_id TEXT, summary TEXT NOT NULL, before_json TEXT, after_json TEXT, undone_at TEXT, undone_by TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_staff_audit_area ON staff_audit(area, id)',
];

let ready: Promise<void> | null = null;

export function ensureStaffTables(env: Env): Promise<void> {
  ready ??= env.CATALOG_DB.batch(STAFF_SCHEMA.map((s) => env.CATALOG_DB.prepare(s)))
    .then(() => undefined)
    .catch((e: unknown) => {
      ready = null;
      throw e;
    });
  return ready;
}
