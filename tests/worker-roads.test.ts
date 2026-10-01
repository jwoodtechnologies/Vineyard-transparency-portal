import { describe, expect, it } from 'vitest';
import { ROAD_STATUS, roadsIn } from '../worker/ai/roads';

describe('roads in a question', () => {
  it('finds numbered and named roads', () => {
    expect(roadsIn('Is 575 South St under construction? 400 S too')).toEqual(['575 South', '400 South']);
    expect(roadsIn('When will Geneva Road reopen?')).toEqual(['Geneva Road']);
  });
  it('knows a status question', () => {
    expect(ROAD_STATUS.test("Isn't it under construction right now?")).toBe(true);
    expect(ROAD_STATUS.test('How long until 575 South is done')).toBe(true);
  });
});
