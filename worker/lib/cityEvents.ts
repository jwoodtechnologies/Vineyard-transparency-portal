/** Pure transformation of the city calendar feed into portal events (no platform types). */
import { expandRecurrence } from './rrule';

export const CITY_CALENDAR_PAGE = 'https://www.vineyardutah.gov/calendar.php';

export interface CityEvent {
  id?: string;
  rid?: string;
  title?: string;
  primary_calendar_name?: string;
  start?: string;
  end?: string;
  duration?: string;
  allDay?: boolean;
  location?: string;
  desc?: string;
  url?: string;
  rrule?: string;
}

export interface PortalEvent {
  id: string;
  title: string;
  category: string;
  start: string; // local ISO, e.g. 2026-10-14T18:00:00
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  url: string;
}

const HIDDEN_CATEGORIES = /revize|training|test/i;

function clean(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  let t = s;
  try {
    if (/%[0-9A-F]{2}/i.test(t)) t = decodeURIComponent(t);
  } catch {
    /* not URL-encoded */
  }
  t = t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return t ? t.slice(0, max) : null;
}

const durationMs = (d: string | undefined) => {
  const m = /^(\d+):(\d{2})/.exec(d ?? '');
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 60_000 : 0;
};

function shiftLocal(iso: string, ms: number): string {
  const t = new Date(`${iso.slice(0, 19)}Z`).getTime() + ms;
  return new Date(t).toISOString().slice(0, 19);
}

export function expandCityEvents(raw: CityEvent[], from: string, to: string): PortalEvent[] {
  const out: PortalEvent[] = [];
  for (const e of raw) {
    const category = (e.primary_calendar_name ?? 'Community').trim() || 'Community';
    if (HIDDEN_CATEGORIES.test(category)) continue;
    const title = clean(e.title, 200);
    if (!title || !e.start) continue;
    const start = e.start.slice(0, 19);
    const length = e.end ? new Date(`${e.end.slice(0, 19)}Z`).getTime() - new Date(`${start}Z`).getTime() : durationMs(e.duration);
    const starts = e.rrule ? expandRecurrence(e.rrule, from, to) : start.slice(0, 10) >= from && start.slice(0, 10) <= to ? [start] : [];
    const allDay = Boolean(e.allDay) || /T00:00:00$/.test(start) && !e.end;
    const base = {
      title,
      category,
      allDay,
      location: clean(e.location, 200),
      description: clean(e.desc, 1200),
      url: typeof e.url === 'string' && /^https?:\/\//.test(e.url) ? e.url : `${CITY_CALENDAR_PAGE}#calendar`,
    };
    for (const s of starts) {
      out.push({ ...base, id: `city-${e.id ?? e.rid ?? title}-${s.slice(0, 10)}`, start: s, end: length > 0 ? shiftLocal(s, length) : null });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

