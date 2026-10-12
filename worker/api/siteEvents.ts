/**
 * Events staff add to the portal's calendar (a community event the city's own calendar does not list, a special
 * meeting, a closure day). They are read with the city calendar's events by GET /api/events and look the same on
 * the calendar. Staff write them in the staff portal (worker/staff/events.ts); this file holds the table and the
 * conversion to the shape the calendar reads.
 */
import type { Env } from '../env';
import { CITY_CALENDAR_PAGE, type PortalEvent } from '../lib/cityEvents';

export interface SiteEventRow {
  id: string;
  title: string;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
  category: string;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** The calendar groups by these words (src/console/calendarMerge.ts): "meeting", "recreation", "library", "utilities", anything else is community. */
export const EVENT_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'Community', label: 'Community' },
  { key: 'Recreation', label: 'Recreation' },
  { key: 'Library', label: 'Library' },
  { key: 'Utilities', label: 'Utilities' },
  { key: 'City Meetings', label: 'Meeting' },
];

let ready: Promise<void> | null = null;
export function ensureEventTable(env: Env): Promise<void> {
  ready ??= env.CATALOG_DB.prepare(
    `CREATE TABLE IF NOT EXISTS site_events (
       id TEXT PRIMARY KEY, title TEXT NOT NULL, start_date TEXT NOT NULL, start_time TEXT, end_date TEXT, end_time TEXT, location TEXT, description TEXT, url TEXT,
       category TEXT NOT NULL DEFAULT 'Community', created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT)`,
  )
    .run()
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

/** One stored event in the calendar's shape: local times as typed, no time zone shift. */
export function toPortalEvent(r: SiteEventRow): PortalEvent {
  const allDay = !r.start_time;
  const start = `${r.start_date}T${r.start_time ?? '00:00'}:00`;
  const endDate = r.end_date ?? r.start_date;
  const end = r.end_time ? `${endDate}T${r.end_time}:00` : r.end_date && r.end_date !== r.start_date ? `${r.end_date}T${r.start_time ?? '00:00'}:00` : null;
  return {
    id: `staff-${r.id}`,
    title: r.title,
    category: r.category,
    start,
    end,
    allDay,
    location: r.location,
    description: r.description,
    url: r.url ?? `${CITY_CALENDAR_PAGE}#calendar`,
  };
}

/** Events that fall on any day between two days, both included (a multi-day event that began earlier still shows). An unreadable table means none. */
export async function siteEventsIn(env: Env, from: string, to: string): Promise<PortalEvent[]> {
  try {
    await ensureEventTable(env);
    const r = await env.CATALOG_DB.prepare("SELECT * FROM site_events WHERE start_date <= ? AND coalesce(end_date, start_date) >= ? ORDER BY start_date, coalesce(start_time, '') LIMIT 400")
      .bind(to, from)
      .all<SiteEventRow>();
    return (r.results ?? []).map(toPortalEvent);
  } catch {
    return [];
  }
}
