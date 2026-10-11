import { describe, expect, it } from 'vitest';
import { compactRanges, meetingsMissingDocs, missingNumbers, parseSeriesNumbers, publicSummary, sequenceGaps, type CoverageReport, type MeetingRow } from '../worker/lib/coverage';
import { escapeXml, rfc822, rssDocument } from '../worker/lib/rss';
import { meetingItems, recordItems } from '../worker/api/feeds';

describe('ordinance and resolution numbers', () => {
  it('reads the forms the city uses', () => {
    expect(parseSeriesNumbers('ORD 2026-10 FY26 Budget Amendment')).toEqual([{ series: 'ordinance', year: 2026, seq: 10 }]);
    expect(parseSeriesNumbers('RESOLUTION NO 2026-22 Neighborhood Committee')).toEqual([{ series: 'resolution', year: 2026, seq: 22 }]);
    expect(parseSeriesNumbers('Ord_2025-18 (City Council)')).toEqual([{ series: 'ordinance', year: 2025, seq: 18 }]);
    expect(parseSeriesNumbers('RESOLUTION RDA-2026-03 RDA BUDGET')).toEqual([{ series: 'rda_resolution', year: 2026, seq: 3 }]);
    expect(parseSeriesNumbers('RDA Resolution U2026-04 Approve Triggering Parcels')).toEqual([{ series: 'rda_resolution', year: 2026, seq: 4 }]);
    expect(parseSeriesNumbers('RES U-2026-04 Triggering Parcels')).toEqual([{ series: 'rda_resolution', year: 2026, seq: 4 }]);
    expect(parseSeriesNumbers('RDA - 2026-02 Hiring Three Advisors')).toEqual([{ series: 'rda_resolution', year: 2026, seq: 2 }]);
    // A motion of the RDA board naming "Resolution 2026-02" is the RDA's series.
    expect(parseSeriesNumbers('Resolution 2026-02', 'redevelopment-agency')).toEqual([{ series: 'rda_resolution', year: 2026, seq: 2 }]);
    // "RDA" after the number is the subject, not the series.
    expect(parseSeriesNumbers('RES 2026-15 RDA Audit Agreement')).toEqual([{ series: 'resolution', year: 2026, seq: 15 }]);
  });

  it('ignores dates, fiscal years and placeholders', () => {
    expect(parseSeriesNumbers('2024-06-20 Prelim FIRM Letter', 'city-council', 'ordinance')).toEqual([]);
    expect(parseSeriesNumbers('Final Budget FY 2026-2027')).toEqual([]);
    expect(parseSeriesNumbers('RDA RES U-2026-0X Commencing Increment Collection')).toEqual([]);
    expect(parseSeriesNumbers('Utah DEM Model E Ordinance 2025 - Vineyard UT')).toEqual([]);
  });

  it('takes a bare number at the start only from an ordinance or resolution record', () => {
    expect(parseSeriesNumbers('2026-09 Amending Title 7', null, 'ordinance')).toEqual([{ series: 'ordinance', year: 2026, seq: 9 }]);
    expect(parseSeriesNumbers('2026-09 Amending Title 7', null, 'agenda')).toEqual([]);
  });
});

