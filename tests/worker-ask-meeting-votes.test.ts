import { describe, expect, it } from 'vitest';
import { handleAsk } from '../worker/ai/rag';
import type { Env } from '../worker/env';
import type { ConvTurn } from '../worker/ai/followup';
import { meetingDateIn, meetingFollowUp, meetingVotesIntent, memberTitle, motionLine } from '../worker/ai/meetingVotes';
import { isOffTopic } from '../worker/ai/offTopic';

// Type-checked with the Worker project (tsconfig.worker.json): it runs the real ask handler.

type Motion = { id: string; document_id: string; meeting_id: string; body_id: string; meeting_date: string; seq: number; item: string; motion: string; mover: string; seconder: string; result: string; tally: string; tie_break: number; unanimous: number; inferred: number; refs: string | null; page: number; items: string | null };

/** The City Council motions of September 8, 2026, as GET /api/votes?year=2026 lists them (minutes doc_87aac14fa329d527). */
const SEPT8: Motion[] = [
  { id: 'doc_87aac14fa329d527:1', document_id: 'doc_87aac14fa329d527', meeting_id: 'mtg_cc_1442', body_id: 'city-council', meeting_date: '2026-09-08', seq: 1, item: '5.1 Appoint Steffani Winder to the Vineyard Library Board', motion: "accept the mayor's appointment as presented", mover: 'Parker McCumber', seconder: 'David Lauret', result: 'carried', tally: '4-0', tie_break: 0, unanimous: 1, inferred: 0, refs: null, page: 3, items: null },
  { id: 'doc_87aac14fa329d527:2', document_id: 'doc_87aac14fa329d527', meeting_id: 'mtg_cc_1442', body_id: 'city-council', meeting_date: '2026-09-08', seq: 2, item: 'Consent items', motion: 'approve the Consent items as presented', mover: 'Parker McCumber', seconder: 'Jacob Holdaway', result: 'carried', tally: '4-0', tie_break: 0, unanimous: 1, inferred: 0, refs: null, page: 3, items: JSON.stringify(['8.1 Approval of the August 25, 2026, City Council Meeting Minutes']) },
  { id: 'doc_87aac14fa329d527:3', document_id: 'doc_87aac14fa329d527', meeting_id: 'mtg_cc_1442', body_id: 'city-council', meeting_date: '2026-09-08', seq: 3, item: 'Consent items', motion: 'approve the Consent items as presented', mover: 'Parker McCumber', seconder: 'David Lauret', result: 'carried', tally: '4-0', tie_break: 0, unanimous: 1, inferred: 0, refs: null, page: 3, items: JSON.stringify(['9.1 DISCUSSION AND ACTION - 300 West Parking and Striping Plan']) },
];
const MEMBERS = ['David Lauret', 'Jacob Holdaway', 'Jacob Wood', 'Parker McCumber'];
const PEOPLE = [
  { slug: 'zack-stratton', name: 'Zack Stratton', kind: 'elected', role: 'Mayor', department: null, email: null, phone: null },
  ...MEMBERS.map((name) => ({ slug: name.toLowerCase().replace(' ', '-'), name, kind: 'elected', role: 'Council Member', department: null, email: null, phone: null })),
];

