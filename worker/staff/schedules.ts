/**
 * Schedules, for owners and administrators: every scheduled job and source in one table, with what it
 * reads, how often (from the real settings: the Worker cron in wrangler.jsonc and the check intervals in
 * worker/sync/run.ts, the GitHub workflow schedules, all read by worker/lib/schedules.generated.ts), when it
 * last ran and last worked, when it runs next, and whether it is working.
 */
import { HttpError, json } from '../lib/http';
import { describeCron, describeMinutes, nextCronRun, nextIntervalRun } from '../lib/scheduleSources';
import { WORKER_CRONS, WORKFLOW_SCHEDULES } from '../lib/schedules.generated';
import { listChecks, type CheckRow } from '../sync/checks';
import { COVERED_CHECKS, WATCHDOG_THRESHOLD } from '../sync/jobHealth';
import { EVERY_MIN } from '../sync/run';
import { ensureWatchTables, frequencyLabel, nextDue, type WatchRow } from '../sync/webWatch';
import { CITY } from '../sync/city';
import { canManageUsers } from './core';
import type { StaffCall } from './modules';

const REPO = 'https://github.com/jwoodtechnologies/vineyard-transparency-portal';

export interface ScheduleRow {
  group: 'Worker' | 'GitHub' | 'Source' | 'Watched website';
  id: string;
  name: string;
  reads: Array<{ label: string; url: string | null }>;
  every: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  status: string;
  tone: 'ok' | 'wait' | 'off';
  detail: string | null;
}

/** How a scheduled check is doing, in a word or two. */
export function checkStatus(c: Pick<CheckRow, 'consecutiveFailures' | 'lastOkAt' | 'lastErrorAt'> | undefined): { status: string; tone: ScheduleRow['tone'] } {
  if (!c || (!c.lastOkAt && !c.lastErrorAt)) return { status: 'Not run yet', tone: 'off' };
  if (c.consecutiveFailures >= WATCHDOG_THRESHOLD) return { status: 'Failing', tone: 'wait' };
  if (c.consecutiveFailures > 0) return { status: c.consecutiveFailures === 1 ? '1 failure' : `${c.consecutiveFailures} failures`, tone: 'wait' };
  return { status: 'Working', tone: 'ok' };
}

const latest = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => Boolean(x)).sort().pop() ?? null;

interface WorkerJob {
  id: string;
  name: string;
  reads: ScheduleRow['reads'];
  /** Every N minutes within the Worker cron; null for every tick. */
  everyMin?: number;
  /** A cron of its own (the hourly tick), when not every N minutes. */
  cron?: string;
  /** Plain words when neither fits. */
  words?: string;
}

const CITY_SITE = { label: 'Vineyard city website', url: CITY };

/** The Worker's checks: names and what they read here; how often from run.ts and wrangler.jsonc. */
const WORKER_JOBS: WorkerJob[] = [
  { id: 'city-pages', name: 'Watched city pages', reads: [CITY_SITE], everyMin: EVERY_MIN.cityPages },
  { id: 'utah-pmn', name: 'Utah Public Notices', reads: [{ label: 'Utah Public Notice Website', url: 'https://www.utah.gov/pmn/' }], everyMin: EVERY_MIN.pmn },
  { id: 'city-calendar', name: 'City events calendar', reads: [{ label: 'City calendar', url: `${CITY}calendar.php` }], everyMin: EVERY_MIN.calendar },
  { id: 'civicclerk-dispatch', name: 'Start the CivicClerk ingest', reads: [{ label: 'GitHub ingest for CivicClerk', url: `${REPO}/actions/workflows/ingest.yml` }], everyMin: EVERY_MIN.civicclerkDispatch },
  { id: 'web-watch', name: 'Watched websites', reads: [{ label: 'Pages listed on Watched websites', url: null }], everyMin: EVERY_MIN.webWatch },
  { id: 'queue', name: 'Record queue', reads: [{ label: 'New files found by the checks', url: null }], everyMin: EVERY_MIN.queue },
  { id: 'city-crawl', name: 'City website crawl', reads: [CITY_SITE], everyMin: EVERY_MIN.crawl },
  { id: 'votes', name: 'Votes from minutes', reads: [{ label: 'Minutes in the archive', url: null }] },
  { id: 'portal-uploads', name: 'Large staff uploads', reads: [{ label: 'Files added by staff', url: null }] },
  { id: 'sheriff', name: 'Sheriff press releases', reads: [{ label: 'Utah County Sheriff', url: 'https://www.utahcountysheriff.org/' }], cron: '0 * * * *' },
  { id: 'coverage', name: 'Coverage check', reads: [{ label: 'The archive', url: null }], words: 'Daily' },
  { id: 'pages', name: 'Rebuild pages after changes', reads: [{ label: 'The archive', url: null }], words: 'After changes' },
];

