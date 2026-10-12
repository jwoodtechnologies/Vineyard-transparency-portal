import { describe, expect, it } from 'vitest';
import { bodyOf, checkEvent, clock, draftOf, emptyEvent, whenOf, type EventItem } from '../src/console/staff/eventsLib';

const day = (iso: string) => ({ '2026-10-24': 'Oct 24, 2026', '2026-10-19': 'Oct 19, 2026', '2026-10-23': 'Oct 23, 2026' })[iso] ?? iso;
const ok = { ...emptyEvent('2026-10-24'), title: 'Harvest Festival' };

describe('event form checks match the server', () => {
  it('accepts a name and a date', () => expect(checkEvent(ok)).toBe(''));
  it('wants a name and a date', () => {
    expect(checkEvent({ ...ok, title: '  ' })).toMatch(/name of the event/);
    expect(checkEvent({ ...ok, date: '' })).toMatch(/date/);
  });
  it('checks the order of days and times', () => {
    expect(checkEvent({ ...ok, endDate: '2026-10-20' })).toMatch(/last day/);
    expect(checkEvent({ ...ok, startTime: '14:00', endTime: '09:00' })).toMatch(/end time/);
    expect(checkEvent({ ...ok, endTime: '09:00' })).toMatch(/start time/);
    expect(checkEvent({ ...ok, endDate: '2026-10-25', startTime: '14:00', endTime: '09:00' })).toBe('');
    expect(checkEvent({ ...ok, allDay: true, startTime: '14:00', endTime: '09:00' })).toBe('');
  });
  it('checks the link and the details length', () => {
    expect(checkEvent({ ...ok, url: 'javascript:alert(1)' })).toMatch(/web address/);
    expect(checkEvent({ ...ok, url: 'vineyardutah.gov/harvest' })).toBe('');
    expect(checkEvent({ ...ok, description: 'x'.repeat(1001) })).toMatch(/under 1000/);
  });
});

describe('reading and sending', () => {
  const item: EventItem = {
    id: 'evt_1',
    title: 'Harvest Festival',
    date: '2026-10-24',
    startTime: '10:00',
    endDate: null,
    endTime: '14:30',
    allDay: false,
    location: null,
    description: null,
    url: null,
    category: 'Community',
    past: false,
    createdBy: null,
    updatedAt: '2026-10-02T12:00:00.000Z',
  };
  it('turns a stored event into form values and back', () => {
    expect(draftOf(item)).toMatchObject({ startTime: '10:00', endTime: '14:30', endDate: '', location: '', url: '' });
    expect(bodyOf(draftOf(item))).toMatchObject({ title: 'Harvest Festival', date: '2026-10-24', allDay: false, startTime: '10:00', endTime: '14:30' });
  });
  it('sends no times for an all day event', () => {
    expect(bodyOf({ ...draftOf(item), allDay: true })).toMatchObject({ allDay: true, startTime: '', endTime: '' });
  });
});

describe('how a time reads', () => {
  it('shows a 12 hour clock', () => {
    expect(clock('00:05')).toBe('12:05 AM');
    expect(clock('12:00')).toBe('12:00 PM');
    expect(clock('14:30')).toBe('2:30 PM');
    expect(clock(null)).toBe('');
  });
  it('writes when an event happens', () => {
    expect(whenOf({ date: '2026-10-24', endDate: null, startTime: '10:00', endTime: '14:30', allDay: false }, day)).toBe('Oct 24, 2026 · 10:00 AM to 2:30 PM');
    expect(whenOf({ date: '2026-10-24', endDate: null, startTime: '10:00', endTime: null, allDay: false }, day)).toBe('Oct 24, 2026 · 10:00 AM');
    expect(whenOf({ date: '2026-10-24', endDate: null, startTime: null, endTime: null, allDay: true }, day)).toBe('Oct 24, 2026 · All day');
    expect(whenOf({ date: '2026-10-19', endDate: '2026-10-23', startTime: null, endTime: null, allDay: true }, day)).toBe('Oct 19, 2026 to Oct 23, 2026');
  });
});
