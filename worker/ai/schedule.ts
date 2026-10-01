/**
 * "When is the next City Council meeting?" is answered from the schedule, not from old minutes:
 * the city's official calendar first, then the meetings the portal has on file (CivicClerk).
 * No AI call, so it is instant, exact and free.
 */
import type { Env } from '../env';
import { loadCity } from '../api/events';
import { expandCityEvents, type PortalEvent } from '../lib/cityEvents';
import type { TimeFrame } from './timeframe';

import { countKind, isMeetingCountQuestion, isScheduleQuestion } from './scheduleIntent';

export { countKind, isMeetingCountQuestion, isScheduleQuestion };

function bodyOf(q: string): { label: string; match: RegExp } {
  if (/planning commission/i.test(q)) return { label: 'Planning Commission', match: /planning commission/i };
  if (/\bRDA\b|redevelopment/i.test(q)) return { label: 'Redevelopment Agency', match: /redevelopment|\bRDA\b/i };
  if (/\barch\b|architect/i.test(q)) return { label: 'ARCH Commission', match: /\bARCH\b/i };
  return { label: 'City Council', match: /city council|council meeting/i };
}

const utahNow = () => new Date(Date.now() - 6 * 3600_000);

function when(local: string, allDay = false): string {
  const [d, t] = local.split('T');
  const date = new Date(`${d}T12:00:00Z`);
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (allDay || !t) return day;
  const [h, m] = t.split(':').map(Number);
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return `${day} at ${time}`;
}

/** What the answer card shows: the meeting, when and where, with links. */
export interface ScheduleEvent {
  title: string;
  start: string; // Vineyard local time, YYYY-MM-DDTHH:MM or YYYY-MM-DD
  allDay: boolean;
  location: string | null;
  meetingId: string | null;
  source: 'city-calendar' | 'meeting-portal';
  url: string;
}

export interface ScheduleAnswer {
  text: string;
  meetingId: string | null;
  event: ScheduleEvent;
}

export async function scheduleAnswer(env: Env, question: string): Promise<ScheduleAnswer | null> {
  const body = bodyOf(question);
  const now = utahNow();
  const today = now.toISOString().slice(0, 10);
  const nowLocal = now.toISOString().slice(0, 16);
  const to = new Date(now.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);

  const [events, meeting] = await Promise.all([
    loadCity()
      .then((raw) => expandCityEvents(raw, today, to))
      .catch(() => []),
    env.CATALOG_DB.prepare(
      `SELECT id, title, meeting_date, start_time, location FROM meetings
       WHERE coalesce(government_body_name, title) LIKE ? AND meeting_date >= ? AND lower(coalesce(status, '')) NOT LIKE '%cancel%'
       ORDER BY meeting_date ASC, start_time ASC LIMIT 1`,
    )
      .bind(`%${body.label === 'Redevelopment Agency' ? 'Redevelopment' : body.label}%`, today)
      .first<{ id: string; title: string; meeting_date: string; start_time: string | null; location: string | null }>()
      .catch(() => null),
  ]);

  const ev = events
    .filter((e) => body.match.test(e.title) && !/cancel/i.test(e.title) && (e.allDay ? e.start.slice(0, 10) >= today : e.start.slice(0, 16) >= nowLocal))
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  const evDate = ev?.start.slice(0, 10) ?? null;
  const mDate = meeting?.meeting_date ? meeting.meeting_date.slice(0, 10) : null;
  // The earlier of the two; the city calendar wins a tie (it carries the time and place).
  if (ev && (!mDate || evDate! <= mDate)) {
    const loc = ev.location ? ev.location.replace(/\s+/g, ' ').trim() : null;
    const meetingId = meeting && mDate === evDate ? meeting.id : null;
    return {
      text: `The next ${body.label} meeting is ${when(ev.start, ev.allDay)}${loc ? ` at ${loc}` : ''}, according to the city's official calendar.`,
      meetingId,
      event: { title: `${body.label} meeting`, start: ev.start.slice(0, 16), allDay: ev.allDay, location: loc, meetingId, source: 'city-calendar', url: ev.url || 'https://www.vineyardutah.gov/calendar.php' },
    };
  }
  if (meeting && mDate) {
    const time = meeting.start_time && /^\d{1,2}:\d{2}/.test(meeting.start_time) ? `${mDate}T${meeting.start_time.slice(0, 5)}` : mDate;
    const loc = meeting.location ? meeting.location.replace(/\s+/g, ' ').trim() : null;
    return {
      text: `The next ${body.label} meeting is ${when(time)}${loc ? ` at ${loc}` : ''}, according to the city's meeting portal.`,
      meetingId: meeting.id,
      event: { title: `${body.label} meeting`, start: time, allDay: !time.includes('T'), location: loc, meetingId: meeting.id, source: 'meeting-portal', url: 'https://vineyardut.portal.civicclerk.com/' },
    };
  }
  return null;
}