/** Which GitHub schedule keeps a source current; the nightly crawl otherwise. */
const SOURCE_SCHEDULE: Record<string, { workflow: string; cron: string } | { worker: string }> = {
  'vineyard-civicclerk-meetings': { workflow: 'ingest.yml', cron: '*/10 * * * *' },
  'vineyard-gis': { workflow: 'ingest.yml', cron: '37 10 * * 1' },
  'utah-county-parcels': { workflow: 'ingest.yml', cron: '37 10 * * 1' },
  'utah-pmn-vineyard': { worker: 'utah-pmn' },
  'ucso-press-releases': { worker: 'sheriff' },
  'vineyard-city-website': { worker: 'city-pages' },
  'watched-websites': { worker: 'web-watch' },
};

const NIGHTLY = { workflow: 'ingest.yml', cron: '17 9 * * *' };

function workerEvery(j: WorkerJob, base: string): { every: string; next: (now: Date) => Date | null } {
  if (j.everyMin) return { every: describeMinutes(j.everyMin), next: (now) => nextIntervalRun(j.everyMin as number, now) };
  if (j.cron) return { every: describeCron(j.cron), next: (now) => nextCronRun(j.cron as string, now) };
  if (j.words) return { every: j.words, next: () => null };
  return { every: describeCron(base), next: (now) => nextCronRun(base, now) };
}

