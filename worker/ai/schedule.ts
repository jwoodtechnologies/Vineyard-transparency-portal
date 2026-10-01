/**
 * "When is the next City Council meeting?" is answered from the schedule, not from old minutes:
 * the city's official calendar first, then the meetings the portal has on file (CivicClerk).
 * No AI call, so it is instant, exact and free.
 */
import type { Env } from '../env';
import { loadCity } from '../api/events';
import { expandCityEvents } from '../lib/cityEvents';

import { isScheduleQuestion } from './scheduleIntent';

export { isScheduleQuestion };

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

export interface ScheduleAnswer {
  text: string;
  meetingId: string | null;
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
  const mDate = meeting?.meeting_date ?? null;
  // The earlier of the two; the city calendar wins a tie (it carries the time and place).
  if (ev && (!mDate || evDate! <= mDate)) {
    const place = ev.location ? ` at ${ev.location.replace(/\s+/g, ' ').trim()}` : '';
    return {
      text: `The next ${body.label} meeting is ${when(ev.start, ev.allDay)}${place}, according to the city's official calendar.`,
      meetingId: meeting && mDate === evDate ? meeting.id : null,
    };
  }
  if (meeting && mDate) {
    const time = meeting.start_time && /^\d{1,2}:\d{2}/.test(meeting.start_time) ? `${mDate}T${meeting.start_time.slice(0, 5)}` : mDate;
    const place = meeting.location ? ` at ${meeting.location.replace(/\s+/g, ' ').trim()}` : '';
    return { text: `The next ${body.label} meeting is ${when(time)}${place}, according to the city's meeting portal.`, meetingId: meeting.id };
  }
  return null;
}
