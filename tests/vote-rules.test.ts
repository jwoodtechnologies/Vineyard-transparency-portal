import { describe, expect, it } from 'vitest';
import { isAboutFormerMember, isProceduralMotion } from '../src/lib/voteRules';
import { sheetRows, type MotionRow } from '../src/console/votes';
import { parseMinutes } from '../worker/lib/votes';

const motion = (over: Partial<MotionRow>): MotionRow => ({
  id: 'm1',
  date: '2026-08-04',
  bodyId: 'city-council',
  bodyName: 'City Council',
  item: '3.1 Discuss Resolution 2026-33 400 South Road Design',
  motion: 'approve Resolution 2026-33 as presented',
  mover: 'Parker McCumber',
  seconder: 'Jacob Holdaway',
  result: 'carried',
  tally: '5-0',
  tieBreak: false,
  unanimous: true,
  inferred: false,
  refs: [],
  documentId: 'doc_x',
  page: 3,
  votes: [
    { member: 'Parker McCumber', vote: 'yes' },
    { member: 'Jacob Holdaway', vote: 'yes' },
    { member: 'Ezra Nair', vote: 'yes' },
  ],
  ...over,
});

describe('motions that are not votes', () => {
  it.each([
    'continue item 3.1 to the next City Council meeting, pending a legal review',
    'Continue the item to the march 10th meeting to allow time to speak with counsel',
    'Table the item. there was no second. the motion failed.',
    'postpone the item until March 24',
    'move Agenda item 5.2 to the next meeting.',
    'Strike the item from the agenda',
    'take a five minute stretch break',
    'a motion to stretch',
    'recess for ten minutes',
    'take a short break',
    'adjourn the meeting',
    'go into a closed session to discuss pending litigation',
    'Councilmember nair countermotioned to strike the item from future agendas',
  ])('%s', (text) => {
    expect(isProceduralMotion(text)).toBe(true);
  });

  it.each([
    'approve the First Amendment to the Holdaway agreement with the discussed changes',
    'approve the consent items as presented',
    'continue the engineering services contract with Hansen for one year',
    'adopt the budget as amended',
    'approve Resolution 2026-33 400 South Road Design',
    'direct the City to accept the quit claim deeds',
  ])('%s is a vote', (text) => {
    expect(isProceduralMotion(text)).toBe(false);
  });
});

describe('items about a former member', () => {
  it('drops an item whose own subject names him', () => {
    expect(isAboutFormerMember('8.1 Discussion of Councilmember Nair resignation', 'accept the resignation')).toBe(true);
    expect(isAboutFormerMember('7.4 Fill the vacant seat', 'appoint a replacement for Ezra Nair')).toBe(true);
  });

  it('keeps an item that only has him as the one who moved it', () => {
    expect(isAboutFormerMember('5.3 Adopt the fee schedule', 'Councilmember Nair motioned to adopt the fee schedule')).toBe(false);
    expect(isAboutFormerMember('5.3 Adopt the fee schedule', 'adopt the fee schedule')).toBe(false);
  });
});

describe('the votes list', () => {
  it('lists a decision with the roll, including how he voted', () => {
    const rows = sheetRows([motion({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('passed');
    expect(rows[0].m.votes.map((v) => v.member)).toContain('Ezra Nair');
  });

  it('never lists a motion to continue, strike or recess', () => {
    const rows = sheetRows([
      motion({ id: 'a', motion: 'continue item 3.1 to the next City Council meeting, pending a legal review' }),
      motion({ id: 'b', motion: 'Strike the item from the agenda' }),
      motion({ id: 'c', motion: 'take a five minute stretch break', item: null }),
      motion({ id: 'd', motion: 'recess for ten minutes', item: null }),
    ]);
    expect(rows).toEqual([]);
  });

  it('never lists a vote about the former member himself', () => {
    expect(sheetRows([motion({ item: '8.2 Councilmember Nair Resignation', motion: 'accept the resignation as presented' })])).toEqual([]);
  });
});

describe('minutes read for the list', () => {
  const text = `CITY COUNCIL MEETING MINUTES
August 4, 2026
Present
Mayor Zack Stratton
Council Member Jacob Holdaway
Council Member David Lauret
Council Member Parker McCumber
Council Member Ezra Nair
Council Member Jacob Wood
3.1. Discuss Resolution 2026-33 400 South Road Design
Motion: Council Member Lauret motioned to continue item 3.1 to the next City Council meeting, pending a legal review. Second: Council Member Wood. Yes: Council Members Holdaway, Lauret, McCumber, Nair, and Wood. No: None. Motion passed 5-0.
Motion: Council Member McCumber motioned to take a five minute stretch break. Second: Council Member Nair. Yes: Council Members Holdaway, Lauret, McCumber, Nair, and Wood. No: None. Motion passed 5-0.
4.1. Approve Ordinance 2026-12 Amending the Fee Schedule
Motion: Council Member Nair motioned to approve Ordinance 2026-12 as presented. Second: Council Member Wood. Yes: Council Members Holdaway, Lauret, McCumber, Nair, and Wood. No: None. Motion passed 5-0.
`;
  const r = parseMinutes(text, '2026-08-04');

  it('keeps only the decision', () => {
    expect(r.motions).toHaveLength(1);
    expect(r.motions[0].text).toMatch(/^approve Ordinance 2026-12/i);
  });

  it('keeps his vote on the roll and his credit as the mover', () => {
    expect(r.motions[0].mover).toBe('Nair');
    expect(r.motions[0].votes.find((v) => v.member === 'Nair')?.vote).toBe('yes');
  });
});
