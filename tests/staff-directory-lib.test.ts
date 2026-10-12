import { describe, expect, it } from 'vitest';
import { EMPTY_PERSON, checkPerson, draftOf, personLine, type DirPerson } from '../src/console/staff/directoryLib';

const person = (over: Partial<DirPerson>): DirPerson => ({ slug: 'a-b', name: 'A B', kind: 'staff', role: 'Clerk', department: 'Recorder', boards: [], term: null, email: null, phone: null, current: true, manual: false, hasPhoto: false, ...over });

describe('person lines', () => {
  it('reads the role with the department or boards', () => {
    expect(personLine(person({}))).toBe('Clerk · Recorder');
    expect(personLine(person({ kind: 'board', role: 'Chair', department: 'Planning Commission', boards: ['Planning Commission', 'Arch Commission'] }))).toBe('Chair · Planning Commission, Arch Commission');
    expect(personLine(person({ kind: 'elected', role: 'Mayor', department: 'Mayor and City Council' }))).toBe('Mayor');
    expect(personLine(person({ department: null }))).toBe('Clerk');
  });
});

describe('form checks match the server', () => {
  const ok = { ...EMPTY_PERSON, name: 'Sam Lee', role: 'Clerk' };
  it('accepts a staff member with just a name and title', () => expect(checkPerson(ok, true)).toBe(''));
  it('wants a full name when adding only', () => {
    expect(checkPerson({ ...ok, name: 'Cher' }, true)).toMatch(/full name/);
    expect(checkPerson({ ...ok, name: 'Cher' }, false)).toBe('');
  });
  it('wants a title, a council role, or boards by kind', () => {
    expect(checkPerson({ ...ok, role: ' ' }, true)).toMatch(/job title/);
    expect(checkPerson({ ...ok, kind: 'elected', role: 'Dictator' }, true)).toMatch(/Mayor or Council Member/);
    expect(checkPerson({ ...ok, kind: 'board', role: 'Member', boards: [] }, true)).toMatch(/at least one board/);
    expect(checkPerson({ ...ok, kind: 'board', role: 'Member', boards: ['Library Board'] }, true)).toBe('');
  });
  it('checks email and phone only when given', () => {
    expect(checkPerson({ ...ok, email: 'nope' }, true)).toMatch(/email/);
    expect(checkPerson({ ...ok, phone: 'call me' }, true)).toMatch(/phone/);
    expect(checkPerson({ ...ok, email: 'a@b.org', phone: '(801) 555-0100' }, true)).toBe('');
  });
});

describe('editing a listed person', () => {
  it('starts from what is listed', () => {
    const d = draftOf(person({ kind: 'board', department: 'Planning Commission; Arch Commission', boards: ['Planning Commission', 'Arch Commission'], term: 'Term ends 2028' }));
    expect(d).toMatchObject({ kind: 'board', department: '', boards: ['Planning Commission', 'Arch Commission'], term: 'Term ends 2028' });
    expect(draftOf(person({})).department).toBe('Recorder');
  });
});
