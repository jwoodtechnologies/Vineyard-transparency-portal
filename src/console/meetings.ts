/** Meeting schedule data: loads a whole year of meetings at a time and caches it for the session. */
import { useEffect, useState } from 'react';
import type { GovernmentBody, MeetingSummary } from '@/types/models';
import { BrowseService, MeetingService } from '@/services';

const years = new Map<number, Promise<MeetingSummary[]>>();

async function fetchYear(year: number): Promise<MeetingSummary[]> {
  // First page tells us the total; any remaining pages load in parallel.
  const first = await MeetingService.list({ year, page: 1, pageSize: 100, sort: 'date_asc' });
  const pages = Math.min(30, Math.ceil(first.total / 100));
  if (pages <= 1) return first.items;
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => MeetingService.list({ year, page: i + 2, pageSize: 100, sort: 'date_asc' })));
  return [first, ...rest].flatMap((r) => r.items);
}

export function loadYear(year: number): Promise<MeetingSummary[]> {
  let p = years.get(year);
  if (!p) {
    p = fetchYear(year).catch((e: unknown) => {
      years.delete(year);
      throw e;
    });
    years.set(year, p);
  }
  return p;
}

export type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'done'; data: T };

/** Loads the given years (deduplicated, cached) and returns their meetings sorted by date and time. */
export function useMeetings(yearList: number[]): Load<MeetingSummary[]> {
  const key = [...new Set(yearList)].sort().join(',');
  const [state, setState] = useState<{ key: string; value: Load<MeetingSummary[]> }>({ key: '', value: { status: 'loading' } });
  useEffect(() => {
    let live = true;
    const ys = key ? key.split(',').map(Number) : [];
    Promise.all(ys.map(loadYear)).then(
      (lists) => live && setState({ key, value: { status: 'done', data: lists.flat().sort(byWhen) } }),
      () => live && setState({ key, value: { status: 'error' } }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state.key === key ? state.value : { status: 'loading' };
}

let bodiesPromise: Promise<GovernmentBody[]> | null = null;
export function useBodies(): GovernmentBody[] {
  const [bodies, setBodies] = useState<GovernmentBody[]>([]);
  useEffect(() => {
    let live = true;
    bodiesPromise ??= BrowseService.bodies().catch(() => {
      bodiesPromise = null;
      return [];
    });
    void bodiesPromise.then((b) => live && setBodies(b));
    return () => {
      live = false;
    };
  }, []);
  return bodies;
}

export const byWhen = (a: MeetingSummary, b: MeetingSummary) => (a.date + (a.startTime ?? '')).localeCompare(b.date + (b.startTime ?? ''));

/** Today in Vineyard (America/Denver), as YYYY-MM-DD. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function formatTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

const LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const utc = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export const longDate = (iso: string) => LONG.format(utc(iso));
export const dayMonth = (iso: string) => DAY_MONTH.format(utc(iso));
export const monthLabel = (ym: string) => MONTH.format(utc(`${ym}-01`));
export const dayNumber = (iso: string) => Number(iso.slice(8, 10));
export const monthShort = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(utc(iso));
export const weekdayShort = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(utc(iso));

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Six-week grid (Sunday first) for a YYYY-MM month: ISO dates, with the month flag. */
export function monthGrid(ym: string): Array<{ iso: string; inMonth: boolean }> {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const cells: Array<{ iso: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push({ iso: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === m - 1 });
  }
  // Drop a trailing week that is entirely next month.
  return cells.slice(35).every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
}

const TONES: Record<string, number> = { 'city-council': 0, 'planning-commission': 1, 'redevelopment-agency': 2 };
export function toneOf(bodyId: string | null | undefined): number {
  if (!bodyId) return 5;
  if (bodyId in TONES) return TONES[bodyId];
  let h = 0;
  for (const ch of bodyId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 3 + (h % 3);
}

export function meetingHref(m: Pick<MeetingSummary, 'id'>): string {
  return `/meetings/${encodeURIComponent(m.id)}`;
}

export const statusLabel = (m: Pick<MeetingSummary, 'status' | 'date'>, today: string): string | null =>
  m.status === 'cancelled' ? 'Cancelled' : m.status === 'postponed' ? 'Postponed' : m.date >= today ? 'Upcoming' : null;

/** Pull a readable agenda outline ("1. CALL TO ORDER", "3.1 Discussion of ...") out of agenda text. */
export interface OutlineItem {
  number: string;
  title: string;
  detail: string | null;
  depth: number;
}
const ITEM = /^\s*((?:\d{1,2}|[A-Z])(?:\.\d{1,2}){0,3})[.)]?\s+(\S.{2,})$/;
const BARE_NUMBER = /^\s*(\d{1,2}(?:\.\d{1,2}){0,3})[.)]?\s*$/;
export function agendaOutline(text: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let pending: string | null = null; // a number that sat alone on its line ("5.") waiting for its title
  const push = (number: string, raw: string) => {
    const title = raw.replace(/\s*\.{3,}\s*\d*$/, '').trim();
    out.push({ number, title: title.length > 220 ? `${title.slice(0, 217)}...` : title, detail: null, depth: number.split('.').length - 1 });
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const bare = BARE_NUMBER.exec(line);
    if (bare) {
      // Only a number that continues the outline counts; a lone "3" can also be a page number.
      const tops = out.filter((o) => o.depth === 0).map((o) => Number(o.number));
      const lastTop = tops.length ? tops[tops.length - 1] : 0;
      const n = bare[1];
      const ok = n.includes('.') ? Number(n.split('.')[0]) === lastTop : Number(n) === lastTop + 1 || (lastTop === 0 && Number(n) <= 2) || Number(n) === lastTop + 2;
      pending = ok ? n : null;
      continue;
    }
    if (pending) {
      push(pending, line);
      pending = null;
      continue;
    }
    const m = ITEM.exec(line);
    if (m && !/^\d{1,2}\s+(am|pm)\b/i.test(line)) {
      push(m[1], m[2]);
    } else if (out.length) {
      const last = out[out.length - 1];
      const heading = line.length < 60 && line === line.toUpperCase() && /[A-Z]/.test(line);
      if (!last.detail && !heading && line.length > 12 && line.length < 400 && !/^page \d+/i.test(line)) last.detail = line;
    }
  }
  return out.length >= 2 ? out.slice(0, 80) : [];
}

// ------------------------------------------------------------------ community events

/** A Vineyard City calendar event (community, recreation, library, utilities, city meetings). */
export interface PortalEvent {
  id: string;
  title: string;
  category: string;
  start: string; // local ISO
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  url: string;
}

const eventYears = new Map<number, Promise<PortalEvent[]>>();
const eventsEnabled = import.meta.env.VITE_DATA_MODE === 'api';

export function loadEventYear(year: number): Promise<PortalEvent[]> {
  if (!eventsEnabled) return Promise.resolve([]);
  let p = eventYears.get(year);
  if (!p) {
    p = fetch(`/api/events?from=${year}-01-01&to=${year}-12-31`)
      .then((r) => (r.ok ? (r.json() as Promise<{ items?: PortalEvent[] }>) : { items: [] }))
      .then((j) => j.items ?? [])
      .catch(() => {
        eventYears.delete(year);
        return [] as PortalEvent[];
      });
    eventYears.set(year, p);
  }
  return p;
}

/** Events for the given years. Never blocks the calendar: failures resolve to no events. */
export function useEvents(yearList: number[]): PortalEvent[] | null {
  const key = [...new Set(yearList)].sort().join(',');
  const [state, setState] = useState<{ key: string; items: PortalEvent[] | null }>({ key: '', items: null });
  useEffect(() => {
    let live = true;
    const ys = key ? key.split(',').map(Number) : [];
    void Promise.all(ys.map(loadEventYear)).then((lists) => live && setState({ key, items: lists.flat() }));
    return () => {
      live = false;
    };
  }, [key]);
  return state.key === key ? state.items : null;
}

export type CategoryId = 'meetings' | 'community' | 'recreation' | 'library' | 'utilities';
export const CATEGORIES: Array<{ id: CategoryId; label: string; tone: number }> = [
  { id: 'meetings', label: 'Meetings', tone: 0 },
  { id: 'community', label: 'Community', tone: 3 },
  { id: 'recreation', label: 'Recreation', tone: 2 },
  { id: 'library', label: 'Library', tone: 7 },
  { id: 'utilities', label: 'Utilities', tone: 5 },
];

export function categoryOf(e: PortalEvent): CategoryId {
  const c = e.category.toLowerCase();
  if (c.includes('meeting')) return 'meetings';
  if (c.includes('recreation') || c.includes('sport')) return 'recreation';
  if (c.includes('library')) return 'library';
  if (c.includes('utilit') || c.includes('trash') || c.includes('waste')) return 'utilities';
  return 'community';
}

export const eventTone = (e: PortalEvent) => (categoryOf(e) === 'meetings' ? 4 : (CATEGORIES.find((c) => c.id === categoryOf(e))?.tone ?? 3));

export type CalItem =
  | { kind: 'meeting'; key: string; date: string; time: string | null; m: MeetingSummary }
  | { kind: 'event'; key: string; date: string; time: string | null; e: PortalEvent };

const MEETING_WORDS = /council|planning|commission|redevelopment|youth|board|committee|coalition|arch|transportation|appeals|hearing/g;

/**
 * One list of meetings and events, sorted by date and time. City-calendar copies of meetings that
 * CivicClerk already lists (same day, same body) are dropped so nothing shows twice.
 */
export function mergeItems(meetings: MeetingSummary[], events: PortalEvent[]): CalItem[] {
  const byDate = new Map<string, MeetingSummary[]>();
  for (const m of meetings) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  const items: CalItem[] = meetings.map((m) => ({ kind: 'meeting', key: m.id, date: m.date, time: m.startTime, m }));
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const date = e.start.slice(0, 10);
    const time = e.allDay ? null : e.start.slice(11, 16);
    if (categoryOf(e) === 'meetings') {
      const words = e.title.toLowerCase().match(MEETING_WORDS) ?? [];
      const same = (byDate.get(date) ?? []).some((m) => {
        const t = `${m.title} ${m.governmentBodyName ?? ''}`.toLowerCase();
        return words.some((w) => t.includes(w)) || (time != null && m.startTime === time);
      });
      if (same) continue;
    }
    items.push({ kind: 'event', key: e.id, date, time, e });
  }
  return items.sort((a, b) => (a.date + (a.time ?? '00:00')).localeCompare(b.date + (b.time ?? '00:00')));
}
