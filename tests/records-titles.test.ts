import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyChip, displayTitle, ingestSuffix, parseRecordNumber, recordNumberOf, recordStatus, numberedKindOf, type TitleInput } from '../src/lib/recordTitle';

const show = (title: string, extra: Partial<TitleInput> = {}) => displayTitle({ title, ...extra });

describe('display titles', () => {
  it('shortens the packet ordinance from the brief and keeps its chips', () => {
    const input: TitleInput = {
      title: '10.01.2026 DADU Ordinance - Senate Bill 284 (Planning Commission Regular Meeting - 10/07/2026, 2026-10-07, item 5)',
      documentType: 'ordinance',
      date: '2026-10-07',
      governmentBodyName: 'Planning Commission',
      sourceId: 'vineyard-civicclerk-meetings',
    };
    const s = displayTitle(input);
    expect(s.title).toBe('DADU Ordinance, Senate Bill 284');
    expect(s.item).toBe('5');
    expect(s.meeting).toBe('Planning Commission Regular Meeting - 10/07/2026');
    expect(recordStatus(input, false, s)).toBe('draft');
    expect(bodyChip(input.governmentBodyName)).toBe('Planning Commission');
  });

  it.each([
    ['9.15.26 CC Agenda', 'agenda', '2026-09-15', 'City Council Agenda'],
    ['Planning Commission Agenda - October 7, 2026 Packet', 'agenda_packet', '2026-10-07', 'Planning Commission Agenda Packet'],
    ['Planning Commission Agenda - September 2, 2026 Agenda', 'agenda', '2026-09-02', 'Planning Commission Agenda'],
    ['ATC September 10, 2026 - Agenda.', 'agenda', '2026-09-10', 'ATC Agenda'],
    ['DRC Meeting Agenda - 09.03.2026', 'agenda', '2026-09-03', 'DRC Meeting Agenda'],
    ['9.8.26 DRAFT CC Minutes (Special City Council Meeting, 2026-09-15, item 1)', 'minutes', '2026-09-15', 'City Council Minutes, Sep 8, 2026'],
    ['8.25.2026 Joint RDA and PC Minutes - Draft (Redevelopment Agency Board Meeting, 2026-09-08, item 1)', 'minutes', '2026-09-08', 'Joint RDA and Planning Commission Minutes, Aug 25, 2026'],
    ['9.8.26 APPROVED CC Minutes', 'minutes', '2026-09-08', 'Approved City Council Minutes'],
    ['RES 2026-35 Meeting Schedule Amendment #3 (Special City Council Meeting, 2026-09-15, item 5)', 'resolution', '2026-09-15', 'Resolution 2026-35, Meeting Schedule Amendment #3'],
    ['Draft DADU Ordinance 2026-11 - Senate Bill 284 09.03.2026 (City Council, 2026-09-08, item 1)', 'ordinance', '2026-09-08', 'DADU Ordinance 2026-11, Senate Bill 284'],
    ['Signed Charlie Kirk Day of Remembrance Proclamation (1) (Special City Council Meeting, 2026-09-15, item 1)', 'proclamation', '2026-09-15', 'Signed Charlie Kirk Day of Remembrance Proclamation'],
    ['Lot_6_-_North_Parking_Lot_Revision (Planning Commission Regular Meeting - 10/07/2026, 2026-10-07, item 3)', 'plan', '2026-10-07', 'Lot 6, North Parking Lot Revision'],
    ['Sunlight Bilingual Preschool - Basement Floor Plan 9.25.2026 (Planning Commission Regular Meeting - 10/07/2026, 2026-10-07, item 2)', 'plan', '2026-10-07', 'Sunlight Bilingual Preschool, Basement Floor Plan'],
    ['City Council Meeting (public notice, 2026-10-13)', 'public_notice', '2026-10-13', 'City Council Meeting'],
    ['2026-09 Amending Title 7 By Adopting Chapter 7.08, Stormwater Management', 'ordinance', null, 'Ordinance 2026-09, Amending Title 7 By Adopting Chapter 7.08, Stormwater Management'],
    ['ORDINANCE NO 2026-09 Stormwater (City Council, 2026-06-23, item 1)', 'ordinance', '2026-06-23', 'Ordinance 2026-09, Stormwater'],
    ['Ord_2025-19 (4) (City Council Meeting, 2025-11-12, item 11)', 'ordinance', '2025-11-12', 'Ordinance 2025-19'],
    ['3.3 Exhibit A - Lease Area Map (City Council Meeting, 2026-08-04, item 2)', 'map', '2026-08-04', 'Exhibit A, Lease Area Map'],
    ['Vineyard Central Corridor Masterplan- Final (City Council Meeting, 2026-08-04, item 1)', 'plan', '2026-08-04', 'Vineyard Central Corridor Masterplan'],
    ['2025-12-09 Amended and Restated Governing Document Utah City West PID Nos. 1-5 (FINAL) (City Council Meeting, 2025-12-10, item 10)', 'other', '2025-12-10', 'Amended and Restated Governing Document Utah City West PID Nos. 1-5'],
    ["Coco's World | October 24, 2026 4:00 PM - 7:00 PM", 'other', '2026-10-24', "Coco's World | October 24, 2026 4:00 PM - 7:00 PM"],
    ['Final Plat Phase 2.pdf', 'plan', null, 'Final Plat Phase 2'],
  ])('%s', (title, documentType, date, want) => {
    expect(show(title, { documentType, date }).title).toBe(want);
  });

  it('reads the trailing ingest suffix only when it holds a date or an item', () => {
    expect(ingestSuffix('Map (current)')).toBeNull();
    expect(ingestSuffix('Plan (Joint (RDA) Meeting, 2026-01-02, item 3)')).toEqual({ rest: 'Plan', meeting: 'Joint (RDA) Meeting', item: '3' });
    expect(ingestSuffix('Notice (public notice, 2026-09-29)')).toEqual({ rest: 'Notice', meeting: null, item: null });
  });
});

