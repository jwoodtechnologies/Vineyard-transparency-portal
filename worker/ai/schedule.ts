/**
 * "When is the next City Council meeting?" is answered from the schedule, not from old minutes:
 * the city's official calendar first, then the meetings the portal has on file (CivicClerk).
 * No AI call, so it is instant, exact and free.
 */
import type { Env } from '../env';
import { loadCity } from '../api/events';
import { expandCityEvents } from '../lib/cityEvents';

import { countQuestion, isRemainingQuestion, isScheduleQuestion } from './scheduleIntent';

export { countQuestion, isRemainingQuestion, isScheduleQuestion };

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

/** Meetings of a body still to come this year, from the city's official calendar. */
export async function remainingAnswer(question: string): Promise<{ text: string; event: ScheduleEvent | null } | null> {
  const body = bodyOf(question);
  const now = utahNow();
  const today = now.toISOString().slice(0, 10);
  const nowLocal = now.toISOString().slice(0, 16);
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const events = await loadCity()
    .then((raw) => expandCityEvents(raw, today, yearEnd))
    .catch(() => []);
  const list = events
    .filter((e) => body.match.test(e.title) && !/cancel/i.test(e.title) && (e.allDay ? e.start.slice(0, 10) >= today : e.start.slice(0, 16) >= nowLocal))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!list.length) return null;
  const dates = list.map((e) => when(e.start, e.allDay).replace(/, \d{4}/, ''));
  const n = list.length;
  const text = `${n} ${body.label} ${n === 1 ? 'meeting is' : 'meetings are'} left on the city's official calendar for ${today.slice(0, 4)}: ${dates.join('; ')}.`;
  const first = list[0];
  const loc = first.location ? first.location.replace(/\s+/g, ' ').trim() : null;
  return { text, event: { title: `${body.label} meeting`, start: first.start.slice(0, 16), allDay: first.allDay, location: loc, meetingId: null, source: 'city-calendar', url: first.url || 'https://www.vineyardutah.gov/calendar.php' } };
}

/** A count from the archive's own catalog, said plainly as what the archive holds. */
export async function countAnswer(env: Env, c: { type: 'resolution' | 'ordinance' | 'minutes' | 'meetings'; year: number }, question: string): Promise<string | null> {
  if (c.type === 'meetings') {
    const body = bodyOf(question);
    const r = await env.CATALOG_DB.prepare(`SELECT count(*) AS n FROM meetings WHERE coalesce(government_body_name, title) LIKE ? AND substr(meeting_date, 1, 4) = ? AND lower(coalesce(status, '')) NOT LIKE '%cancel%'`)
      .bind(`%${body.label === 'Redevelopment Agency' ? 'Redevelopment' : body.label}%`, String(c.year))
      .first<{ n: number }>()
      .catch(() => null);
    const n = Number(r?.n ?? 0);
    return n ? `The archive lists ${n} ${body.label} ${n === 1 ? 'meeting' : 'meetings'} in ${c.year}.` : null;
  }
  const r = await env.CATALOG_DB.prepare('SELECT count(DISTINCT coalesce(document_number, id)) AS n FROM documents WHERE document_type = ? AND year = ?')
    .bind(c.type, c.year)
    .first<{ n: number }>()
    .catch(() => null);
  const n = Number(r?.n ?? 0);
  if (!n) return null;
  const label = c.type === 'minutes' ? 'sets of meeting minutes' : `${c.type}s`;
  return `The archive holds ${n} ${n === 1 ? label.replace(/s$/, '') : label} from ${c.year}.`;
}
