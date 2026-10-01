/** The meeting card under a "when is the next meeting" answer: date, time, place and links. */
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarPlus, MapPin } from 'lucide-react';

export interface AnswerEvent {
  title: string;
  start: string;
  allDay: boolean;
  location: string | null;
  meetingId: string | null;
  source: 'city-calendar' | 'meeting-portal';
  url: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** An .ics file for the meeting (Vineyard local time, one hour long). */
function icsHref(e: AnswerEvent): string {
  const [d, t = '18:00'] = e.start.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const start = e.allDay ? `${y}${pad(m)}${pad(day)}` : `${y}${pad(m)}${pad(day)}T${pad(h)}${pad(min)}00`;
  const end = e.allDay ? start : `${y}${pad(m)}${pad(day)}T${pad(h + 1)}${pad(min)}00`;
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vineyard Transparency Portal//EN',
    'BEGIN:VEVENT',
    `UID:${start}-${e.title.replace(/\W+/g, '-')}@vineyardportal.org`,
    e.allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART;TZID=America/Denver:${start}`,
    e.allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND;TZID=America/Denver:${end}`,
    `SUMMARY:${esc(`Vineyard ${e.title}`)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    `URL:${e.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

export function EventCard({ event }: { event: AnswerEvent }) {
  const [d, t] = event.start.split('T');
  const date = new Date(`${d}T12:00:00Z`);
  const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const day = date.getUTCDate();
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  let time = '';
  if (!event.allDay && t) {
    const [h, m] = t.split(':').map(Number);
    time = `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`;
  }
  return (
    <div className="vc-event">
      <div className="vc-event-date" aria-hidden="true">
        <span className="vc-event-month">{month}</span>
        <span className="vc-event-day">{day}</span>
      </div>
      <div className="vc-event-main">
        <span className="vc-event-title">{event.title}</span>
        <span className="vc-event-when">{[weekday, time].filter(Boolean).join(' · ')}</span>
        {event.location && (
          <a className="vc-event-where" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`} target="_blank" rel="noopener noreferrer">
            <MapPin size={13} /> {event.location}
          </a>
        )}
        <span className="vc-event-actions">
          <a className="vc-chip" href={icsHref(event)} download="vineyard-meeting.ics">
            <CalendarPlus size={13} /> Add to calendar
          </a>
          {event.meetingId ? (
            <Link className="vc-chip" to={`/meetings/${encodeURIComponent(event.meetingId)}`}>
              <ArrowUpRight size={13} /> Agenda and details
            </Link>
          ) : (
            <Link className="vc-chip" to="/meetings">
              <ArrowUpRight size={13} /> All meetings
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
