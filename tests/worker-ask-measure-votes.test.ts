import { describe, expect, it } from 'vitest';
import { handleAsk } from '../worker/ai/rag';
import type { Env } from '../worker/env';
import { measureRefIn, measureVotesIntent, motionIsAbout } from '../worker/ai/measureVotes';
import { directoryTitle, officialRoster, titleOfficials } from '../worker/ai/officials';

// Type-checked with the Worker project (tsconfig.worker.json): it runs the real ask handler.

/**
 * Ordinance 2026-07 as the August 11, 2026 City Council minutes record it (doc_34ef709435ea7b2b p. 3):
 * "Motion: Council Member Nair moved approve item 5.4 as presented. (Ordinance 2026-07) ... No: Council
 * Members Holdaway and Lauret. Tie Vote resolved by Mayor Stratton's vote of Yes. Motion Passed 3-2."
 */
const ORD_07 = {
  id: 'doc_34ef709435ea7b2b:2',
  document_id: 'doc_34ef709435ea7b2b',
  meeting_id: 'mtg_cc_aug11',
  body_id: 'city-council',
  meeting_date: '2026-08-11',
  seq: 2,
  item: '5.4 Approve Ordinance 2026-07 Amending Municipal Code for the Planning Department (Anthony Fletcher)',
  motion: 'approve item 5.4 as presented. (Ordinance 2026-07)',
  mover: 'Nair',
  seconder: null,
  result: 'carried',
  tally: '3-2',
  tie_break: 1,
  unanimous: 0,
  inferred: 0,
  refs: JSON.stringify(['Ordinance 2026-07']),
  page: 3,
  items: null,
};
const RES_34 = { ...ORD_07, id: 'doc_34ef709435ea7b2b:3', seq: 3, item: '5.5 Approve Resolution 2026-34 Amending the Consolidated Fee Schedule', motion: 'approve 5.5 with an amendment', mover: 'McCumber', tally: '4-0', tie_break: 0, unanimous: 1, refs: JSON.stringify(['Resolution 2026-34']) };
const VOTES = [
  { motion_id: ORD_07.id, member: 'Ezra Nair', vote: 'yes' },
  { motion_id: ORD_07.id, member: 'McCumber', vote: 'yes' },
  { motion_id: ORD_07.id, member: 'Stratton', vote: 'yes' },
  { motion_id: ORD_07.id, member: 'Holdaway', vote: 'no' },
  { motion_id: ORD_07.id, member: 'Lauret', vote: 'no' },
];
/** The directory today: Nair has left the council (Chip Price holds his seat). */
const PEOPLE = [
  { slug: 'zack-stratton', name: 'Zack Stratton', kind: 'elected', role: 'Mayor', department: null, email: null, phone: null },
  ...['David Lauret', 'Jacob Holdaway', 'Jacob Wood', 'Parker McCumber', 'Chip Price'].map((name) => ({ slug: name.toLowerCase().replace(' ', '-'), name, kind: 'elected', role: 'Council Member', department: null, email: null, phone: null })),
  { slug: 'jesse-riddle', name: 'Jesse Riddle', kind: 'staff', role: 'City Attorney', department: null, email: null, phone: null },
];

function votesDb(mayorLine: string | null = 'Mayor Stratton') {
  return {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        run: async () => ({}),
        first: async () => {
          if (/SELECT count\(\*\) AS n FROM motions m/.test(sql)) return { n: 2 };
          if (/FROM meeting_attendance WHERE document_id = \? AND member LIKE 'Mayor %'/.test(sql)) return mayorLine ? { member: mayorLine } : null;
          if (/FROM documents d LEFT JOIN meetings m/.test(sql)) return { title: '08.11.2026 City Council Minutes', document_date: '2026-08-11', document_type: 'minutes', original_url: null, archive_status: null, archive_key: null, meeting_id: 'mtg_cc_aug11', meeting_title: 'City Council Meeting' };
          return null;
        },
        all: async () => {
          if (/SELECT m\.\* FROM motions m/.test(sql)) return { results: [ORD_07, RES_34] };
          if (/FROM motion_votes WHERE motion_id IN/.test(sql)) return { results: VOTES };
          if (/SELECT member FROM motion_votes m WHERE/.test(sql)) return { results: [{ member: 'Ezra Nair' }] };
          if (/FROM people/.test(sql)) return { results: PEOPLE };
          return { results: [] };
        },
      };
      return stmt;
    },
    batch: async () => [],
    exec: async () => ({}),
  };
}

async function ask(env: Partial<Env>, body: unknown) {
  const req = new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `t${Math.random()}` }, body: JSON.stringify(body) });
  const res = await handleAsk(env as Env, req);
  return res.json() as Promise<{ answer: string; engine: string; section?: { path: string }; citations: Array<{ documentId: string; page: number | null }>; votes?: { items: Array<{ id: string }> } }>;
}

