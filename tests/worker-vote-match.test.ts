import { describe, expect, it } from 'vitest';
import { citedMotions, motionMatches, placeWords, termTries } from '../worker/ai/voteMatch';

type VotesFor = (env: never, q: string, people: Array<{ name: string }>) => Promise<{ member: string | null; q: string; items: Array<{ id: string }> } | null>;
// Loaded by path at run time: the module uses Worker types this test project does not compile.
const WORKER_VOTES = '../worker/api/votes';
const loadVotesFor = async () => ((await import(/* @vite-ignore */ WORKER_VOTES)) as { votesFor: VotesFor }).votesFor;
import { memberTitle, recordedMotion } from '../src/console/votes';

const row = (id: string, motion: string, item: string | null) => ({
  id,
  document_id: `doc-${id}`,
  meeting_id: 'm1',
  body_id: 'city-council',
  meeting_date: '2026-09-23',
  seq: 1,
  item,
  motion,
  mover: 'McCumber',
  seconder: 'Wood',
  result: 'carried',
  tally: '5-0',
  tie_break: 0,
  unanimous: 0,
  inferred: 0,
  refs: null,
  items: null,
  page: 4,
});

const MOTIONS = [
  row('a', 'approve the Holdaway Fields Phase 2 construction contract with Acme Builders', '5.1 Holdaway Fields Phase 2 Construction Contract'),
  row('b', 'approve the Intermountain Health development agreement including athletic fields', '5.2 Intermountain Health Development Agreement'),
  row('c', 'approve the Forge site plan amendment for the sports fields', '5.3 Forge Site Plan'),
];

/** A D1 stand-in for the votes tables: the motions query returns all three motions whatever it asks for. */
function env() {
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        run: async () => ({}),
        first: async () => (/count\(\*\)/.test(sql) ? { n: MOTIONS.length } : null),
        all: async () => {
          if (/FROM people/.test(sql)) return { results: [{ name: 'Jacob Holdaway' }, { name: 'Parker McCumber' }, { name: 'Jacob Wood' }] };
          if (/SELECT m\.\* FROM motions/.test(sql)) return { results: MOTIONS };
          return { results: [] };
        },
      };
      return stmt;
    },
    batch: async () => [],
  };
  return { CATALOG_DB: db } as never;
}

describe('recorded motions that match the question', () => {
  it('treats a last name before a place word as the place', () => {
    expect([...placeWords('How did the council vote on Holdaway Fields?')]).toEqual(['holdaway']);
    expect(placeWords('How did Holdaway vote on the budget?').size).toBe(0);
  });

  it('matches only motions with every subject word', () => {
    const m = { motion: MOTIONS[0].motion, item: MOTIONS[0].item };
    expect(motionMatches(m, ['holdaway', 'fields'])).toBe(true);
    expect(motionMatches({ motion: MOTIONS[1].motion, item: MOTIONS[1].item }, ['holdaway', 'fields'])).toBe(false);
    expect(motionMatches({ motion: MOTIONS[2].motion, item: MOTIONS[2].item }, ['holdaway', 'fields'])).toBe(false);
    expect(motionMatches(m, [])).toBe(false);
  });

  it('never falls back to a single word when the question has more', () => {
    expect(termTries(['holdaway', 'fields'])).toEqual([['holdaway', 'fields']]);
    expect(termTries(['fields'])).toEqual([['fields']]);
    expect(termTries(['south', '400', 'design'])).toEqual([['south', '400', 'design'], ['design', 'south'], ['design', '400'], ['south', '400']]);
  });

  it('keeps only cited motions when the answer cites some', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(citedMotions(items, ['vote:b', 'chunk-9'])).toEqual([{ id: 'b' }]);
    expect(citedMotions(items, ['chunk-9', null])).toEqual(items);
    expect(citedMotions(items, ['vote:zzz'])).toEqual(items);
  });

  it('shows the Holdaway Fields motion and not the unrelated ones', async () => {
    const votesFor = await loadVotesFor();
    const r = await votesFor(env(), 'How did the council vote on Holdaway Fields?', [{ name: 'Jacob Holdaway' }]);
    expect(r?.member).toBeNull();
    expect(r?.items.map((m) => m.id)).toEqual(['a']);
    expect(r?.q).toBe('holdaway fields');
  });
});

describe('how a member and a motion are shown', () => {
  it('uses the stored title and the last name', () => {
    expect(memberTitle('Parker McCumber', 'Council Member')).toBe('Council Member McCumber');
    expect(memberTitle('Julie Fullmer', 'Mayor')).toBe('Mayor Fullmer');
    expect(memberTitle('mccumber', 'Council Member')).toBe('Council Member McCumber');
    expect(memberTitle('Daria Evans', 'Chair')).toBe('Chair Evans');
  });

  it('never makes up a title', () => {
    expect(memberTitle('Daria Evans', null)).toBe('Evans');
    expect(memberTitle('Daria Evans', 'Library Board Chair and volunteer coordinator')).toBe('Evans');
  });

  it('words the motion as recorded', () => {
    expect(recordedMotion({ motion: 'approve  the Holdaway Fields\ncontract' })).toBe('approve the Holdaway Fields contract');
  });
});
