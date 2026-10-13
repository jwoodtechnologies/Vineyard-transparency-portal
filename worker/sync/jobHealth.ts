/**
 * Job and source health for the watchdog (GET /api/health/jobs, .github/workflows/watchdog.yml) and the
 * owner panel's Health tab.
 *
 * Counter rules:
 *   - Scheduled checks (check_status, worker/sync/checks.ts track()): an error adds one to
 *     consecutive_failures, a success sets it to 0.
 *   - Sources (sources.consecutive_failures): every status report moves it. 'active' sets it to 0; a
 *     failing status (unreachable, degraded, changed, authentication_required) adds one; anything else
 *     (unknown, blocked by robots.txt) leaves it as it is.
 * A row is failing at WATCHDOG_THRESHOLD (3) in a row.
 */
import type { Env } from '../env';
import { listChecks } from './checks';

export const WATCHDOG_THRESHOLD = 3;

/**
 * Checks the Worker no longer runs, with what covers them now. Their old rows stay in check_status but
 * are reported as covered, never failing.
 */
export const COVERED_CHECKS: Record<string, string> = {
  civicclerk: 'Covered by the GitHub ingest (vineyard-civicclerk-meetings); CivicClerk refuses Cloudflare (403).',
};
export const SOURCE_FAILING_STATUSES = ['unreachable', 'degraded', 'changed', 'authentication_required'] as const;

/**
 * SET fragment for an UPDATE of sources that also moves the counter. Bind the new status twice for it.
 * Callers run ensureSourceCounter first.
 */
export const SOURCE_COUNTER_SET = `consecutive_failures = CASE WHEN ? = 'active' THEN 0 WHEN ? IN (${SOURCE_FAILING_STATUSES.map((s) => `'${s}'`).join(', ')}) THEN coalesce(consecutive_failures, 0) + 1 ELSE coalesce(consecutive_failures, 0) END`;

const sourceCounter = new WeakSet<object>();

/** Adds sources.consecutive_failures once per isolate (a no-op error when the column already exists). */
export async function ensureSourceCounter(env: Env): Promise<void> {
  if (sourceCounter.has(env.CATALOG_DB)) return;
  await env.CATALOG_DB.prepare('ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0')
    .run()
    .catch(() => undefined);
  sourceCounter.add(env.CATALOG_DB);
}

/** Bumps or resets one source's counter (Worker-side syncs that set the status themselves). */
export async function countSource(env: Env, sourceId: string, ok: boolean): Promise<void> {
  try {
    await ensureSourceCounter(env);
    await env.CATALOG_DB.prepare(`UPDATE sources SET consecutive_failures = ${ok ? '0' : 'coalesce(consecutive_failures, 0) + 1'} WHERE id = ?`)
      .bind(sourceId)
      .run();
  } catch {
    /* counting must never break a sync */
  }
}

/**
 * An error message fit for a public page and a GitHub issue: no query strings, tokens, keys, file system
 * paths or stack frames, one line, at most 300 characters.
 */
export function publicError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).split(/\n\s*at\s/)[0];
  s = s.replace(/\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, '$1');
  s = s.replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [hidden]');
  s = s.replace(/\b([\w-]*?(?:token|key|secret|password|passwd|signature|sig|auth|authorization|cookie|session))(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2[hidden]');
  s = s.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/g, '[hidden]');
  s = s.replace(/file:\/\/\S+/gi, '[path]');
  s = s.replace(/(^|[\s("'=])(?:\/(?:home|root|tmp|var|usr|opt|srv|app|workspace|github|runner|mnt|etc|Users)\b[^\s"'),]*|[A-Za-z]:\\[^\s"'),]+)/g, '$1[path]');
  s = s.replace(/(^|[\s("'])(?:\.{0,2}\/)?(?:worker|src|ingest|scripts|node_modules)\/[^\s"'),]+\.(?:ts|js|mjs|py)(?::\d+(?::\d+)?)?/g, '$1[path]');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 300 ? `${s.slice(0, 299).trimEnd()}...` : s || null;
}

export interface JobHealth {
  kind: 'job' | 'source';
  id: string;
  name: string;
  consecutiveFailures: number;
  failing: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  status?: string;
  /** For a check the Worker no longer runs: what covers it now. */
  covered?: string;
}

export interface JobHealthReport {
  generatedAt: string;
  threshold: number;
  jobs: JobHealth[];
  sources: JobHealth[];
}

const latest = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => Boolean(x)).sort().pop() ?? null;

export async function jobHealth(env: Env): Promise<JobHealthReport> {
  const checks = await listChecks(env);
  const jobs: JobHealth[] = checks.map((c) =>
    COVERED_CHECKS[c.id]
      ? { kind: 'job', id: c.id, name: c.id, status: 'covered', covered: COVERED_CHECKS[c.id], consecutiveFailures: 0, failing: false, lastRunAt: latest(c.lastOkAt, c.lastErrorAt), lastSuccessAt: c.lastOkAt, lastErrorAt: null, lastError: null }
      : {
          kind: 'job',
          id: c.id,
          name: c.id,
          consecutiveFailures: c.consecutiveFailures,
          failing: c.consecutiveFailures >= WATCHDOG_THRESHOLD,
          lastRunAt: latest(c.lastOkAt, c.lastErrorAt),
          lastSuccessAt: c.lastOkAt,
          lastErrorAt: c.lastErrorAt,
          lastError: publicError(c.lastError),
        },
  );
  await ensureSourceCounter(env);
  const rows = await env.CATALOG_DB.prepare(
    'SELECT id, name, status, status_message, last_checked_at, last_success_at, coalesce(consecutive_failures, 0) AS consecutive_failures FROM sources WHERE crawl_enabled = 1 ORDER BY id',
  ).all<Record<string, string | number | null>>();
  const sources: JobHealth[] = (rows.results ?? []).map((r) => {
    const n = Number(r.consecutive_failures ?? 0);
    const status = String(r.status ?? 'unknown');
    const failingNow = (SOURCE_FAILING_STATUSES as readonly string[]).includes(status);
    return {
      kind: 'source',
      id: String(r.id),
      name: String(r.name ?? r.id),
      status,
      consecutiveFailures: n,
      failing: n >= WATCHDOG_THRESHOLD,
      lastRunAt: (r.last_checked_at as string | null) ?? null,
      lastSuccessAt: (r.last_success_at as string | null) ?? null,
      lastErrorAt: failingNow ? ((r.last_checked_at as string | null) ?? null) : null,
      lastError: failingNow ? publicError((r.status_message as string | null) ?? status) : null,
    };
  });
  return { generatedAt: new Date().toISOString(), threshold: WATCHDOG_THRESHOLD, jobs, sources };
}
