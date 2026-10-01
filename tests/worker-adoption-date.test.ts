import { describe, expect, it } from 'vitest';
import { adoptionDate } from '../worker/lib/adoptionDate';

describe('adoptionDate', () => {
  it('reads the signature block', () => {
    expect(adoptionDate('PASSED AND ADOPTED by the Town Council this 10th day of May, 1989.', 1989)).toBe('1989-05-10');
    expect(adoptionDate('approved on June 23, 2026 by the council', 2026)).toBe('2026-06-23');
  });
  it('never guesses', () => {
    expect(adoptionDate('See the plan of March 3, 2019.', 2026)).toBeNull();
    expect(adoptionDate('the meeting of March 3, 2026 was noticed', 2026)).toBeNull();
    expect(adoptionDate('this 31st day of February, 2026', 2026)).toBeNull();
  });
});

describe('adoptionDate history note', () => {
  it('reads the code site note', () => {
    expect(adoptionDate('HISTORY\n\nAdopted by Res.\n\n1989-02\n on 5/18/1989\n\nRESOLUTION', 1989)).toBe('1989-05-18');
    expect(adoptionDate('Adopted by Ord. 2020-04 on 13/40/2020', 2020)).toBeNull();
  });
});

describe('dates printed in titles', () => {
  it('reads newsletters, email updates and notices', async () => {
    const { titleDate } = await import('../worker/lib/adoptionDate');
    expect(titleDate('September Newsletter 2026')).toBe('2026-09-01');
    expect(titleDate('May 2026 Newsletter')).toBe('2026-05-01');
    expect(titleDate('Email Update 3 - August 7, 2026')).toBe('2026-08-07');
    expect(titleDate('9.15.26 CC Agenda')).toBe('2026-09-15');
    expect(titleDate('Construction Notice: Center Street & 400 South Improvements')).toBeNull();
  });
});