/**
 * "How many council meetings are left this year / next year / in 2025?": meetings already held
 * come from the archive, meetings ahead come from the city's official calendar. When the calendar
 * lists none yet (next year, often), the answer says so instead of guessing.
 */
export async function meetingsInFrame(env: Env, question: string, frame: TimeFrame | null): Promise<{ text: string; event: ScheduleEvent | null } | null> {
  const body = bodyOf(question);
  const now = utahNow();
  const today = now.toISOString().slice(0, 10);
  const nowLocal = now.toISOString().slice(0, 16);
  const Y = Number(today.slice(0, 4));
  const onlyAhead = /\b(left|remaining|rest of|still|upcoming|coming up|more)\b/i.test(question);
  const win = frame ?? { from: `${Y}-01-01`, to: `${Y}-12-31`, label: String(Y), future: false };
  const label = win.label;

  // Ahead: the official calendar.
  let ahead: PortalEvent[] = [];
  if (win.to >= today) {
    const from = win.from > today ? win.from : today;
    ahead = await loadCity()
      .then((raw) => expandCityEvents(raw, from, win.to))
      .catch(() => [] as PortalEvent[]);
    ahead = ahead
      .filter((e) => body.match.test(e.title) && !/cancel/i.test(e.title) && (e.allDay ? e.start.slice(0, 10) >= today : e.start.slice(0, 16) >= nowLocal))
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  // Held: the archive's meetings (CivicClerk and the code site), within the window and before today.
  let held = 0;
  if (!onlyAhead && win.from < today) {
    const end = win.to < today ? win.to : addDay(today, -1);
    const r = await env.CATALOG_DB.prepare(
      `SELECT count(DISTINCT substr(meeting_date, 1, 10)) AS n FROM meetings WHERE coalesce(government_body_name, title) LIKE ? AND substr(meeting_date, 1, 10) BETWEEN ? AND ? AND lower(coalesce(status, '')) NOT LIKE '%cancel%'`,
    )
      .bind(`%${body.label === 'Redevelopment Agency' ? 'Redevelopment' : body.label}%`, win.from, end)
      .first<{ n: number }>()
      .catch(() => null);
    held = Number(r?.n ?? 0);
  }

  const n = ahead.length;
  const dates = ahead.map((e) => when(e.start, e.allDay).replace(/, \d{4}/, ''));
  const first = ahead[0];
  const event: ScheduleEvent | null = first
    ? { title: `${body.label} meeting`, start: first.start.slice(0, 16), allDay: first.allDay, location: first.location ? first.location.replace(/\s+/g, ' ').trim() : null, meetingId: null, source: 'city-calendar', url: first.url || 'https://www.vineyardutah.gov/calendar.php' }
    : null;
  const list = n ? `: ${dates.slice(0, 12).join('; ')}${n > 12 ? '; and more' : ''}` : '';

  if (win.from > today || onlyAhead) {
    if (!n) return { text: `The city's official calendar does not list any ${body.label} meetings for ${label} yet.`, event: null };
    return { text: `The city's official calendar lists ${n} ${body.label} ${n === 1 ? 'meeting' : 'meetings'} ${onlyAhead && win.to >= today && win.from <= today ? `left in ${label}` : `for ${label}`}${list}.`, event };
  }
  if (win.to < today) {
    if (!held) return { text: `The archive has no ${body.label} meetings on file for ${label}.`, event: null };
    return { text: `The archive lists ${held} ${body.label} ${held === 1 ? 'meeting' : 'meetings'} held in ${label}.`, event: null };
  }
  // A window that includes today: held so far plus scheduled ahead.
  const parts = [`${held} ${body.label} ${held === 1 ? 'meeting has' : 'meetings have'} been held so far in ${label}`];
  parts.push(n ? `and the city's official calendar lists ${n} more${list}` : `and the city's official calendar lists no more for ${label}`);
  return { text: `${parts.join(', ')}.`, event };
}

const addDay = (s: string, d: number) => new Date(Date.parse(`${s}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/** A count from the archive's own catalog for a time window, said plainly as what the archive holds. */
export async function countAnswer(env: Env, type: 'resolution' | 'ordinance' | 'minutes', frame: TimeFrame): Promise<string> {
  const r = await env.CATALOG_DB.prepare(
    `SELECT count(DISTINCT coalesce(document_number, id)) AS n FROM documents
     WHERE document_type = ? AND ((document_date BETWEEN ? AND ?) OR (document_date IS NULL AND year BETWEEN ? AND ?))`,
  )
    .bind(type, frame.from, frame.to, Number(frame.from.slice(0, 4)), Number(frame.to.slice(0, 4)))
    .first<{ n: number }>()
    .catch(() => null);
  const n = Number(r?.n ?? 0);
  const label = type === 'minutes' ? 'sets of meeting minutes' : `${type}s`;
  if (!n) return `The archive has no ${label} on file for ${frame.label}.`;
  return `The archive holds ${n} ${n === 1 ? label.replace(/s$/, '') : label} from ${frame.label}.`;
}