describe('Draft or Adopted', () => {
  const civic = (title: string, documentType = 'ordinance'): TitleInput => ({ title, documentType, date: '2026-09-08', sourceId: 'vineyard-civicclerk-meetings' });

  it('a Draft by name is never adopted, even when the number was adopted', () => {
    expect(recordStatus(civic('Draft Ordinance 2026-07 July 28 Revision (City Council, 2026-08-11, item 1)'), true)).toBe('draft');
    expect(recordStatus(civic('RES 2026-11 Towing Amendment (DRAFT) (City Council Meeting, 2026-02-24, item 2)', 'resolution'), true)).toBe('draft');
  });
  it('a packet copy is Draft until matched to an adopting motion', () => {
    const d = civic('ORDINANCE NO 2026-09 Stormwater (City Council, 2026-06-23, item 1)');
    expect(recordStatus(d, false)).toBe('draft');
    expect(recordStatus(d, true)).toBe('adopted');
  });
  it('the municipal code books hold adopted copies', () => {
    expect(recordStatus({ title: '2026-09 Amending Title 7', documentType: 'ordinance', sourceId: 'vineyard-municipal-code' })).toBe('adopted');
  });
  it('Draft inside a name is not a draft marker', () => {
    const t = { title: 'RDA Resolution U-2010-03 Adopting The Draft Geneva Urban Renewal Project Area Plan', documentType: 'resolution', sourceId: 'vineyard-municipal-code' };
    expect(displayTitle(t).draftWord).toBe(false);
    expect(displayTitle(t).title).toContain('Adopting The Draft Geneva');
    expect(recordStatus(t)).toBe('adopted');
  });
  it('a packet file typed by its agenda item is not called a draft ordinance', () => {
    expect(recordStatus(civic('EPA Stormwater Phase II Final Rule Factsheet 2.0 Small MS4 Overview (City Council, 2026-06-23, item 1)'))).toBeNull();
  });
  it('a record outside the legislative types carries Draft only when its name says so', () => {
    expect(recordStatus(civic('Public Safety Master Plan Draft 1 3.13.26 rb (City Council Meeting, 2026-03-17, item 1)', 'plan'))).toBe('draft');
    expect(recordStatus(civic('Vineyard Parks IFA Report (City Council Meeting, 2025-03-26, item 1)', 'study'))).toBeNull();
  });
});

describe('record numbers', () => {
  it.each([
    ['Ordinance 2026-09', { kind: 'ordinance', number: '2026-09' }],
    ['RES 2026-35 Meeting Schedule', { kind: 'resolution', number: '2026-35' }],
    ['Adopt Resolution 202618 adopting a travel policy', { kind: 'resolution', number: '2026-18' }],
    ['Resolution RDA-2026-03', { kind: 'resolution', number: '2026-03' }],
    ['RDA Resolution U-2009-06 Blight', { kind: 'resolution', number: '2009-06' }],
    ['Ord_2025-4', null],
  ])('%s', (text, want) => {
    expect(parseRecordNumber(text.replace(/_/g, ' '))).toEqual(want ?? { kind: 'ordinance', number: '2025-04' });
  });
  it('takes a stored number first and the bare number of a code book title', () => {
    expect(recordNumberOf({ title: 'x', documentNumber: '2026-9', documentType: 'ordinance' })).toBe('2026-09');
    expect(recordNumberOf({ title: '2026-09 Amending Title 7', documentType: 'ordinance' })).toBe('2026-09');
  });
  it('sorts RDA resolutions into their own series', () => {
    expect(numberedKindOf({ title: 'RES U2025-01 Bid Award', documentType: 'resolution', governmentBodyId: 'redevelopment-agency' })).toBe('rda-resolution');
    expect(numberedKindOf({ title: 'RES 2026-12 Bank', documentType: 'resolution', governmentBodyId: 'city-council' })).toBe('resolution');
  });
});

describe('140 real titles from the archive', () => {
  const sample = JSON.parse(readFileSync(new URL('./fixtures/record-titles.json', import.meta.url), 'utf8')) as Array<TitleInput & { year: number | null }>;
  it('is a real sample', () => expect(sample.length).toBeGreaterThanOrEqual(100));
  it.each(sample.map((d) => [d.title, d] as const))('%s', (_t, d) => {
    const s = displayTitle(d);
    expect(s.title.length).toBeGreaterThan(0);
    expect(s.title).not.toMatch(/[–—]/);
    expect(s.title).not.toMatch(/\.(pdf|docx?)$/i);
    expect(s.title).not.toMatch(/\(\d{1,2}\)/);
    expect(s.title).not.toMatch(/, 20\d\d-\d\d-\d\d(, item [^)]*)?\)$/);
    expect(s.title).not.toMatch(/^\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/);
    expect(s.title).not.toMatch(/\bFINAL\b|\bDRAFT\b/);
    expect(s.title).not.toMatch(/_/);
    // Adopted only from the code books here (no motions in this test), and never with Draft in the name.
    const st = recordStatus(d, false, s);
    if (st === 'adopted') expect(d.sourceId).toBe('vineyard-municipal-code');
    if (s.draftWord) expect(recordStatus(d, true, s)).toBe('draft');
  });
});
