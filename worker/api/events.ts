/**
 * GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD : Vineyard City community calendar events.
 *
 * Source: the public JSON the city website's own calendar page loads on every visit
 * (vineyardutah.gov/calendar.php → calendar_data_handler.php). Read through Cloudflare's cache for
 * an hour at a time, so the city site sees at most about one request an hour. Recurring events are
 * expanded here. Times are Vineyard local time, exactly as the city publishes them.
 */
import type { Env } from '../env';
import { badRequest, json } from '../lib/http';
import { CITY_CALENDAR_PAGE, expandCityEvents, type CityEvent } from '../lib/cityEvents';

export const CITY_CALENDAR_URL =
  'https://www.vineyardutah.gov/_assets_/plugins/revizeCalendar/calendar_data_handler.php?webspace=vineyard&relative_revize_url=//cms3.revize.com&protocol=https:';

let memo: { at: number; events: CityEvent[] } | null = null;

export async function loadCity(): Promise<CityEvent[]> {
  if (memo && Date.now() - memo.at < 10 * 60_000) return memo.events;
  const res = await fetch(CITY_CALENDAR_URL, {
    headers: { accept: 'application/json', 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' },
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`city calendar ${res.status}`);
  const body = (await res.json()) as unknown;
  const events = Array.isArray(body) ? (body as CityEvent[]) : [];
  memo = { at: Date.now(), events };
  return events;
}

export async function listEvents(_env: Env, url: URL): Promise<Response> {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('`from` and `to` must be YYYY-MM-DD dates.');
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (!(span >= 0 && span <= 800)) throw badRequest('The date range must be between 0 and 800 days.');
  try {
    const items = expandCityEvents(await loadCity(), from, to);
    return json({ items, source: CITY_CALENDAR_PAGE }, { cache: 'public, max-age=900, stale-while-revalidate=3600' });
  } catch {
    // The city site being down never breaks the portal's calendar; meetings still show.
    return json({ items: [], source: CITY_CALENDAR_PAGE, unavailable: true }, { cache: 'public, max-age=60' });
  }
}
