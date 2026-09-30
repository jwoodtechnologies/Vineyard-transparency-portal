import { describe, expect, it } from 'vitest';
import { expandRecurrence } from '../worker/lib/rrule';
import { expandCityEvents } from '../worker/lib/cityEvents';

// Rules below are copied from the shapes the city calendar feed publishes.
describe('expandRecurrence', () => {
  it('every other Wednesday until a date, skipping EXDATEs', () => {
    const r = 'DTSTART:20240417T000000\nRDATE:20240417T000000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20240612T000000\nEXDATE:20240515T000000';
    expect(expandRecurrence(r, '2024-01-01', '2024-12-31').map((s) => s.slice(0, 10))).toEqual(['2024-04-17', '2024-05-01', '2024-05-29', '2024-06-12']);
  });

  it('third Wednesday of the month (BYSETPOS)', () => {
    const r = 'DTSTART:20240717T180000\nRRULE:FREQ=MONTHLY;INTERVAL=1;BYSETPOS=3;BYDAY=WE';
    expect(expandRecurrence(r, '2024-07-01', '2024-10-31')).toEqual(['2024-07-17T18:00:00', '2024-08-21T18:00:00', '2024-09-18T18:00:00', '2024-10-16T18:00:00']);
  });

  it('daily with COUNT', () => {
    const r = 'DTSTART:20240419T091400\nRDATE:20240419T091400\nRRULE:FREQ=DAILY;INTERVAL=1;COUNT=4';
    expect(expandRecurrence(r, '2024-01-01', '2024-12-31')).toEqual(['2024-04-19T09:14:00', '2024-04-20T09:14:00', '2024-04-21T09:14:00', '2024-04-22T09:14:00']);
  });

  it('weekly on Thursday within a window only', () => {
    const r = 'DTSTART:20240613T140000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;UNTIL=20240809T000000';
    const all = expandRecurrence(r, '2024-01-01', '2024-12-31');
    expect(all).toHaveLength(9);
    expect(all[0]).toBe('2024-06-13T14:00:00');
    expect(all[all.length - 1]).toBe('2024-08-08T14:00:00');
    expect(expandRecurrence(r, '2024-07-01', '2024-07-31').map((s) => s.slice(0, 10))).toEqual(['2024-07-04', '2024-07-11', '2024-07-18', '2024-07-25']);
  });

  it('weekly with COUNT counts from DTSTART', () => {
    const r = 'DTSTART:20240819T160000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=2';
    expect(expandRecurrence(r, '2024-01-01', '2024-12-31')).toEqual(['2024-08-19T16:00:00', '2024-08-26T16:00:00']);
  });
});

describe('expandCityEvents', () => {
  it('decodes descriptions, keeps times, hides CMS training, expands repeats', () => {
    const raw = [
      { id: '148', title: '9/11 Patriot Day Event', primary_calendar_name: 'Community', start: '2025-09-11T19:00:00', end: '2025-09-11T21:15:00', location: 'Vineyard Grove Park', desc: 'Join%20us%20as%20we%20commemorate%209%2F11', url: '' },
      { id: '12', title: 'Content Editing Training', primary_calendar_name: 'Revize Training', start: '2025-09-05T14:30:00' },
      { id: '45', title: 'Trash Only Pickup', primary_calendar_name: 'Utilities', start: '2025-09-03T00:00:00', allDay: true, rrule: 'DTSTART:20250903T000000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20250930T000000' },
    ];
    const out = expandCityEvents(raw, '2025-09-01', '2025-09-30');
    expect(out.map((e) => [e.title, e.start.slice(0, 10)])).toEqual([
      ['Trash Only Pickup', '2025-09-03'],
      ['9/11 Patriot Day Event', '2025-09-11'],
      ['Trash Only Pickup', '2025-09-17'],
    ]);
    const patriot = out.find((e) => e.title.startsWith('9/11'))!;
    expect(patriot.description).toBe('Join us as we commemorate 9/11');
    expect(patriot.end).toBe('2025-09-11T21:15:00');
    expect(patriot.allDay).toBe(false);
    expect(out[0].allDay).toBe(true);
  });
});
