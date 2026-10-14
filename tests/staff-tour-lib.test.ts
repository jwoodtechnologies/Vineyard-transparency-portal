import { describe, expect, it } from 'vitest';
import { placeCard, tourDue, tourSteps, welcomeLine } from '../src/console/staff/tourSteps';
import { indexState } from '../src/console/staff/recordsLib';
import type { Me } from '../src/console/staff/account';

const person = (areas: string[], role: Me['role'] = 'editor', tour: string | null = null): Me => ({ id: 'u', email: 'p@x', name: 'Pat Clerk', department: null, role, areas, tour });

describe('staff tour steps', () => {
  it('shows a records clerk every step about records, and the welcome and activity steps', () => {
    expect(tourSteps(person(['records'])).map((s) => s.id)).toEqual(['welcome', 'record', 'note', 'assistant', 'fix', 'activity']);
  });

  it('leaves out steps for areas the account does not include', () => {
    expect(tourSteps(person(['votes'])).map((s) => s.id)).toEqual(['welcome', 'activity']);
    // The assistant takes map and notice changes too.
    expect(tourSteps(person(['map'])).map((s) => s.id)).toEqual(['welcome', 'assistant', 'activity']);
    expect(tourSteps(person([], 'admin')).map((s) => s.id)).toEqual(['welcome', 'record', 'note', 'assistant', 'fix', 'activity']);
  });

  it('says in one line what the account can change', () => {
    expect(welcomeLine(person(['records', 'map']))).toBe('The portal is the public archive of Vineyard records, meetings and votes. Your account can change Records and meetings and Map and projects.');
    expect(welcomeLine(person([], 'owner'))).toMatch(/every area, and staff accounts\.$/);
  });

  it('points every step at a screen and a marked control, in plain words with no dashes', () => {
    for (const s of tourSteps(person([], 'owner'))) {
      expect(s.path).toMatch(/^\/staff/);
      expect(s.target).toMatch(/^[a-z-]+$/);
      expect(`${s.title} ${s.body}`).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
    }
  });

  it('starts by itself only while the account has not finished or skipped it', () => {
    expect(tourDue(person(['records']))).toBe(true);
    expect(tourDue(person(['records'], 'editor', 'done'))).toBe(false);
    expect(tourDue(person(['records'], 'editor', 'skipped'))).toBe(false);
    expect(tourDue(person(['records'], 'owner', 'before'))).toBe(false);
    expect(tourDue(null)).toBe(false);
  });
});

describe('tour card placement', () => {
  const card = { width: 360, height: 180 };
  it('goes below the control on a desktop when it fits, else above', () => {
    const below = placeCard({ top: 100, left: 200, width: 300, height: 60 }, card, { width: 1440, height: 900 });
    expect(below.top).toBeGreaterThan(160);
    const above = placeCard({ top: 700, left: 200, width: 300, height: 120 }, card, { width: 1440, height: 900 });
    expect(above.top + card.height).toBeLessThan(700);
  });

  it('spans the width on a phone, at the bottom unless the control is low down', () => {
    const high = placeCard({ top: 120, left: 16, width: 358, height: 80 }, card, { width: 390, height: 844 });
    expect(high).toMatchObject({ left: 12, width: 366 });
    expect(high.top).toBeGreaterThan(600);
    const low = placeCard({ top: 640, left: 16, width: 358, height: 80 }, card, { width: 390, height: 844 });
    expect(low.top).toBe(12);
  });
});

describe('record status after an add', () => {
  it('reads Processing until indexed, then Searchable and in the chat', () => {
    expect(indexState('queued')).toMatchObject({ label: 'Processing', settled: false });
    expect(indexState('pending')).toMatchObject({ label: 'Processing', settled: false });
    expect(indexState('done')).toMatchObject({ label: 'Searchable and in the chat', settled: true });
    expect(indexState('no_text').settled).toBe(true);
    expect(indexState('failed').settled).toBe(true);
  });
});
