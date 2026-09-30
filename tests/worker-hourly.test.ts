import { describe, expect, it } from 'vitest';
import { classifyType, mapEvent, pySlug } from '../worker/lib/civicclerk';
import { mentionsVineyard, releaseBody } from '../worker/lib/sheriff';

describe('CivicClerk mapping (mirrors ingest/adapters/civicclerk.py)', () => {
  it('maps an event, its body and its files with the same ids and metadata keys', () => {
    const m = mapEvent(
      {
        id: 1660,
        eventName: 'City Council',
        agendaName: 'City Council Regular Meeting',
        categoryName: 'City Council',
        startDateTime: '2026-10-14T18:00:00Z',
        isPublished: 'Published',
        eventLocation: { address1: '125 S Main St', city: 'Vineyard', state: 'UT' },
        publishedFiles: [
          { fileId: 9001, type: 'Agenda', name: 'Agenda 10-14-2026', url: 'https://x/y/agenda.pdf', publishOn: '2026-10-10' },
          { fileId: 9002, type: 'Staff Report', name: 'Staff Report - Parking Code' },
        ],
      },
      new Date('2026-10-01T00:00:00Z'),
    )!;
    expect(m.meeting).toMatchObject({ id: 'mtg_cc_1660', slug: 'city-council-regular-meeting-2026-10-14-1660', date: '2026-10-14', startTime: '18:00', status: 'scheduled', meetingType: 'regular', location: '125 S Main St, Vineyard, UT' });
    expect(m.body).toEqual({ id: 'city-council', name: 'City Council', kind: 'council' });
    expect(m.files[0]).toMatchObject({ identifier: 'civicclerk:vineyardut:file:9001', priority: 50 });
    expect(m.files[0].metadata).toMatchObject({ documentType: 'agenda', meetingRole: 'agenda', relationship: 'MEETING_HAS_AGENDA', fileNameHint: 'agenda.pdf' });
    expect(Object.keys(m.files[0].metadata)).toEqual(['title', 'fileType', 'documentType', 'documentDate', 'meetingId', 'meetingTitle', 'meetingRole', 'relationship', 'governmentBodyId', 'governmentBodyName', 'publishedAt', 'externalId', 'fileNameHint']);
    expect(m.files[1].metadata.documentType).toBe('staff_report');
  });

  it('marks past meetings held and skips unpublished ones', () => {
    expect(mapEvent({ id: 1, eventName: 'Planning Commission', startDateTime: '2026-09-02T18:00:00Z' }, new Date('2026-09-03T01:00:00Z'))!.meeting.status).toBe('held');
    expect(mapEvent({ id: 2, eventName: 'Draft', isPublished: 'Draft' })).toBeNull();
  });

  it('slugs and classifies like the Python side', () => {
    expect(pySlug("Mayor's Youth Council!")).toBe('mayor-s-youth-council');
    expect(classifyType('FY2027 Tentative Budget')).toBe('budget');
    expect(classifyType('Agenda Packet')).toBe('agenda_packet');
  });
});

describe('Sheriff releases', () => {
  it('reads the release body and checks for Vineyard', () => {
    const html = '<nav>menu</nav><div class="entry clearfix"><h2>SEARCH WARRANT IN VINEYARD CITY</h2><p>Deputies served a warrant.</p></div><div class="sidebar-widgets-wrap">CONTACT 3075 North Main</div>';
    const body = releaseBody(html);
    expect(body).toContain('Deputies served a warrant.');
    expect(body).not.toContain('3075 North Main');
    expect(mentionsVineyard(body)).toBe(true);
    expect(mentionsVineyard('Vineyards in Spanish Fork')).toBe(false);
  });
});
