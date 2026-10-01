import { describe, expect, it } from 'vitest';
import { resolveTime, timeNote } from '../worker/ai/timeframe';

const T = '2026-10-01';

describe('resolveTime', () => {
  it('reads relative years against today', () => {
    expect(resolveTime('How many council meetings are there next year?', T)).toMatchObject({ from: '2027-01-01', to: '2027-12-31', label: '2027', future: true });
    expect(resolveTime('What did the council approve this year?', T)).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expect(resolveTime('What happened last year with parking?', T)).toMatchObject({ label: '2025' });
  });
  it('reads months, weeks and recent', () => {
    expect(resolveTime('What did they decide last month?', T)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolveTime('What happened in March?', T)).toMatchObject({ label: 'March 2026' });
    expect(resolveTime('What is planned for March?', T)).toMatchObject({ label: 'March 2027' });
    expect(resolveTime('What has the council done recently?', T)?.from).toBe('2026-04-01');
  });
  it('reads fiscal years and ranges', () => {
    expect(resolveTime('What is in the FY2027 budget?', T)).toMatchObject({ from: '2026-07-01', to: '2027-06-30' });
    expect(resolveTime('this fiscal year budget', T)).toMatchObject({ from: '2026-07-01', to: '2027-06-30' });
    expect(resolveTime('ordinances between 2019 and 2021', T)).toMatchObject({ from: '2019-01-01', to: '2021-12-31' });
    expect(resolveTime('resolutions in 1995', T)).toMatchObject({ label: '1995' });
  });
  it('leaves timeless questions alone', () => {
    expect(resolveTime('Can I keep chickens?', T)).toBeNull();
    expect(resolveTime('Who is the mayor?', T)).toBeNull();
  });
  it('writes the note', () => {
    expect(timeNote(T, null)).toContain('Today is Thursday, October 1, 2026. This year is 2026, next year is 2027');
    expect(timeNote(T, null)).toContain('fiscal year 2027');
  });
});
