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
