/** Text of the city events calendar record (pure, unit-tested). */
import { CITY_CALENDAR_PAGE, type expandCityEvents } from '../lib/cityEvents';

export const day = (d: Date) => d.toISOString().slice(0, 10);

export function calendarText(items: ReturnType<typeof expandCityEvents>, from: string, to: string): string {
  const lines = [`Vineyard City events calendar, ${from} to ${to}, as published on ${CITY_CALENDAR_PAGE}.`];
  for (const e of items) {
    const when = e.allDay ? e.start.slice(0, 10) : `${e.start.slice(0, 10)} ${e.start.slice(11, 16)}`;
    lines.push(`${when} | ${e.title}${e.category ? ` | ${e.category}` : ''}${e.location ? ` | ${e.location}` : ''}`);
  }
  return lines.join('\n');
}

