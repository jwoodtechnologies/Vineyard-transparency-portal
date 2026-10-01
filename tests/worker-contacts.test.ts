import { describe, expect, it } from 'vitest';
import { contactFor, isIdentityQuestion, namedIn, personFromTurns, titleIn, whoIsAnswer, type StaffPerson } from '../worker/ai/contacts';

const P = (name: string, role: string, kind = 'staff', extra: Partial<StaffPerson> = {}): StaffPerson => ({ slug: name.toLowerCase().replace(/\s+/g, '-'), name, kind, role, department: null, email: null, phone: null, ...extra });
const people = [
  P('Zack Stratton', 'Mayor', 'elected'),
  P('Jacob Holdaway', 'Council Member', 'elected'),
  P('David Kyle Herring', 'Deputy Mayor', 'staff', { department: 'Officials & Executive Staff' }),
  P('Ed Kennedy', 'Code Enforcement Officer', 'staff', { department: 'Community' }),
  P('Christopher Thomas', 'Streets & Stormwater Manager'),
  P('Devan Peterson', 'Environmental Utilities Manager'),
  P('Robin Raines-Bond', 'City Recorder'),
  P('Tony Lara', 'Deputy Recorder', 'staff', { phone: '385-432-7214' }),
];

describe('people named in a question', () => {
  it('finds part of a three-part name', () => {
    expect(namedIn('No David Kyle', people).map((p) => p.name)).toEqual(['David Kyle Herring']);
    expect(namedIn('what does Kyle Herring do', people).map((p) => p.name)).toEqual(['David Kyle Herring']);
  });
  it('a road is a place', () => {
    expect(namedIn('construction on Holdaway Road', people)).toEqual([]);
  });
  it('resolves a title', () => {
    expect(titleIn('Who is the deputy mayor?', people)?.name).toBe('David Kyle Herring');
    expect(titleIn('who is the deputy recorder', people)?.name).toBe('Tony Lara');
    expect(titleIn('who is the mayor', people)?.name).toBe('Zack Stratton');
  });
});

describe('follow-ups about a person', () => {
  it('"who is he" means the person in the last answer', () => {
    const p = personFromTurns(['The city staff contact for this is Ed Kennedy, Code Enforcement Officer.', 'My neighbor is loud'], people);
    expect(p?.name).toBe('Ed Kennedy');
    expect(isIdentityQuestion('Who is he', p)).toBe(true);
  });
  it('a correction with just a name is an identity question; a vote question is not', () => {
    expect(isIdentityQuestion('No David Kyle', people[2])).toBe(true);
    expect(isIdentityQuestion('How did Jacob Holdaway vote on the budget?', people[1])).toBe(false);
  });
  it('answers from the directory', () => {
    expect(whoIsAnswer(people[2])).toMatch(/^David Kyle Herring is the Deputy Mayor \(Officials & Executive Staff\)/);
    expect(whoIsAnswer(people[7])).toMatch(/call 385-432-7214/);
  });
});

describe('who to contact', () => {
  it('matches the staff member for the problem', () => {
    expect(contactFor('My neighbor is super loud at night. Who do I file a complaint with?', people)?.name).toBe('Ed Kennedy');
    expect(contactFor('How do I report a pothole on my street?', people)?.name).toBe('Christopher Thomas');
    expect(contactFor('I have a water leak, who do I call?', people)?.name).toBe('Devan Peterson');
    expect(contactFor('How do I submit a GRAMA records request?', people)?.name).toBe('Robin Raines-Bond');
  });
  it('stays out of questions that are not asking for help', () => {
    expect(contactFor('What did the council decide about the budget in June?', people)).toBeNull();
  });
});
