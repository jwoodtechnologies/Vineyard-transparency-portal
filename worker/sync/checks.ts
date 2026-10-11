/**
 * Last result of every scheduled check (CivicClerk, city pages, queue, crawl passes), so the site
 * and maintainers can see what the five-minute job is really doing. One row per check.
 */
import type { Env } from '../env';

let ensured = false;

export async function ensureCheckTable(env: Env): Promise<void> {
  if (ensured) return;
  await env.CATALOG_DB.prepare(
    `CREATE TABLE IF NOT EXISTS check_status (
       id TEXT PRIMARY KEY,
       last_ok_at TEXT,
       last_error_at TEXT,
       last_error TEXT,
       last_summary_json TEXT,
       runs INTEGER NOT NULL DEFAULT 0,
       updated_at TEXT NOT NULL
     )`,
  ).run();
  ensured = true;
}

/** Runs one check, records success or the error, and never throws. */
export async function track<T>(env: Env, id: string, fn: () => Promise<T>): Promise<T | string> {
  const now = new Date().toISOString();
  try {
    const value = await fn();
    await ensureCheckTable(env);
    await env.CATALOG_DB.prepare(
      `INSERT INTO check_status (id, last_ok_at, last_summary_json, runs, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET last_ok_at = excluded.last_ok_at, last_summary_json = excluded.last_summary_json, runs = runs + 1, updated_at = excluded.updated_at`,
    )
      .bind(id, now, JSON.stringify(value ?? null).slice(0, 2000), now)
      .run();
    return value;
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 500);
    try {
      await ensureCheckTable(env);
      await env.CATALOG_DB.prepare(
        `INSERT INTO check_status (id, last_error_at, last_error, runs, updated_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET last_error_at = excluded.last_error_at, last_error = excluded.last_error, runs = runs + 1, updated_at = excluded.updated_at`,
      )
        .bind(id, now, msg, now)
        .run();
    } catch {
      /* recording must never break the check loop */
    }
    return `error: ${msg}`;
  }
}

export interface CheckRow {
  id: string;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastSummary: unknown;
}

export async function listChecks(env: Env): Promise<CheckRow[]> {
  await ensureCheckTable(env);
  const res = await env.CATALOG_DB.prepare('SELECT * FROM check_status ORDER BY id').all<Record<string, string | null>>();
  return (res.results ?? []).map((r) => {
    let summary: unknown;
    try {
      summary = r.last_summary_json ? JSON.parse(r.last_summary_json) : null;
    } catch {
      summary = null;
    }
    return { id: String(r.id), lastOkAt: r.last_ok_at, lastErrorAt: r.last_error_at, lastError: r.last_error, lastSummary: summary };
  });
}