describe('gap computation', () => {
  it('lists every number below the highest that is never seen', () => {
    expect(missingNumbers([1, 4, 6])).toEqual([2, 3, 5]);
    expect(missingNumbers([])).toEqual([]);
    expect(compactRanges([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8');
  });

  it('counts records and motions, and flags numbers only a motion names', () => {
    const gaps = sequenceGaps([
      { text: 'Ordinance 2026-01', bodyId: 'city-council', record: true },
      { text: 'ORD 2026-06', bodyId: 'city-council', record: true },
      { text: 'Ordinance 2026-03', bodyId: 'city-council', record: false },
      { text: 'Resolution 2026-02', bodyId: 'redevelopment-agency', record: false },
    ]);
    const ord = gaps.find((g) => g.series === 'ordinance')!;
    expect(ord).toMatchObject({ year: 2026, highest: 6, seen: 3, missing: [2, 4, 5], motionOnly: [3] });
    expect(gaps.find((g) => g.series === 'rda_resolution')).toMatchObject({ highest: 2, missing: [1], motionOnly: [2] });
  });
});

describe('held meetings missing files', () => {
  const row = (over: Partial<MeetingRow>): MeetingRow => ({ id: 'm', title: 'City Council', bodyId: 'city-council', bodyName: 'City Council', date: '2026-09-01', status: 'held', has: { agenda: true, packet: true, minutes: false }, ...over });
  it('skips future, canceled, unconfirmed and notice rows, and merges two sources of one meeting', () => {
    const out = meetingsMissingDocs(
      [
        row({ id: 'a', has: { agenda: true, packet: false, minutes: false } }),
        row({ id: 'b', has: { agenda: false, packet: true, minutes: false } }),
        row({ id: 'c', date: '2026-12-01' }),
        row({ id: 'd', date: '2026-08-01', status: 'cancelled' }),
        row({ id: 'e', date: '2026-08-02', status: 'unconfirmed' }),
        row({ id: 'f', date: '2026-08-03', bodyId: 'public-notices', title: 'Public Hearing' }),
        row({ id: 'g', date: '2026-08-04', has: { agenda: true, packet: true, minutes: true } }),
      ],
      '2026-10-11',
    );
    expect(out).toEqual([{ id: 'a', title: 'City Council', bodyId: 'city-council', bodyName: 'City Council', date: '2026-09-01', missing: ['minutes'] }]);
  });

  it('public summary shows only the year asked, with padded numbers', () => {
    const r = {
      computedAt: '2026-10-11T00:00:00Z',
      today: '2026-10-11',
      counts: { sequenceGaps: 1, motionOnly: 0, meetingsMissing: 1, undated: 0, noText: 0 },
      gaps: [
        { series: 'ordinance', year: 2026, highest: 11, seen: 7, missing: [2], motionOnly: [] },
        { series: 'ordinance', year: 2025, highest: 24, seen: 20, missing: [3], motionOnly: [] },
      ],
      meetings: [{ id: 'x', title: 'PC', bodyId: 'planning-commission', bodyName: 'Planning Commission', date: '2026-10-07', missing: ['minutes'] }],
      undated: [],
      noText: [],
      listLimit: 2500,
    } as CoverageReport;
    const s = publicSummary(r, 2026);
    expect(s.sequences).toEqual([{ series: 'ordinance', label: 'Ordinances', highest: 11, missing: ['2026-02'], namedInMotionsOnly: [] }]);
    expect(s.meetings).toHaveLength(1);
  });
});

describe('RSS', () => {
  it('escapes markup and drops characters XML cannot carry', () => {
    expect(escapeXml(`Tom & Jerry's <b>"show"</b>\u0001`)).toBe('Tom &amp; Jerry&apos;s &lt;b&gt;&quot;show&quot;&lt;/b&gt;');
    expect(rfc822('2026-09-15')).toBe('Tue, 15 Sep 2026 12:00:00 GMT');
    expect(rfc822('not a date')).toBeNull();
  });

  it('builds a valid RSS 2.0 document with atom:link self', () => {
    const xml = rssDocument({ title: 'T & C', link: 'https://x.org/records', selfUrl: 'https://x.org/feeds/records.xml', description: 'd', items: [{ title: 'A <b>', link: 'https://x.org/documents/1', date: '2026-09-15', categories: ['Ordinance', null] }], ttl: 15 });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">')).toBe(true);
    expect(xml).toContain('<atom:link href="https://x.org/feeds/records.xml" rel="self" type="application/rss+xml"/>');
    expect(xml).toContain('<title>T &amp; C</title>');
    expect(xml).toContain('<title>A &lt;b&gt;</title>');
    expect(xml).toContain('<pubDate>Tue, 15 Sep 2026 12:00:00 GMT</pubDate>');
    expect(xml).toContain('<guid isPermaLink="true">https://x.org/documents/1</guid>');
    expect(xml.match(/<category>/g)).toHaveLength(1);
    // Balanced tags.
    for (const tag of ['rss', 'channel', 'item', 'title', 'link']) expect((xml.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length).toBe((xml.match(new RegExp(`</${tag}>`, 'g')) ?? []).length);
  });

  it('leaves resident submissions out of the records feed', () => {
    const items = recordItems(
      [
        { id: 'a', title: 'Ordinance 2026-10', document_type: 'ordinance', document_date: '2026-08-25', government_body_name: 'City Council', source_id: 'city' },
        { id: 'b', title: 'A photo', document_type: 'resident_submission', document_date: '2026-08-26', source_id: 'resident-submitted' },
      ],
      'https://vineyardportal.org',
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ link: 'https://vineyardportal.org/documents/a', description: 'Ordinance. City Council. Aug 25, 2026.' });
  });

  it('gives each upcoming meeting its agenda link once posted, one item per meeting', () => {
    const items = meetingItems(
      [
        { id: 'm1', title: 'City Council', government_body_id: 'city-council', government_body_name: 'City Council', meeting_date: '2026-10-14', start_time: '18:00', agenda_id: null },
        { id: 'm2', title: 'City Council', government_body_id: 'city-council', government_body_name: 'City Council', meeting_date: '2026-10-14', start_time: '18:00', agenda_id: 'doc_1' },
        { id: 'm3', title: 'Planning Commission', government_body_id: 'planning-commission', government_body_name: 'Planning Commission', meeting_date: '2026-10-21', agenda_id: null },
      ],
      'https://vineyardportal.org',
    );
    expect(items).toHaveLength(2);
    expect(items[0].description).toContain('Agenda: https://vineyardportal.org/documents/doc_1');
    expect(items[1].description).toContain('Agenda not posted yet');
  });
});

