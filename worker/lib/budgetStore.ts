/**
 * Saved versions of the budget (the staff portal's Budget screen) and the loader that makes the active one the budget
 * every reader sees. Version 0 means the built-in budget in worker/lib/budgetData.ts; each save adds a numbered version
 * and makes it the active one, and restoring an earlier version saves a copy of it as a new, active version, so the history
 * only grows. Free-tier friendly: one small row per save, and a read only when the archive's data version has moved.
 */
import type { Env } from '../env';
import { applyBudgetBook, builtInBudgetBook, type BudgetBook } from './budgetData';
import { checkBudgetBook } from './budgetBook';
import { dataVersion } from './dataVersion';

/** Versions kept; the oldest beyond this are dropped when a new one is saved. */
export const KEEP_VERSIONS = 60;

export interface BudgetVersionRow {
  version: number;
  created_at: string;
  created_by: string | null;
  note: string;
  summary: string | null;
}

let tablesReady: Promise<void> | null = null;
export function ensureBudgetTables(env: Env): Promise<void> {
  tablesReady ??= env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      'CREATE TABLE IF NOT EXISTS budget_versions (version INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, created_by TEXT, note TEXT NOT NULL, summary TEXT, book TEXT NOT NULL)',
    ),
    env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS budget_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, changed_at TEXT NOT NULL)'),
  ]).then(
    () => undefined,
    (e) => {
      tablesReady = null;
      throw e;
    },
  );
  return tablesReady;
}

/** The active version number (0: the built-in budget). */
export async function activeVersion(env: Env): Promise<number> {
  const row = await env.CATALOG_DB.prepare('SELECT version FROM budget_state WHERE id = 1')
    .first<{ version: number }>()
    .catch(() => null);
  return Number(row?.version ?? 0);
}

/** The stored book of one version, checked again on the way out, or null when it is missing or no longer valid. */
export async function readBook(env: Env, version: number): Promise<BudgetBook | null> {
  if (version === 0) return builtInBudgetBook();
  const row = await env.CATALOG_DB.prepare('SELECT book FROM budget_versions WHERE version = ?')
    .bind(version)
    .first<{ book: string }>()
    .catch(() => null);
  if (!row) return null;
  try {
    return checkBudgetBook(JSON.parse(row.book)).book;
  } catch {
    return null;
  }
}

let applied: { dv: number; version: number } | null = null;
let loading: Promise<void> | null = null;

/**
 * Makes this isolate's budget match the active version. Cheap: the archive's data version (kept in the isolate for 30
 * seconds) is compared first, and the database is read only when it has moved since the last look.
 */
export function ensureBudgetBook(env: Env): Promise<void> {
  loading ??= (async () => {
    const dv = await dataVersion(env).catch(() => -1);
    if (applied && dv >= 0 && applied.dv === dv) return;
    const version = await activeVersion(env);
    if (!applied || applied.version !== version) {
      const book = version === 0 ? null : await readBook(env, version);
      // A stored version that cannot be read falls back to the built-in budget rather than breaking the pages.
      applyBudgetBook(book);
      applied = { dv, version: book || version === 0 ? version : 0 };
    } else {
      applied = { dv, version };
    }
  })()
    .catch((e) => console.error('budget load failed', String(e)))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Called after a save or a restore in this isolate: the new version is the budget from now on. */
export async function activate(env: Env, version: number, book: BudgetBook | null): Promise<void> {
  applyBudgetBook(book);
  applied = { dv: await dataVersion(env).catch(() => -1), version };
}

/** Test hook: forget what this isolate loaded. */
export function resetBudgetLoader(): void {
  applied = null;
  loading = null;
  tablesReady = null;
}
