import { describe, expect, it } from 'vitest';
import { checkRoll, counts, meetingOption, outcomeLabel, rollFrom, rollSummary, todayIso, votesFrom } from '../src/console/staff/votesLib';

describe('roll call helpers', () => {
  it('lists everyone on the roster and fills in recorded votes', () => {
    const roll = rollFrom([{ member: 'Sarah Moore', vote: 'yes' }], ['Sarah Moore', 'Tyce Hoyt']);
    expect(roll).toEqual({ 'Sarah Moore': 'yes', 'Tyce Hoyt': '' });
  });

  it('keeps someone who voted but is not on the roster', () => {
    const roll = rollFrom([{ member: 'Guest Member', vote: 'no' }], ['Sarah Moore']);
    expect(Object.keys(roll)).toEqual(['Sarah Moore', 'Guest Member']);
  });

  it('sends only members with a vote', () => {
    expect(votesFrom({ A: 'yes', B: '', C: 'abstain' })).toEqual([
      { member: 'A', vote: 'yes' },
      { member: 'C', vote: 'abstain' },
    ]);
  });

  it('counts yes, no and recorded', () => {
    expect(counts({ A: 'yes', B: 'yes', C: 'no', D: 'absent', E: '' })).toEqual({ yes: 2, no: 1, recorded: 4 });
  });
});

describe('result check matches the server', () => {
  it('refuses Carried with more No than Yes', () => {
    expect(checkRoll('carried', { A: 'no', B: 'no', C: 'yes' })).toMatch(/cannot be marked Carried/);
  });
  it('refuses Failed with more Yes than No', () => {
    expect(checkRoll('failed', { A: 'yes', B: 'yes', C: 'no' })).toMatch(/cannot be marked Failed/);
  });
  it('accepts a tie either way and an empty roll call', () => {
    expect(checkRoll('carried', { A: 'yes', B: 'no' })).toBe('');
    expect(checkRoll('failed', { A: 'yes', B: 'no' })).toBe('');
    expect(checkRoll('carried', { A: '', B: '' })).toBe('');
  });
});

describe('labels', () => {
  it('writes the outcome with its tally', () => {
    expect(outcomeLabel('carried', '5-0')).toBe('Carried 5-0');
    expect(outcomeLabel('failed', '2-3')).toBe('Failed 2-3');
    expect(outcomeLabel('carried', null)).toBe('Carried');
    expect(outcomeLabel('unknown', '3-2')).toBe('Result not stated');
  });

  it('summarizes the roll call by vote in last-name order', () => {
    const s = rollSummary([
      { member: 'Tyce Hoyt', vote: 'yes' },
      { member: 'Sarah Moore', vote: 'yes' },
      { member: 'Chris Judd', vote: 'no' },
      { member: 'Jacob Wood', vote: 'absent' },
    ]);
    expect(s).toBe('Yes: Tyce Hoyt, Sarah Moore. No: Chris Judd. Absent: Jacob Wood.');
  });

  it('names a meeting option', () => {
    expect(meetingOption({ date: '2026-09-23', body: 'city-council', motions: 1, edited: 0 }, [{ id: 'city-council', name: 'City Council' }], (d) => d)).toBe('2026-09-23 · City Council · 1 vote');
    expect(meetingOption({ date: '2026-09-23', body: 'x', motions: 3, edited: 0 }, [], (d) => d)).toBe('2026-09-23 · x · 3 votes');
  });

  it('formats today without a time zone shift', () => {
    expect(todayIso(new Date(2026, 9, 2, 23, 59))).toBe('2026-10-02');
  });
});