describe('votes on a numbered ordinance or resolution, from the voting records', () => {
  it('answers "how did the council vote on Ordinance 2026-07" with the tally, the tie break and every member by title', async () => {
    const r = await ask({ CATALOG_DB: votesDb() as never }, { question: 'How did the council vote on Ordinance 2026-07?' });
    expect(r.engine).toBe('votes-measure');
    expect(r.answer).toContain('Ordinance 2026-07 passed 3 to 2 at the August 11, 2026 City Council meeting, Mayor Stratton breaking the tie. [1]');
    expect(r.answer).toContain('Voting yes: Council Member McCumber, Council Member Nair and Mayor Stratton. Voting no: Council Member Holdaway and Council Member Lauret. [1]');
    expect(r.answer).toContain('Council Member Nair moved it.');
    expect(r.answer).not.toMatch(/Ezra|Zack|Parker|David|Jacob|unanimous|[–—]/);
    expect(r.citations).toEqual([expect.objectContaining({ documentId: 'doc_34ef709435ea7b2b', page: 3 })]);
    expect(r.votes?.items.map((m) => m.id)).toEqual([ORD_07.id]);
    expect(r.section?.path).toBe('/votes');
  });

  it('answers how one member voted, first', async () => {
    const r = await ask({ CATALOG_DB: votesDb() as never }, { question: 'How did Council Member McCumber vote on Ordinance 2026-07?' });
    expect(r.engine).toBe('votes-measure');
    expect(r.answer.startsWith('Council Member McCumber voted yes on Ordinance 2026-07 at the August 11, 2026 City Council meeting. [1]')).toBe(true);
  });

  it('answers who broke the tie, the mayor of that meeting by title', async () => {
    const r = await ask({ CATALOG_DB: votesDb(null) as never }, { question: 'Who broke the tie on Ordinance 2026-07?' });
    expect(r.engine).toBe('votes-measure');
    expect(r.answer.startsWith('Mayor Stratton broke the tie on Ordinance 2026-07, voting yes, at the August 11, 2026 City Council meeting. [1]')).toBe(true);
    expect(r.answer).not.toMatch(/Council Member Wood (broke|cast)/);
  });

  it('says there was no tie when the minutes record none', async () => {
    const r = await ask({ CATALOG_DB: votesDb() as never }, { question: 'Who broke the tie on Resolution 2026-34?' });
    expect(r.answer).toContain('The minutes record no tie on Resolution 2026-34.');
    expect(r.answer).toContain('Resolution 2026-34 passed 4 to 0 at the August 11, 2026 City Council meeting.');
  });

  it('reads the measure from the question', () => {
    expect(measureRefIn('how did they vote on ord. 2026-7')).toEqual({ kind: 'Ordinance', year: 2026, seq: 7, label: 'Ordinance 2026-07' });
    expect(measureRefIn('RES 2026-16 vote')?.label).toBe('Resolution 2026-16');
    expect(measureVotesIntent('What does Ordinance 2026-07 change?')).toBeNull();
    expect(measureVotesIntent('Who broke the tie on Ordinance 2026-07?')?.focus).toBe('tie');
    expect(motionIsAbout({ refs: [], item: '5.4 Approve Ordinance 2026-07 Amending', motion: 'approve' }, measureRefIn('Ordinance 2026-7')!)).toBe(true);
    expect(motionIsAbout({ refs: [], item: '5.4 Approve Ordinance 2026-070', motion: 'approve' }, measureRefIn('Ordinance 2026-07')!)).toBe(false);
    expect(motionIsAbout({ refs: ['Resolution 2026-07'], item: null, motion: 'approve' }, measureRefIn('Ordinance 2026-07')!)).toBe(false);
  });
});

describe('officials in a model-written answer are named by title and last name', () => {
  const roster = officialRoster(PEOPLE);

  it('rewrites the live Ordinance 2026-07 answer', () => {
    const live = 'The mayor, Zack Stratton, broke the tie on Ordinance 2026-07. The ordinance was approved 3-2, with Ezra Nair, Parker McCumber, and Zack Stratton voting yes, and David Lauret and Jacob Holdaway voting no.';
    expect(titleOfficials(live, roster, ['2026-08-11'])).toBe(
      'Mayor Stratton broke the tie on Ordinance 2026-07. The ordinance was approved 3-2, with Council Member Nair, Council Member McCumber, and Mayor Stratton voting yes, and Council Member Lauret and Council Member Holdaway voting no.',
    );
  });

  it('normalizes a title already written and expands a plural one', () => {
    expect(titleOfficials('Councilmember Ezra Nair voted against it.', roster, ['2026-03-10'])).toBe('Council Member Nair voted against it.');
    expect(titleOfficials('Councilmember Nair voted against it.', roster, [])).toBe('Council Member Nair voted against it.');
    expect(titleOfficials('Council Members Holdaway and Lauret voted no.', roster, ['2026-08-11'])).toBe('Council Member Holdaway and Council Member Lauret voted no.');
    expect(titleOfficials('Holdaway voted no.', roster, ['2026-08-11'])).toBe('Council Member Holdaway voted no.');
    expect(titleOfficials('Mayor Zack Stratton spoke.', roster, ['2019-01-01'])).toBe('Mayor Stratton spoke.');
  });

  it('gives staff the directory job title only', () => {
    expect(titleOfficials('Jesse Riddle presented the contract.', roster, ['2026-03-10'])).toBe('City Attorney Riddle presented the contract.');
    expect(directoryTitle({ kind: 'staff', role: 'Director of Community Development' })).toBeNull();
    expect(directoryTitle({ kind: 'elected', role: 'Mayor Pro Tem' })).toBe('Council Member');
  });

  it('never invents a title: places, other people, and records outside a seat are left as written', () => {
    expect(titleOfficials('The Holdaway Fields agreement passed.', roster, ['2026-09-15'])).toBe('The Holdaway Fields agreement passed.');
    expect(titleOfficials('Sarah Holdaway spoke in public comment.', roster, ['2026-09-15'])).toBe('Sarah Holdaway spoke in public comment.');
    expect(titleOfficials('Zack Stratton spoke in public comment.', roster, ['2019-05-01'])).toBe('Zack Stratton spoke in public comment.');
    expect(titleOfficials('Ezra Nair spoke in public comment.', roster, ['2026-10-01'])).toBe('Ezra Nair spoke in public comment.');
    expect(titleOfficials('Jacob Wood moved to approve.', roster, ['2026-08-11'])).toBe('Council Member Wood moved to approve.');
    expect(titleOfficials('The Wood family spoke.', roster, ['2026-08-11'])).toBe('The Wood family spoke.');
  });
});
