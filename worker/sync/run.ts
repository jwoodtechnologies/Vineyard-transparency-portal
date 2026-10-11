/**
 * Everything the five-minute check does beyond CivicClerk, in priority order, inside one wall-clock
 * budget so a slow tick never overlaps the next one:
 *   1. watched city pages (transparency portal, construction, RDA, agendas and notices, news)
 *   2. Utah Public Notice Website, Vineyard notices (every 15 minutes)
 *   3. city events calendar record (every 30 minutes)
 *   4. queue: fetch, extract, index and archive new files (agendas, packets, minutes, notices)
 *   5. city website crawl, a few pages per tick (a full pass about once a day)
 */
import type { Env } from '../env';
import { Budget } from '../admin/routes';
import { track } from './checks';
import { crawlCitySite, watchPages } from './city';
import { syncCalendar } from './calendar';
import { drainQueue } from './ingest';
import { syncPmn } from './pmn';
import { dispatchCivicClerk } from './dispatch';

export async function runSync(env: Env, scheduledTime: number, budget = new Budget(env)): Promise<Record<string, unknown>> {
  const started = Date.now();
  const deadline = started + 210_000; // 3.5 minutes; the next tick starts at 5
  const minute = new Date(scheduledTime).getUTCMinutes();
  const out: Record<string, unknown> = {};
  if (minute % 10 < 5 && (env as Env & { GITHUB_DISPATCH_TOKEN?: string }).GITHUB_DISPATCH_TOKEN) out.github = await track(env, 'civicclerk-dispatch', () => dispatchCivicClerk(env));
  out.pages = await track(env, 'city-pages', () => watchPages(env, budget));
  if (minute % 15 < 5) out.pmn = await track(env, 'utah-pmn', () => syncPmn(env, budget));
  if (minute % 30 < 5) out.calendar = await track(env, 'city-calendar', () => syncCalendar(env, budget));
  if (Date.now() < deadline) out.queue = await track(env, 'queue', () => drainQueue(env, budget, 6, Math.min(deadline, Date.now() + 150_000)));
  if (Date.now() < deadline) out.crawl = await track(env, 'city-crawl', () => crawlCitySite(env, budget, 3, deadline));
  out.ms = Date.now() - started;
  return out;
}
