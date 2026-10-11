import { describe, expect, it } from 'vitest';
import { bodyTokens, coveredByAgendaPortal, mergeItems, type PortalEvent } from '../src/console/calendarMerge';
import type { MeetingSummary } from '../src/types/models';

const m = (id: string, date: string, body: string): MeetingSummary => ({ id, slug: id, title: body, governmentBodyId: null, governmentBodyName: body, meetingType: 'regular', date, startTime: '18:00', location: null, status: 'scheduled', agendaDocumentId: null, packetDocumentId: null, minutesDocumentId: null, minutesStatus: 'not_available', sourceIds: [], agendaItemCount: 0, hasVideo: false, hasAudio: false, hasTranscript: false }) as unknown as MeetingSummary;
const e = (id: string, start: string, title: string): PortalEvent => ({ id, title, category: 'Meetings', start, end: null, allDay: false, location: null, description: null, url: '' });

describe('calendar follows the agenda portal for a body’s meetings', () => {
  it('names bodies by their distinctive words', () => {
    expect(bodyTokens('ARCH Commission')).toEqual(['arch']);
    expect(bodyTokens('City Council')).toEqual(['council']);
    expect(bodyTokens('Redevelopment Agency')).toEqual(['redevelopment']);
  });

  it('drops the website’s ARCH Oct 15 slot when CivicClerk lists ARCH on Oct 29', () => {
    const meetings = [m('mtg_cc_1711', '2026-10-29', 'ARCH Commission'), m('mtg_cc_1443', '2026-10-13', 'City Council')];
    const items = mergeItems(meetings, [e('city-215-2026-10-15', '2026-10-15T18:00:00', 'ARCH Commission Meeting'), e('city-169', '2026-10-16T09:00:00', 'Library Story Time')]);
    expect(items.map((i) => i.key)).toEqual(['mtg_cc_1443', 'city-169', 'mtg_cc_1711']);
    expect(coveredByAgendaPortal('ARCH Commission Meeting', '2026-10-15', meetings)).toBe(true);
    expect(coveredByAgendaPortal('Active Transportation Commission Meeting', '2026-10-08', meetings)).toBe(false);
  });
});
