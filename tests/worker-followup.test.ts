import { describe, expect, it } from 'vitest';
import { carryOver, keepsTopic, needsCarryOver, priorTopic, titleSubject, topicWords, type ConvTurn } from '../worker/ai/followup';

const construction: ConvTurn[] = [
  { role: 'user', content: 'What construction is happening at Holdaway Fields?' },
  {
    role: 'assistant',
    content: 'The council approved a contract for Holdaway Fields Phase 2 [1].',
    sources: ['Holdaway Fields Phase 2 Construction Contract', 'City Council Meeting Minutes 2026-09-23 (recorded vote)'],
  },
];

describe('follow-up carry-over', () => {
  it('knows a message with no subject of its own', () => {
    expect(needsCarryOver('who voted for it and how much did it cost?')).toBe(true);
    expect(needsCarryOver('How much did that project cost?')).toBe(true);
    expect(needsCarryOver('and when will they finish?')).toBe(true);
    expect(needsCarryOver('?')).toBe(true);
    // A message that names its own subject stands on its own.
    expect(needsCarryOver('Who voted for the ARCH grant?')).toBe(false);
    expect(needsCarryOver('What about 400 North?')).toBe(false);
    expect(needsCarryOver('How much did the Forge cost?')).toBe(false);
  });

  it('finds the subject words', () => {
    expect(topicWords('who voted for it and how much did it cost?')).toEqual([]);
    expect(topicWords('What construction is happening at Holdaway Fields?')).toEqual(['construction', 'Holdaway', 'Fields']);
  });

  it('reduces record titles to their subject', () => {
    expect(titleSubject('City Council Meeting Minutes 2026-09-23 (recorded vote)')).toBe('');
    expect(titleSubject('Holdaway Fields Phase 2 Construction Contract.pdf')).toBe('Holdaway Fields Phase 2 Construction Contract');
  });

  it('rewrites the tester case with the previous question and cited records', () => {
    const r = carryOver('who voted for it and how much did it cost?', construction);
    expect(r).not.toBeNull();
    expect(r!.standalone).toBe('who voted for construction Holdaway Fields and how much did it cost (Holdaway Fields Phase 2 Construction Contract)?');
    expect(r!.standalone).not.toMatch(/ARCH/);
    expect(r!.terms).toEqual(expect.arrayContaining(['holdaway', 'fields', 'construction', 'contract']));
  });

  it('skips earlier follow-ups to find the subject', () => {
    const convo: ConvTurn[] = [...construction, { role: 'user', content: 'when did it start?' }, { role: 'assistant', content: 'Work began in May [1].' }];
    expect(priorTopic(convo)?.phrase).toBe('construction Holdaway Fields');
    expect(carryOver('and how much did it cost?', convo)?.standalone).toMatch(/^and how much did construction Holdaway Fields cost/);
  });

  it('appends the subject when there is nothing to replace', () => {
    const r = carryOver('and the cost?', construction);
    expect(r?.standalone).toMatch(/^and the cost about construction Holdaway Fields/);
  });

  it('leaves new questions and empty conversations alone', () => {
    expect(carryOver('Who voted for the ARCH grant?', construction)).toBeNull();
    expect(carryOver('who voted for it?', [])).toBeNull();
  });

  it('checks that a model rewrite kept the subject', () => {
    const terms = carryOver('who voted for it?', construction)!.terms;
    expect(keepsTopic('Who voted for the Holdaway Fields Phase 2 contract?', terms)).toBe(true);
    expect(keepsTopic('Who voted for the ARCH grant?', terms)).toBe(false);
  });
});