export async function buildSchedules(env: StaffCall['env'], now = new Date()): Promise<ScheduleRow[]> {
  const base = WORKER_CRONS[0] ?? '*/5 * * * *';
  const checks = new Map((await listChecks(env)).map((c) => [c.id, c]));
  const rows: ScheduleRow[] = [];
  const workerJobs = new Map<string, WorkerJob>(WORKER_JOBS.map((j) => [j.id, j]));

  for (const j of WORKER_JOBS) {
    const c = checks.get(j.id);
    const e = workerEvery(j, base);
    const s = checkStatus(c);
    rows.push({ group: 'Worker', id: j.id, name: j.name, reads: j.reads, every: e.every, lastRunAt: c ? latest(c.lastOkAt, c.lastErrorAt) : null, lastSuccessAt: c?.lastOkAt ?? null, nextRunAt: e.next(now)?.toISOString() ?? null, ...s, detail: c?.consecutiveFailures ? (c.lastError ?? null) : null });
  }
  for (const [id, note] of Object.entries(COVERED_CHECKS)) {
    const c = checks.get(id);
    if (c) rows.push({ group: 'Worker', id, name: id === 'civicclerk' ? 'CivicClerk (old Worker check)' : id, reads: [], every: 'Not run', lastRunAt: latest(c.lastOkAt, c.lastErrorAt), lastSuccessAt: c.lastOkAt, nextRunAt: null, status: 'Covered', tone: 'off', detail: note });
  }

  const srcRows = await env.CATALOG_DB.prepare('SELECT id, name, base_url, status, last_checked_at, last_success_at, crawl_enabled, coalesce(consecutive_failures, 0) AS consecutive_failures FROM sources ORDER BY name')
    .all<{ id: string; name: string; base_url: string; status: string; last_checked_at: string | null; last_success_at: string | null; crawl_enabled: number; consecutive_failures: number }>()
    .catch(() => env.CATALOG_DB.prepare('SELECT id, name, base_url, status, last_checked_at, last_success_at, crawl_enabled, 0 AS consecutive_failures FROM sources ORDER BY name').all());
  const sources = (srcRows.results ?? []) as Array<{ id: string; name: string; base_url: string; status: string; last_checked_at: string | null; last_success_at: string | null; crawl_enabled: number; consecutive_failures: number }>;
  const lastSuccessOf = (ids: string[]) => latest(...sources.filter((s) => ids.includes(s.id)).map((s) => s.last_success_at));

  for (const wf of WORKFLOW_SCHEDULES) {
    for (const c of wf.crons) {
      // What GitHub's run leaves behind here: the sources it updates. Other workflows report on GitHub only.
      const fed = wf.file === 'ingest.yml' ? sources.filter((s) => (SOURCE_SCHEDULE[s.id] && 'workflow' in SOURCE_SCHEDULE[s.id] ? (SOURCE_SCHEDULE[s.id] as { cron: string }).cron === c.cron : c.cron === NIGHTLY.cron && s.crawl_enabled === 1)).map((s) => s.id) : [];
      const last = fed.length ? lastSuccessOf(fed) : null;
      rows.push({
        group: 'GitHub',
        id: `${wf.file}:${c.cron}`,
        name: wf.name,
        reads: [{ label: c.note || wf.name, url: `${REPO}/actions/workflows/${wf.file}` }],
        every: describeCron(c.cron),
        lastRunAt: last,
        lastSuccessAt: last,
        nextRunAt: nextCronRun(c.cron, now)?.toISOString() ?? null,
        status: fed.length ? (last ? 'Working' : 'Not run yet') : 'On GitHub',
        tone: fed.length && last ? 'ok' : 'off',
        detail: fed.length ? null : 'Its runs are listed on GitHub Actions.',
      });
    }
  }

  for (const s of sources) {
    if (!s.crawl_enabled && !SOURCE_SCHEDULE[s.id]) continue;
    const plan = SOURCE_SCHEDULE[s.id] ?? NIGHTLY;
    const viaWorker = 'worker' in plan ? workerJobs.get(plan.worker) : undefined;
    const e = viaWorker ? workerEvery(viaWorker, base) : { every: describeCron((plan as { cron: string }).cron), next: (d: Date) => nextCronRun((plan as { cron: string }).cron, d) };
    const failing = s.consecutive_failures >= WATCHDOG_THRESHOLD;
    rows.push({
      group: 'Source',
      id: s.id,
      name: s.name,
      reads: [{ label: s.name, url: s.base_url }],
      every: viaWorker ? `${e.every} (Worker)` : `${e.every} (GitHub)`,
      lastRunAt: s.last_checked_at,
      lastSuccessAt: s.last_success_at,
      nextRunAt: e.next(now)?.toISOString() ?? null,
      status: failing ? 'Failing' : s.consecutive_failures > 0 ? `${s.consecutive_failures} failures` : s.last_success_at ? 'Working' : 'Not run yet',
      tone: s.consecutive_failures > 0 ? 'wait' : s.last_success_at ? 'ok' : 'off',
      detail: null,
    });
  }

  await ensureWatchTables(env);
  const watched = await env.CATALOG_DB.prepare('SELECT * FROM web_watch WHERE deleted_at IS NULL ORDER BY lower(label)').all<WatchRow>();
  for (const w of watched.results ?? []) {
    rows.push({
      group: 'Watched website',
      id: w.id,
      name: w.label,
      reads: [{ label: w.url, url: w.url }],
      every: frequencyLabel(w.every_min),
      lastRunAt: w.last_checked_at,
      lastSuccessAt: w.last_error ? null : w.last_checked_at,
      nextRunAt: w.paused ? null : nextIntervalRun(5, new Date(Math.max(nextDue(w, now.getTime()), now.getTime()) - 60_000)).toISOString(),
      status: w.paused ? 'Paused' : w.last_error ? 'Not working' : w.last_checked_at ? 'Working' : 'Not run yet',
      tone: w.paused ? 'off' : w.last_error ? 'wait' : w.last_checked_at ? 'ok' : 'off',
      detail: w.last_error,
    });
  }
  return rows;
}

export async function schedules(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route } = call;
  if (route !== '/schedules/list') return null;
  if (request.method !== 'GET') return null;
  if (!canManageUsers(me)) throw new HttpError(403, 'unauthorized', 'Only owners and administrators can see this.');
  return json({ generatedAt: new Date().toISOString(), workerCron: describeCron(WORKER_CRONS[0] ?? ''), items: await buildSchedules(env) });
}