/** A catalog database holding one meeting's motions; `noBy` makes that member vote no on the second motion. */
function votesDb(motions: Motion[], noBy: string | null = null) {
  const votes = motions.flatMap((m) => MEMBERS.map((member) => ({ motion_id: m.id, member, vote: noBy === member && m.seq === 2 ? 'no' : 'yes' })));
  return {
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind: (...p: unknown[]) => ((params = p), stmt),
        run: async () => ({}),
        first: async () => {
          if (/SELECT count\(\*\) AS n FROM motions m/.test(sql)) return { n: motions.filter((m) => params.includes(m.meeting_date)).length };
          if (/FROM documents d LEFT JOIN meetings m/.test(sql)) return { title: '09.08.2026 City Council Minutes', document_date: '2026-09-08', document_type: 'minutes', original_url: null, archive_status: null, archive_key: null, meeting_id: 'mtg_cc_1442', meeting_title: 'City Council Meeting' };
          return null;
        },
        all: async () => {
          if (/SELECT m\.\* FROM motions m/.test(sql)) return { results: motions.filter((m) => params.includes(m.meeting_date)) };
          if (/FROM motion_votes WHERE motion_id IN/.test(sql)) return { results: votes };
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
  return res.json() as Promise<{ question: string; answer: string; engine: string; mode?: string; citations: Array<{ documentId: string; page: number | null }>; votes?: { items: Array<{ id: string }> } }>;
}

const Q1 = 'what did the city council vote on at the September 8 meeting';
const convo: ConvTurn[] = [
  { role: 'user', content: Q1 },
  { role: 'assistant', content: 'The City Council recorded 3 motions at its September 8, 2026 meeting.' },
];
const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const sept8 = meetingDateIn('September 8', today)!;

describe('votes at one meeting, from the voting records', () => {
  it('lists every recorded motion of the meeting, the Library Board appointment included, each with its result, citing the minutes', async () => {
    const r = await ask({ CATALOG_DB: votesDb(SEPT8.map((m) => ({ ...m, meeting_date: sept8 }))) as never }, { question: Q1 });
    expect(r.engine).toBe('votes-meeting');
    expect(r.answer).toContain('The City Council recorded 3 motions at its September 8,');
    expect(r.answer).toContain("5.1 Appoint Steffani Winder to the Vineyard Library Board: motion to accept the mayor's appointment as presented. Passed 4-0.");
    expect(r.answer).toContain('Consent items (8.1 Approval of the August 25, 2026, City Council Meeting Minutes): motion to approve the Consent items as presented. Passed 4-0.');
    expect(r.answer).toContain('Consent items (9.1 300 West Parking and Striping Plan)');
    expect(r.citations.map((c) => c.documentId)).toEqual(['doc_87aac14fa329d527']);
    expect(r.citations[0].page).toBe(3);
    expect(r.votes?.items.map((m) => m.id)).toEqual(SEPT8.map((m) => m.id));
    expect(r.answer).not.toMatch(/[–—]/);
  });

  it('answers "did anyone vote no that night?" for the same meeting: every motion passed with no No votes', async () => {
    const r = await ask({ CATALOG_DB: votesDb(SEPT8.map((m) => ({ ...m, meeting_date: sept8 }))) as never }, { question: 'did anyone vote no that night?', conversation: convo, stream: true });
    expect(r.question).toMatch(/^Did anyone vote no at the September 8, \d{4} City Council meeting\?$/);
    expect(r.engine).toBe('votes-meeting');
    expect(r.answer).toMatch(/^Every recorded motion at the September 8, \d{4} City Council meeting passed, with no No votes\. \[1\]$/);
    expect(r.answer).not.toMatch(/couldn't find/i);
  });

  it('names the members who voted no by title and last name', async () => {
    const r = await ask({ CATALOG_DB: votesDb(SEPT8.map((m) => ({ ...m, meeting_date: sept8 })), 'Parker McCumber') as never }, { question: 'did anyone vote no at that meeting?', conversation: convo });
    expect(r.answer).toContain('One recorded motion at the September 8,');
    expect(r.answer).toContain('Voting No: Council Member McCumber.');
    expect(r.answer).toContain('8.1 Approval of the August 25, 2026, City Council Meeting Minutes');
    expect(r.answer).not.toContain('Library Board');
  });

  it('resolves follow-ups and dates deterministically', () => {
    expect(meetingDateIn('the September 8 meeting', '2026-10-11')).toBe('2026-09-08');
    expect(meetingDateIn('Sept. 8th, 2025', '2026-10-11')).toBe('2025-09-08');
    expect(meetingDateIn('the 9/8 meeting', '2026-10-11')).toBe('2026-09-08');
    expect(meetingDateIn('December 3 meeting', '2026-10-11')).toBe('2025-12-03');
    expect(meetingDateIn('a $3.5 million motion', '2026-10-11')).toBeNull();
    expect(meetingVotesIntent(Q1, '2026-10-11')).toEqual({ date: '2026-09-08', body: 'city-council', kind: 'all' });
    expect(meetingVotesIntent('What did the RDA approve on August 25?', '2026-10-11')).toEqual({ date: '2026-08-25', body: 'redevelopment-agency', kind: 'all' });
    expect(meetingVotesIntent('When is the next council meeting?', '2026-10-11')).toBeNull();
    expect(meetingFollowUp('did anyone vote no that night?', convo, '2026-10-11')).toBe('Did anyone vote no at the September 8, 2026 City Council meeting?');
    expect(meetingFollowUp('was it unanimous?', convo, '2026-10-11')).toBe('What did the City Council vote on at its September 8, 2026 meeting?');
    expect(meetingFollowUp('who spoke during public comment at that meeting?', convo, '2026-10-11')).toBe('Who spoke during public comment at the September 8, 2026 City Council meeting?');
    expect(meetingFollowUp('and parks?', convo, '2026-10-11')).toBeNull();
    expect(meetingFollowUp('did anyone vote no that night?', [{ role: 'user', content: 'How much is the police budget?' }], '2026-10-11')).toBeNull();
    expect(motionLine({ item: '8.1 Approve Ordinance 2026\u201310 Budget Amendments', motion: 'adopt Ordinance 2026-10', result: 'carried', tally: '4-0', items: [], votes: [] })).toBe('8.1 Approve Ordinance 2026-10 Budget Amendments: motion to adopt Ordinance 2026-10. Passed 4-0.');
    expect(memberTitle('Zack Stratton', 'city-council', 'Zack Stratton')).toBe('Mayor Stratton');
    expect(memberTitle('Jacob Wood', 'redevelopment-agency', null)).toBe('Board Member Wood');
  });
});

describe('off-topic questions', () => {
  it('answers with one short line, no sources', async () => {
    const r = await ask({ CATALOG_DB: votesDb([]) as never }, { question: "what's the weather in Paris" });
    expect(r.answer).toBe('This portal covers Vineyard city records only.');
    expect(r.mode).toBe('conversation');
    expect(r.citations).toEqual([]);
  });

  it('catches general topics and leaves Vineyard questions alone', () => {
    for (const q of ["what's the weather in Paris", 'who won the super bowl', 'NBA scores last night', 'what is the capital of France', 'give me a recipe for lasagna', 'what is the bitcoin price', 'tell me a joke'])
      expect(isOffTopic(q), q).toBe(true);
    for (const q of [
      'Is there a weather alert in Vineyard?',
      'Is Utah Lake safe to swim in?',
      'What parks have pickleball courts?',
      'When does the snow plow come?',
      'youth soccer registration',
      'Did the council approve the Texas Roadhouse site plan?',
      'What did the city council vote on at the September 8 meeting',
      'what is the property tax rate',
      'What is the weather policy for city events?',
    ])
      expect(isOffTopic(q), q).toBe(false);
  });
});
