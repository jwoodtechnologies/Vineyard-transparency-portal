/**
 * City events calendar as a searchable record. The calendar the city website shows (Revize JSON)
 * is expanded for the coming 120 days and stored as one text record, versioned whenever it
 * changes, so chat can answer "what's happening" questions with a citation.
 */
import type { Env } from '../env';
import { Budget } from '../admin/routes';
import { loadCity } from '../api/events';
import { CITY_CALENDAR_PAGE, expandCityEvents } from '../lib/cityEvents';
import { indexRecord, sha256Hex } from './ingest';
import { urlKey } from './urls';
import { calendarText, day } from './calendarText';

export { calendarText };

export async function syncCalendar(env: Env, budget: Budget): Promise<Record<string, unknown>> {
  const now = new Date();
  const from = day(now);
  const to = day(new Date(now.getTime() + 120 * 86400_000));
  const items = expandCityEvents(await loadCity(), from, to);
  const text = calendarText(items, from, to);
  // The record changes only when the published events change, not every day the window moves.
  const sha = await sha256Hex(JSON.stringify(items.map((e) => [e.id, e.title, e.start, e.location])));
  const r = await indexRecord(
    env,
    {
      key: await urlKey(CITY_CALENDAR_PAGE),
      sourceId: 'vineyard-city-website',
      url: CITY_CALENDAR_PAGE,
      meta: { kind: 'web_page', documentType: 'other', title: 'Vineyard City events calendar' },
      title: 'Vineyard City events calendar',
      documentType: 'other',
      mime: 'text/html',
      fileName: 'Vineyard City events calendar.html',
      bytes: null,
      ext: 'html',
      sha,
      pages: [{ number: null, text }],
      pageCount: null,
      textStatus: 'extracted',
      ocrStatus: 'not_required',
    },
    budget,
  );
  return { events: items.length, status: r.status };
}
