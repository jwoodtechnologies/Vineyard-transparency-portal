import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMonthDay, formatMonthYear, formatWeekdayDate, normalizeDatesInText } from '@/lib/dates';
import { headFor } from '@/lib/routeHead';

describe('one date format', () => {
  it('formats ISO days with no timezone drift', () => {
    expect(formatDate('2026-10-13')).toBe('Oct 13, 2026');
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
  });
  it('reads timestamps in Vineyard time', () => {
    // 05:15 UTC on Oct 11 is still Oct 10 in Utah.
    expect(formatDate('2026-10-11T05:15:45.905Z')).toBe('Oct 10, 2026');
    expect(formatDateTime('2026-10-11T10:15:05.928Z')).toBe('Oct 11, 2026, 4:15 AM');
  });
  it('has the calendar variants', () => {
    expect(formatWeekdayDate('2026-10-13')).toBe('Tue, Oct 13, 2026');
    expect(formatMonthDay('2026-10-13')).toBe('Oct 13');
    expect(formatMonthYear('2026-10')).toBe('October 2026');
  });
  it('rewrites dates copied from city pages', () => {
    expect(normalizeDatesInText('At a glance: updated 10/5/2026')).toBe('At a glance: updated Oct 5, 2026');
    expect(normalizeDatesInText('Planning Commission Regular Meeting - 10/07/2026')).toBe('Planning Commission Regular Meeting - Oct 7, 2026');
    expect(normalizeDatesInText('Regularly Meeting 11-05-2026')).toBe('Regularly Meeting Nov 5, 2026');
    expect(normalizeDatesInText('Meeting, 2026-10-13, item 1')).toBe('Meeting, Oct 13, 2026, item 1');
    expect(normalizeDatesInText('Ordinance 2026-10 and Resolution 2026-34')).toBe('Ordinance 2026-10 and Resolution 2026-34');
    expect(normalizeDatesInText('Section 14.06.020(4)(j)')).toBe('Section 14.06.020(4)(j)');
  });
});

describe('route titles and descriptions', () => {
  it('names every route', () => {
    for (const path of ['/meetings', '/meetings/mtg_1', '/documents/doc_1', '/map', '/records', '/records/ordinances', '/records/resolutions', '/records/rda-resolutions', '/people', '/votes', '/boards', '/planning', '/latest', '/budget', '/construction', '/add', '/sources', '/services', '/services/water']) {
      const h = headFor(path);
      expect(h.title, path).toBeTruthy();
      expect(h.description.length, path).toBeGreaterThan(40);
      expect(`${h.title} ${h.description}`, path).not.toMatch(/[–—]/);
    }
    expect(headFor('/').title).toBeNull();
    expect(headFor('/records/ordinances').title).toBe('Ordinances by number');
  });
});
