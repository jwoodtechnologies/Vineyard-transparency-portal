/**
 * Calendar merge: one list of CivicClerk meetings and city calendar events (pure, unit-tested).
 */
import type { MeetingSummary } from '@/types/models';

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
  | { kind: 'meeting'; key: string; date: string; time: string | null; m: MeetingSummary; cityTime?: string | null }
  | { kind: 'event'; key: string; date: string; time: string | null; e: PortalEvent };

const MEETING_WORDS = /council|planning|commission|redevelopment|youth|board|committee|coalition|arch|transportation|appeals|hearing/g;

const GENERIC = new Set(['city', 'vineyard', 'meeting', 'meetings', 'regular', 'special', 'joint', 'board', 'commission', 'committee', 'agency', 'the', 'of', 'and', 'for']);

/** Distinctive words of a body name: "ARCH Commission" -> ["arch"], "City Council" -> ["council"]. */
export function bodyTokens(name: string): string[] {
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  const own = words.filter((w) => !GENERIC.has(w));
  return own.length ? own : words.filter((w) => w !== 'city' && w !== 'vineyard');
}

/** True when CivicClerk lists meetings of the same body within 45 days of `date` (but not on it). */
export function coveredByAgendaPortal(title: string, date: string, meetings: MeetingSummary[]): boolean {
  const t = title.toLowerCase();
  const day = Date.parse(`${date}T12:00:00Z`);
  return meetings.some((m) => {
    if (!m.governmentBodyName) return false;
    const tokens = bodyTokens(m.governmentBodyName);
    if (!tokens.length || !tokens.every((w) => new RegExp(`\\b${w}\\b`).test(t))) return false;
    return Math.abs(Date.parse(`${m.date}T12:00:00Z`) - day) <= 45 * 86_400_000;
  });
}

/**
 * One list of meetings and events, sorted by date and time. City-calendar copies of meetings that
 * CivicClerk already lists (same day, same body) are dropped so nothing shows twice.
 */
export function mergeItems(meetings: MeetingSummary[], events: PortalEvent[]): CalItem[] {
  const byDate = new Map<string, MeetingSummary[]>();
  for (const m of meetings) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  // The city keeps two calendars (the agenda portal and its website). When they give one meeting two
  // different start times, the website's time is kept so the calendar can show both.
  const cityTime = new Map<string, string>();
  const extra: CalItem[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const date = e.start.slice(0, 10);
    const time = e.allDay ? null : e.start.slice(11, 16);
    if (categoryOf(e) === 'meetings') {
      const words = e.title.toLowerCase().match(MEETING_WORDS) ?? [];
      const same = (byDate.get(date) ?? []).find((m) => {
        const t = `${m.title} ${m.governmentBodyName ?? ''}`.toLowerCase();
        return words.some((w) => t.includes(w)) || (time != null && m.startTime === time);
      });
      if (same) {
        const sameBody = words.some((w) => `${same.title} ${same.governmentBodyName ?? ''}`.toLowerCase().includes(w));
        if (sameBody && time && same.startTime && time !== same.startTime.slice(0, 5) && !/cancel/i.test(`${e.title} ${same.title}`)) cityTime.set(same.id, time);
        continue;
      }
      // The agenda portal (CivicClerk) is the record of a body's meetings. When it lists that body's
      // meetings around this date but not on it, the website calendar's entry (often a standing
      // monthly slot) is not shown, so the calendar matches the city's agenda records.
      if (coveredByAgendaPortal(e.title, date, meetings)) continue;
    }
    extra.push({ kind: 'event', key: e.id, date, time, e });
  }
  const items: CalItem[] = [...meetings.map((m): CalItem => ({ kind: 'meeting', key: m.id, date: m.date, time: m.startTime, m, cityTime: cityTime.get(m.id) ?? null })), ...extra];
  return items.sort((a, b) => (a.date + (a.time ?? '00:00')).localeCompare(b.date + (b.time ?? '00:00')));
}
