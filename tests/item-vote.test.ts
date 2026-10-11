import { describe, expect, it } from 'vitest';
import { itemVoteIn, measureVotesText, type MeasureMotion } from '../worker/ai/measureVotes';

describe('vote on an item named in words', () => {
  it('reads the item from the question', () => {
    expect(itemVoteIn('How did the council vote on the First Amendment to the Holdaway Fields development agreement?')).toEqual({
      phrase: 'First Amendment to the Holdaway Fields development agreement',
      label: 'the First Amendment to the Holdaway Fields development agreement',
    });
    expect(itemVoteIn('How did the council vote on Ordinance 2026-07?')).toBeNull();
    expect(itemVoteIn('How did the council vote on his appointment?')).toBeNull();
    expect(itemVoteIn('How did the council vote on it?')).toBeNull();
  });
  it('writes the tally and the abstention', () => {
    const m: MeasureMotion = {
      date: '2026-09-15', bodyId: 'city-council', item: 'First Amendment to the Holdaway Fields Development Agreement', motion: 'approve', mover: 'Jacob Wood', seconder: 'David Lauret',
      result: 'carried', tally: '4-0', tieBreak: false, unanimous: false, refs: [],
      votes: [{ member: 'Jacob Wood', vote: 'yes' }, { member: 'David Lauret', vote: 'yes' }, { member: 'Parker McCumber', vote: 'yes' }, { member: 'Chip Price', vote: 'yes' }, { member: 'Jacob Holdaway', vote: 'abstain' }],
    } as unknown as MeasureMotion;
    const out = measureVotesText({ ref: { label: 'the First Amendment to the Holdaway Fields development agreement' }, focus: 'vote' }, m, null, null).join(' ');
    expect(out).toMatch(/^The First Amendment/);
    expect(out).toMatch(/4 to 0|4-0/);
    expect(out).toMatch(/Holdaway[^.]{0,40}abstain|abstain[^.]{0,60}Holdaway/i);
    expect(out).not.toMatch(/[–—]/);
  });
});
