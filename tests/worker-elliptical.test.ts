import { describe, expect, it } from 'vitest';
import { ellipticalFollowUp, ellipticalFragment, swapSubject, swapTime, type ConvTurn } from '../worker/ai/followup';
import { budgetIntent } from '../worker/ai/budgetAnswer';
import { topicsFor } from '../worker/ai/topics';

const POLICE_FIRE = 'How much is the city spending on police and fire in the FY27 budget?';
// The live tester's conversation (frontend payload, stream: true).
const convo: ConvTurn[] = [
  { role: 'user', content: POLICE_FIRE },
  {
    role: 'assistant',
    content:
      'In the fiscal year 2027 budget, Police is budgeted $4,705,075 and Fire $2,873,462 in the FY 27 Final Budget adopted June 23, 2026 [1]. Neither was changed by the First Budget Amendment of August 25, 2026 [2].',
  },
];

describe('elliptical follow-ups', () => {
  it('reads the new subject or time', () => {
    expect(ellipticalFragment('and parks?')).toEqual({ subject: 'parks' });
    expect(ellipticalFragment('what about parks')).toEqual({ subject: 'parks' });
    expect(ellipticalFragment('how about the library?')).toEqual({ subject: 'library' });
    expect(ellipticalFragment('And parks spending?')).toEqual({ subject: 'parks' });
    expect(ellipticalFragment('and for 2026?')).toEqual({ time: '2026' });
    expect(ellipticalFragment('what about FY26?')).toEqual({ time: 'FY26' });
    // Not elliptical: a full question, a pronoun, or no new subject.
    expect(ellipticalFragment('What is the parks master plan?')).toBeNull();
    expect(ellipticalFragment('and when will they finish?')).toBeNull();
    expect(ellipticalFragment('and the cost?')).toBeNull();
    expect(ellipticalFragment('parks')).toBeNull();
  });

  it('swaps the subject and keeps the frame word for word', () => {
    expect(swapSubject(POLICE_FIRE, 'parks')).toBe('How much is the city spending on parks in the FY27 budget?');
    expect(swapSubject('Who voted for the ARCH grant?', 'Forge')).toBe('Who voted for the Forge?');
    expect(swapTime(POLICE_FIRE, '2026')).toBe('How much is the city spending on police and fire in the 2026 budget?');
    expect(swapTime('How much does the city spend on police?', '2026')).toBe('How much does the city spend on police in 2026?');
  });

  it('rewrites the live payload to parks spending in FY27', () => {
    const q = ellipticalFollowUp('and parks?', convo);
    expect(q).toBe('How much is the city spending on parks in the FY27 budget?');
    expect(q).not.toMatch(/master plan|police|fire/i);
    // The routers read the rewritten question: the budget data, not the plan documents.
    expect(budgetIntent(q!)).toMatchObject({ kind: 'lines', departments: [expect.objectContaining({ name: 'Parks' })] });
    expect(topicsFor(q!, '2026-10-11').map((t) => t.id)).toContain('budget');
  });

  it('handles the other phrasings and chains of follow-ups', () => {
    expect(ellipticalFollowUp('what about parks', convo)).toBe('How much is the city spending on parks in the FY27 budget?');
    expect(ellipticalFollowUp('how about the library?', convo)).toBe('How much is the city spending on library in the FY27 budget?');
    expect(ellipticalFollowUp('and for 2026?', convo)).toBe('How much is the city spending on police and fire in the 2026 budget?');
    const chained: ConvTurn[] = [...convo, { role: 'user', content: 'and parks?' }, { role: 'assistant', content: 'Parks: $956,369 [1].' }];
    expect(ellipticalFollowUp('and the library?', chained)).toBe('How much is the city spending on library in the FY27 budget?');
  });

  it('leaves new questions and empty conversations alone', () => {
    expect(ellipticalFollowUp('When is the next council meeting?', convo)).toBeNull();
    expect(ellipticalFollowUp('and parks?', [])).toBeNull();
    // No subject word to swap in the previous question: left to the other follow-up rules.
    expect(ellipticalFollowUp('and the planning commission?', [{ role: 'user', content: 'When is the next city council meeting?' }])).toBeNull();
    expect(ellipticalFollowUp('what about 400 North?', [{ role: 'user', content: 'What construction is happening at Holdaway Fields?' }])).toBe('What construction is happening at 400 North?');
  });
});
