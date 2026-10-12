/** Shapes and small helpers for the staff Events screen. */
import { todayIso } from './votesLib';

export interface EventItem {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  url: string | null;
  category: string;
  past: boolean;
  createdBy: string | null;
  updatedAt: string;
}

export interface EventCategory {
  key: string;
  label: string;
}

export interface EventsReply {
  today: string;
  items: EventItem[];
  categories: EventCategory[];
}

export interface EventDraft {
  title: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  endDate: string;
  location: string;
  description: string;
  url: string;
  category: string;
}

export const DESCRIPTION_MAX = 1000;

export const emptyEvent = (today: string = todayIso()): EventDraft => ({
  title: '',
  date: today,
  allDay: false,
  startTime: '',
  endTime: '',
  endDate: '',
  location: '',
  description: '',
  url: '',
  category: 'Community',
});

export const draftOf = (e: EventItem): EventDraft => ({
  title: e.title,
  date: e.date,
  allDay: e.allDay,
  startTime: e.startTime ?? '',
  endTime: e.endTime ?? '',
  endDate: e.endDate ?? '',
  location: e.location ?? '',
  description: e.description ?? '',
  url: e.url ?? '',
  category: e.category,
});

/** What the server is sent: an all day event carries no times. */
export const bodyOf = (d: EventDraft) => ({
  title: d.title,
  date: d.date,
  allDay: d.allDay,
  startTime: d.allDay ? '' : d.startTime,
  endTime: d.allDay ? '' : d.endTime,
  endDate: d.endDate,
  location: d.location,
  description: d.description,
  url: d.url,
  category: d.category,
});

/** The same checks the server makes. Empty means fine. */
export function checkEvent(d: EventDraft): string {
  if (!d.title.replace(/\s+/g, ' ').trim()) return 'Write the name of the event.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Choose the date.';
  if (d.endDate && d.endDate < d.date) return 'The last day is before the first day.';
  if (!d.allDay && d.endTime && !d.startTime) return 'Choose a start time, or leave the end time blank.';
  if (!d.allDay && d.startTime && d.endTime && (!d.endDate || d.endDate === d.date) && d.endTime < d.startTime) return 'The end time is before the start time.';
  if (d.description.length > DESCRIPTION_MAX) return `Keep the details under ${DESCRIPTION_MAX} characters.`;
  const link = d.url.trim();
  if (link) {
    try {
      const u = new URL(link.includes('://') ? link : `https://${link}`);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'That web address does not look right.';
    } catch {
      return 'That web address does not look right.';
    }
  }
  return '';
}

/** "2:30 PM" from "14:30". */
export function clock(hhmm: string | null | undefined): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Oct 24, 2026 · 10:00 AM to 2:30 PM", "Oct 19, 2026 to Oct 23, 2026" or "Nov 26, 2026 · All day". */
export function whenOf(e: Pick<EventItem, 'date' | 'endDate' | 'startTime' | 'endTime' | 'allDay'>, day: (iso: string) => string): string {
  const span = e.endDate && e.endDate !== e.date ? `${day(e.date)} to ${day(e.endDate)}` : day(e.date);
  if (e.allDay || !e.startTime) return e.endDate && e.endDate !== e.date ? span : `${span} · All day`;
  return `${span} · ${clock(e.startTime)}${e.endTime ? ` to ${clock(e.endTime)}` : ''}`;
}
