import { describe, expect, it } from 'vitest';
import { day, guessType, meetingLabel, sizeLabel, titleFromFile } from '../src/console/staff/recordsLib';

const KEYS = ['agenda', 'minutes', 'staff_report', 'ordinance', 'resolution', 'contract', 'bid_award', 'budget', 'notice', 'other'];

describe('titles from file names', () => {
  it('reads like a title and keeps dates whole', () => {
    expect(titleFromFile('city_council_minutes_2026-09-29.pdf')).toBe('City council minutes 2026-09-29');
    expect(titleFromFile('Water Rates 2026.PDF')).toBe('Water Rates 2026');
    expect(titleFromFile('agenda-packet.pdf')).toBe('Agenda packet');
    expect(titleFromFile('notes_2026_09_29.txt')).toBe('Notes 2026-09-29');
    expect(titleFromFile('.pdf')).toBe('');
  });
});

describe('record type from the file name', () => {
  it.each([
    ['City Council Minutes 2026-09-29.pdf', 'minutes'],
    ['agenda_packet.pdf', 'agenda'],
    ['Staff Report Item 5.pdf', 'staff_report'],
    ['Ordinance 2026-12.pdf', 'ordinance'],
    ['resolution_u2026-04.pdf', 'resolution'],
    ['Bid Award Main Street.pdf', 'bid_award'],
    ['Hansen agreement.pdf', 'contract'],
    ['FY27 Budget.pdf', 'budget'],
    ['Public Notice.pdf', 'notice'],
    ['photo123.png', 'other'],
  ])('%s is %s', (name, type) => {
    expect(guessType(name, KEYS)).toBe(type);
  });

  it('never suggests a type the server did not offer', () => {
    expect(guessType('minutes.pdf', ['agenda', 'other'])).toBe('other');
  });
});

describe('labels', () => {
  it('writes dates without a time zone shift', () => {
    expect(day('2026-09-15')).toBe('Sep 15, 2026');
    expect(day('2026-09-15T18:00:00')).toBe('Sep 15, 2026');
    expect(day(null)).toBe('');
  });
  it('writes sizes', () => {
    expect(sizeLabel(900)).toBe('1 KB');
    expect(sizeLabel(2_500_000)).toBe('2.4 MB');
    expect(sizeLabel(20 * 1024 * 1024)).toBe('20 MB');
    expect(sizeLabel(null)).toBe('');
  });
  it('names a meeting by body and date', () => {
    expect(meetingLabel({ title: 'City Council Meeting', meeting_date: '2026-09-15T18:00:00', government_body_name: 'City Council' })).toBe('Sep 15, 2026 · City Council');
    expect(meetingLabel({ title: 'Special Meeting', meeting_date: null, government_body_name: null })).toBe('Special Meeting');
  });
});
