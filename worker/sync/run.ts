/**
 * Everything the five-minute check does beyond CivicClerk, in priority order, inside one wall-clock
 * budget so a slow tick never overlaps the next one:
 *   1. watched city pages (transparency portal, construction, RDA, agendas and notices, news)
 *   2. Utah Public Notice Website, Vineyard notices (every 15 minutes)
 *   3. city events calendar record (every 30 minutes)
 *   4. queue: fetch, extract, index and archive new files (agendas, packets, minutes, notices)
 *   5. websites staff asked the portal to watch, the few that are due
 *   6. city website crawl, a few pages per tick (a full pass about once a day)
 */
import type { Env } from '../env';
import { Budget } from '../admin/routes';
import { track } from './checks';
import { crawlCitySite, watchPages } from './city';
import { syncCalendar } from './calendar';
import { drainQueue } from './ingest';
import { syncPmn } from './pmn';
import { dispatchCivicClerk } from './dispatch';
import { runWebWatch } from './webWatch';

/**
 * How often the five-minute Worker cron runs each check, in minutes (on the ticks whose minute of the day is
 * a multiple of it). The staff Schedules screen reads these same numbers.
 */
export const EVERY_MIN = { civicclerkDispatch: 10, cityPages: 5, pmn: 15, calendar: 30, queue: 5, crawl: 5, webWatch: 5 } as const;

/** True on the tick that runs a check due every `n` minutes. */
export const dueOnTick = (minuteOfDay: number, n: number): boolean => minuteOfDay % n < 5;

export async function runSync(env: Env, scheduledTime: number, budget = new Budget(env)): Promise<Record<string, unknown>> {
  const started = Date.now();
  const deadline = started + 210_000; // 3.5 minutes; the next tick starts at 5
  const t = new Date(scheduledTime);
  const minute = t.getUTCHours() * 60 + t.getUTCMinutes();
  const out: Record<string, unknown> = {};
  if (dueOnTick(minute, EVERY_MIN.civicclerkDispatch) && (env as Env & { GITHUB_DISPATCH_TOKEN?: string }).GITHUB_DISPATCH_TOKEN) out.github = await track(env, 'civicclerk-dispatch', () => dispatchCivicClerk(env));
  out.pages = await track(env, 'city-pages', () => watchPages(env, budget));
  if (dueOnTick(minute, EVERY_MIN.pmn)) out.pmn = await track(env, 'utah-pmn', () => syncPmn(env, budget));
  if (dueOnTick(minute, EVERY_MIN.calendar)) out.calendar = await track(env, 'city-calendar', () => syncCalendar(env, budget));
  // Websites staff asked the portal to watch (worker/sync/webWatch.ts): a few due pages per tick.
  if (Date.now() < deadline) out.web = await track(env, 'web-watch', () => runWebWatch(env, budget));
  if (Date.now() < deadline) out.queue = await track(env, 'queue', () => drainQueue(env, budget, 6, Math.min(deadline, Date.now() + 150_000)));
  if (Date.now() < deadline) out.crawl = await track(env, 'city-crawl', () => crawlCitySite(env, budget, 3, deadline));
  out.ms = Date.now() - started;
  return out;
}
