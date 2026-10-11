import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { handleAsk, budgetParagraphs, quotaField, RAG_SYSTEM_PROMPT, resetAiBreaker, standsAlone } from '../worker/ai/rag';
import { SearchRepository } from '../worker/search/SearchRepository';
import { bodyClarify, docLookupIntent, feeIntent, lastMeetingIntent, personClarify, recordLookupIntent, resolveFollowUp, suggestFollowUps } from '../worker/ai/lookups';
import { DEAD_END, pickQuotes, recordSentences, routeFor } from '../worker/ai/quotes';
import type { Env } from '../worker/env';

// Type-checked with the Worker project (tsconfig.worker.json): it runs the real ask handler over a real
// (in-memory) catalog and search shard. Every motion, title and page below is as GET /api/votes and
// GET /api/records/ordinances?year=2026 listed them on October 11, 2026 (Diagnostics run 38152760553,
// extra_1 and extra_3), abridged.

const TODAY = '2026-10-11';
const now = new Date().toISOString();

type MotionSeed = { id: string; doc: string; meeting: string; body: string; date: string; seq: number; item: string; motion: string; mover: string | null; seconder: string | null; result: string; tally: string | null; refs?: string[]; page: number; no?: string[] };

const MOTIONS: MotionSeed[] = [
  { id: 'doc_f7aa0533b44d693c:2', doc: 'doc_f7aa0533b44d693c', meeting: 'mtg_cc_1430', body: 'city-council', date: '2026-06-23', seq: 2, item: '8.1 Approve Ordinance 2026-09, Stormwater Management Code Update', motion: 'approve Ordinance 2026-09, Stormwater Management Code Update', mover: 'Jacob Holdaway', seconder: 'David Lauret', result: 'carried', tally: '4-0', refs: ['Ordinance 2026-09'], page: 3 },
  { id: 'doc_34ef709435ea7b2b:3', doc: 'doc_34ef709435ea7b2b', meeting: 'mtg_cc_1441', body: 'city-council', date: '2026-08-11', seq: 3, item: '5.5 Approve Resolution 2026-34 Amending the Consolidated Fee Schedule', motion: 'approve 5.5 with an amendment', mover: 'Ezra Nair', seconder: 'Parker McCumber', result: 'carried', tally: '4-0', page: 3 },
  { id: 'doc_87aac14fa329d527:1', doc: 'doc_87aac14fa329d527', meeting: 'mtg_cc_1442', body: 'city-council', date: '2026-09-08', seq: 1, item: '5.1 Appoint Steffani Winder to the Vineyard Library Board', motion: "accept the mayor's appointment as presented", mover: 'Parker McCumber', seconder: 'David Lauret', result: 'carried', tally: '4-0', page: 3 },
  { id: 'doc_5f867130115b8be0:2', doc: 'doc_5f867130115b8be0', meeting: 'mtg_cc_1652', body: 'city-council', date: '2026-09-15', seq: 2, item: '7.1 Approve the First Amendment to the Holdaway Fields Development Agreement', motion: 'approve the First Amendment to the Holdaway agreement', mover: 'Jacob Wood', seconder: 'David Lauret', result: 'carried', tally: '4-0', page: 4 },
  { id: 'doc_65bbcb853249cc0d:2', doc: 'doc_65bbcb853249cc0d', meeting: 'mtg_cc_1677', body: 'redevelopment-agency', date: '2026-09-15', seq: 2, item: '3.1 Approve the Appointment of RDA Directors', motion: 'approve the appointment of Rob Sant and Steven Proud to serve as RDA directors', mover: 'David Lauret', seconder: 'Parker McCumber', result: 'carried', tally: '5-0', page: 2 },
];
const MEMBERS = ['David Lauret', 'Jacob Holdaway', 'Jacob Wood', 'Parker McCumber'];

async function seed() {
  const env = testEnv();
  const db = env.CATALOG_DB.db;
  db.exec('ALTER TABLE quota_usage ADD COLUMN ai_neurons REAL NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS motions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, meeting_id TEXT, body_id TEXT, meeting_date TEXT, seq INTEGER, item TEXT, motion TEXT, mover TEXT, seconder TEXT, result TEXT, tally TEXT, tie_break INTEGER NOT NULL DEFAULT 0, unanimous INTEGER NOT NULL DEFAULT 0, inferred INTEGER NOT NULL DEFAULT 0, refs TEXT, page INTEGER, items TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS motion_votes (motion_id TEXT NOT NULL, member TEXT NOT NULL, vote TEXT NOT NULL, meeting_date TEXT, body_id TEXT, PRIMARY KEY (motion_id, member))`);
  db.exec(`CREATE TABLE IF NOT EXISTS meeting_attendance (document_id TEXT NOT NULL, body_id TEXT, meeting_date TEXT, member TEXT NOT NULL, status TEXT NOT NULL, PRIMARY KEY (document_id, member))`);
  db.exec(`CREATE TABLE IF NOT EXISTS vote_docs (document_id TEXT PRIMARY KEY, meeting_key TEXT, body_id TEXT, meeting_date TEXT, rank INTEGER NOT NULL DEFAULT 0, motions INTEGER NOT NULL DEFAULT 0, parser INTEGER NOT NULL, parsed_at TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS vote_members (member TEXT PRIMARY KEY, full_name TEXT, first_date TEXT, last_date TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS meeting_roster (document_id TEXT NOT NULL, body_id TEXT, meeting_date TEXT, name TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY (document_id, name))`);
  db.exec(`CREATE TABLE IF NOT EXISTS people (slug TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL, title TEXT, department TEXT, term TEXT, email TEXT, phone TEXT, photo_url TEXT, source_url TEXT NOT NULL, current INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)`);
  const person = db.prepare(`INSERT INTO people (slug, name, kind, role, department, email, phone, source_url, current, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, 'https://www.vineyardutah.gov/', 1, ?, ?)`);
  person.run('zack-stratton', 'Zack Stratton', 'elected', 'Mayor', null, 'mayor@vineyardutah.gov', null, now, now);
  for (const n of MEMBERS) person.run(n.toLowerCase().replace(' ', '-'), n, 'elected', 'Council Member', null, null, null, now, now);
  person.run('christopher-thomas', 'Christopher Thomas', 'staff', 'Streets & Stormwater Manager', 'Public Works', 'christophert@vineyardutah.gov', null, now, now);
  const meeting = db.prepare(`INSERT INTO meetings (id, slug, title, government_body_id, government_body_name, meeting_type, meeting_date, source_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'regular', ?, 'civicclerk', ?, ?)`);
  for (const m of MOTIONS) {
    const name = m.body === 'city-council' ? 'City Council' : 'Redevelopment Agency';
    try {
      meeting.run(m.meeting, m.meeting, `${name} Meeting`, m.body, name, m.date, now, now);
    } catch {
      /* one meeting, several motions */
    }
    db.prepare(`INSERT INTO motions (id, document_id, meeting_id, body_id, meeting_date, seq, item, motion, mover, seconder, result, tally, unanimous, refs, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(m.id, m.doc, m.meeting, m.body, m.date, m.seq, m.item, m.motion, m.mover, m.seconder, m.result, m.tally, 1, JSON.stringify(m.refs ?? []), m.page);
    for (const member of MEMBERS) db.prepare(`INSERT INTO motion_votes (motion_id, member, vote, meeting_date, body_id) VALUES (?, ?, ?, ?, ?)`).run(m.id, member, 'yes', m.date, m.body);
  }
  const repo = new SearchRepository(env);
  const doc = async (id: string, title: string, type: string, date: string, body: string | null, meetingId: string | null, number: string | null, pages: string[]) => {
    db.prepare(
      `INSERT INTO documents (id, slug, title, document_type, document_number, document_date, year, government_body_id, government_body_name, meeting_id, source_id, search_shard, created_at, updated_at, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'civicclerk', 0, ?, ?, ?, ?)`,
    ).run(id, id, title, type, number, date, Number(date.slice(0, 4)), body, body === 'city-council' ? 'City Council' : body ? 'Redevelopment Agency' : null, meetingId, now, now, now, now);
    await repo.replaceDocument(
      0,
      { documentId: id, title, documentType: type, documentNumber: number, documentDate: date, year: Number(date.slice(0, 4)), governmentBodyId: body, sourceId: 'civicclerk', meetingId, categories: [], currency: 'historical' },
      pages.map((text, i) => ({ id: `${id}:${i + 1}`, pageStart: i + 1, pageEnd: i + 1, sectionTitle: null, text })),
    );
  };
  await doc('doc_61a1c86ee9d874b1', 'Ordinance 2026-09, Amending Title 7 By Adopting Chapter 7.08, Stormwater Management', 'ordinance', '2026-06-23', 'city-council', null, '2026-09', ['AN ORDINANCE AMENDING TITLE 7 OF THE VINEYARD CITY MUNICIPAL CODE BY ADOPTING CHAPTER 7.08, STORMWATER MANAGEMENT.']);
  await doc('doc_f7aa0533b44d693c', '06.23.2026 City Council Minutes', 'minutes', '2026-06-23', 'city-council', 'mtg_cc_1430', null, ['Roll call.', 'Council Member Holdaway moved to approve Ordinance 2026-09, Stormwater Management Code Update. Council Member Lauret seconded. Motion passed 4-0.']);
  await doc('doc_87aac14fa329d527', '09.08.2026 City Council Minutes', 'minutes', '2026-09-08', 'city-council', 'mtg_cc_1442', null, ['Roll call.', '', 'Council Member McCumber motioned to accept the mayor\'s appointment of Steffani Winder to the Vineyard Library Board as presented.']);
  await doc('doc_8f_parks', 'Parks and Recreation Master Plan 2024', 'plan', '2024-05-01', null, null, null, [
    'The splash pad at Grove Park is open from Memorial Day through Labor Day each summer, weather permitting. Pickleball courts at Gammon Park are open from dawn to dusk.',
  ]);
  await doc('doc_7a00ea67e1a359b2', 'Clean - Consolidated Fee Schedule fin (Public Hearing Notice, 2026-04-28, item a)', 'other', '2026-04-28', null, null, null, [
    'Consolidated Fee Schedule 2025-2026 Fiscal Year Table of Contents Administrative Fees 2',
    'Large Park Pavilion Rental\n\nSmall Park Pavilion Rental\n\n$75\n\n$40\n\nThe pavilion rental fee is due at the time of reservation and is refundable up to seven days before the reservation date.',
  ]);
  return env;
}

/** Workers AI stand-in: the reranker keeps the order and the answer is `write(user message)`. */
function ai(write: (user: string) => string) {
  return {
    run: async (_model: string, input: Record<string, unknown>) => {
      if (typeof input.query === 'string') return { response: (input.contexts as unknown[]).map((_, i) => ({ id: i, score: 0.9 - i * 0.001 })) };
      const msgs = (input.messages ?? []) as Array<{ role: string; content: string }>;
      if (msgs[0]?.content.startsWith(RAG_SYSTEM_PROMPT.slice(0, 60))) return { response: write(msgs[msgs.length - 1].content) };
      return { response: 'not json' };
    },
  };
}

type R = { question: string; answer: string; engine: string; citations: Array<{ documentId: string; page: number | null }>; section?: { path: string }; clarify?: { prompt: string; choices: Array<{ label: string; question: string }> }; suggestedFollowUps: string[]; paragraphs: Array<{ list?: boolean; table?: unknown; segments: Array<{ text: string }> }>; relatedDocuments: Array<{ id: string }>; contact?: string };

async function ask(env: Env, body: unknown): Promise<R> {
  const req = new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `t${Math.random()}` }, body: JSON.stringify(body) });
  return (await handleAsk(env, req)).json() as Promise<R>;
}

const convoOf = (pairs: Array<[string, R]>) => pairs.flatMap(([q, r]) => [{ role: 'user', content: q }, { role: 'assistant', content: r.answer }]);

describe('numbered records, meeting documents and last-meeting votes, by code', () => {
  it('shows Ordinance 2026-09 with its title and adoption, citing the ordinance and the minutes page', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'Show me Ordinance 2026-09' });
    expect(r.engine).toBe('record-lookup');
    expect(r.answer).toContain('Ordinance 2026-09');
    expect(r.answer).toContain('June 23, 2026');
    expect(r.citations.map((c) => c.documentId)).toContain('doc_61a1c86ee9d874b1');
    expect(r.section?.path).toBe('/documents/doc_61a1c86ee9d874b1');
    expect(r.answer).not.toMatch(/[–—]/);
  });

  it('finds the minutes of a dated meeting and opens them at page 1, with the meeting card', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'Find the minutes for the September 8, 2026 City Council meeting' });
    expect(r.engine).toBe('meeting-docs');
    expect(r.answer).toBe('The minutes of the September 8, 2026 City Council meeting are posted: 09.08.2026 City Council Minutes. [1]');
    expect(r.citations[0]).toMatchObject({ documentId: 'doc_87aac14fa329d527', page: 1 });
    expect(r.section?.path).toBe('/meetings/mtg_cc_1442');
  });

  it('answers "what passed at the last council meeting?", then "and the one before that?", from the voting records', async () => {
    const env = await seed();
    const q1 = 'What passed at the last council meeting?';
    const r1 = await ask(env as unknown as Env, { question: q1 });
    expect(r1.engine).toBe('votes-meeting');
    expect(r1.answer).toContain('September 15, 2026');
    expect(r1.answer).toContain('Holdaway Fields');
    expect(r1.paragraphs[0].segments).toHaveLength(1);
    const r2 = await ask(env as unknown as Env, { question: 'and the one before that?', conversation: convoOf([[q1, r1]]) });
    expect(r2.question).toBe('What did the City Council vote on at the meeting before September 15, 2026?');
    expect(r2.engine).toBe('votes-meeting');
    expect(r2.answer).toContain('September 8, 2026');
    expect(r2.answer).toContain('Steffani Winder');
    // Three turns: who moved them, then the minutes of that meeting.
    const r3 = await ask(env as unknown as Env, { question: 'who made the motion?', conversation: convoOf([[q1, r1], ['and the one before that?', r2]]) });
    expect(r3.question).toBe('Who moved and seconded the motions at the September 8, 2026 City Council meeting?');
    expect(r3.answer).toContain('moved by Council Member McCumber, seconded by Council Member Lauret');
    const r4 = await ask(env as unknown as Env, { question: 'show me the minutes', conversation: convoOf([[q1, r1], ['and the one before that?', r2], ['who made the motion?', r3]]) });
    expect(r4.engine).toBe('meeting-docs');
    expect(r4.citations[0].documentId).toBe('doc_87aac14fa329d527');
  });

  it('answers "who seconded it?" after an ordinance question with the recorded mover and seconder', async () => {
    const env = await seed();
    const q1 = 'How did the council vote on Ordinance 2026-09?';
    const r1 = await ask(env as unknown as Env, { question: q1 });
    expect(r1.engine).toBe('votes-measure');
    const r2 = await ask(env as unknown as Env, { question: 'who seconded it?', conversation: convoOf([[q1, r1]]) });
    expect(r2.question).toBe('Who moved and seconded Ordinance 2026-09?');
    expect(r2.answer.startsWith('Council Member Holdaway moved Ordinance 2026-09 and Council Member Lauret seconded.')).toBe(true);
  });
});

describe('more code paths', () => {
  it('finds a motion by the names it gives and says who moved and seconded it', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'Who seconded the motion to appoint Steffani Winder?' });
    expect(r.engine).toBe('votes-mover');
    expect(r.answer).toContain('moved by Council Member McCumber, seconded by Council Member Lauret at the September 8, 2026 City Council meeting');
    expect(r.citations[0]).toMatchObject({ documentId: 'doc_87aac14fa329d527', page: 3 });
  });

  it('offers the meetings of a month as choices, and answers a month with one meeting', async () => {
    const env = await seed();
    const one = await ask(env as unknown as Env, { question: 'What did the RDA vote on in September 2026?' });
    expect(one.engine).toBe('votes-meeting');
    expect(one.answer).toContain('Rob Sant');
    const env2 = await seed();
    env2.CATALOG_DB.db.prepare(`INSERT INTO motions (id, document_id, meeting_id, body_id, meeting_date, seq, item, motion, mover, seconder, result, tally, unanimous, refs, page) VALUES ('x:1', 'x', 'm', 'city-council', '2026-09-22', 1, 'Consent items', 'approve', null, null, 'carried', '4-0', 1, '[]', 1)`).run();
    const many = await ask(env2 as unknown as Env, { question: 'What did the City Council vote on in September 2026?' });
    expect(many.engine).toBe('clarify');
    expect(many.clarify?.choices.map((c) => c.label)).toEqual(['September 8, 2026', 'September 15, 2026', 'September 22, 2026']);
  });

  it('reads "how did the council vote on it?" after a record as that record, without a model', async () => {
    const env = await seed();
    const q1 = 'Show me Ordinance 2026-09';
    const r1 = await ask(env as unknown as Env, { question: q1 });
    const r2 = await ask(env as unknown as Env, { question: 'How did the council vote on it?', conversation: convoOf([[q1, r1]]) });
    expect(r2.question).toBe('How did the council vote on Ordinance 2026-09?');
    expect(r2.engine).toBe('votes-measure');
  });

  it('says plainly when the index has no record of that number, and opens the index', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'Show Ordinance 2026-03' });
    expect(r.engine).toBe('record-lookup');
    expect(r.answer).toBe("The portal's ordinance index for 2026 has no Ordinance 2026-03 on file.");
    expect(r.section?.path).toBe('/records/ordinances?year=2026');
  });

  it('skips the rewrite model only for follow-ups that name their own subject', () => {
    expect(standsAlone('When is the next City Council meeting?', TODAY)).toBe(true);
    expect(standsAlone('How much does it cost to rent a park pavilion?', TODAY)).toBe(true);
    expect(standsAlone('Who won the Super Bowl?', TODAY)).toBe(true);
    expect(standsAlone('What is the zoning there?', TODAY)).toBe(false);
    expect(standsAlone('How did the council vote on it?', TODAY)).toBe(false);
    expect(standsAlone('Is there a cap on what it can collect?', TODAY)).toBe(false);
  });
});

describe('a short clarifying question instead of a guess', () => {
  it('asks which body when the council and the RDA both met that day, and each choice answers', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'What was approved at the September 15, 2026 meeting?' });
    expect(r.engine).toBe('clarify');
    expect(r.clarify?.choices.map((c) => c.label)).toEqual(['City Council', 'Redevelopment Agency']);
    expect(r.section?.path).toBeTruthy();
    const rda = await ask(env as unknown as Env, { question: r.clarify!.choices[1].question });
    expect(rda.engine).toBe('votes-meeting');
    expect(rda.answer).toContain('Rob Sant');
  });

  it('asks which official when two share the first name', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'How did Jacob vote on Ordinance 2026-09?' });
    expect(r.engine).toBe('clarify');
    expect(r.clarify?.choices.map((c) => c.question)).toEqual(['How did Council Member Holdaway vote on Ordinance 2026-09?', 'How did Council Member Wood vote on Ordinance 2026-09?']);
    const pick = await ask(env as unknown as Env, { question: r.clarify!.choices[1].question });
    expect(pick.engine).toBe('votes-measure');
    expect(pick.answer).toContain('Council Member Wood voted yes on Ordinance 2026-09');
  });
});

describe('no dead ends', () => {
  it('says AI answers are off in one plain line and shows the matching record as a card, never quotes', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'When is the splash pad at Grove Park open?' });
    expect(r.engine).toMatch(/^records \(AI not configured\)/);
    expect(r.answer).toBe('AI answers are off right now. Here are the best matching records.');
    expect(r.citations).toEqual([]);
    expect(r.relatedDocuments.map((d) => d.id)).toEqual(['doc_8f_parks']);
    expect(r.answer).not.toMatch(DEAD_END);
    expect(r.section?.path).toBeTruthy();
  });

  it('says AI answers are paused until the daily reset when no model can run, with record cards', async () => {
    const env = await seed();
    const capped = { run: async () => { throw new Error('4006: daily neuron cap reached (7999 of 8000)'); } };
    const r = await ask({ ...env, AI: capped } as unknown as Env, { question: 'When is the splash pad at Grove Park open?' });
    expect(r.engine).toMatch(/^records \(/);
    expect(r.answer).toMatch(/^AI answers are paused until (5|6) PM Mountain\. Here are the best matching records\.$/);
    expect(r.answer).not.toContain('The records closest');
    expect(r.relatedDocuments.map((d) => d.id)).toEqual(['doc_8f_parks']);
    expect(r.answer).not.toMatch(DEAD_END);
    resetAiBreaker();
  });

  it('tries the lite model when the main model fails, and answers from it', async () => {
    const env = await seed();
    const tried: string[] = [];
    const base = ai(() => 'The splash pad at Grove Park is open from Memorial Day through Labor Day each summer [1].');
    const flaky = {
      run: async (model: string, input: Record<string, unknown>) => {
        if (Array.isArray(input.messages)) tried.push(model);
        if (Array.isArray(input.messages) && !/granite/.test(model) && String((input.messages as Array<{ content: string }>)[0]?.content ?? '').startsWith(RAG_SYSTEM_PROMPT.slice(0, 60))) throw new Error('AI timeout');
        return base.run(model, input);
      },
    };
    const r = await ask({ ...env, AI: flaky } as unknown as Env, { question: 'When is the splash pad at Grove Park open?' });
    expect(r.engine).toMatch(/granite-4\.0-h-micro/);
    expect(r.answer).toContain('Memorial Day through Labor Day');
    expect(r.citations[0]).toMatchObject({ documentId: 'doc_8f_parks' });
    expect(tried.some((m) => /granite/.test(m))).toBe(true);
  });

  it('shows one plain line with record cards when the model finds no record or none of its sentences pass the source check', async () => {
    const env = await seed();
    for (const write of [() => 'NO_RECORD', () => 'The splash pad costs $900 a day to open [1].']) {
      const r = await ask({ ...env, AI: ai(write) } as unknown as Env, { question: 'When is the splash pad at Grove Park open?' });
      expect(r.engine).toMatch(/^records \(/);
      expect(r.answer).toBe('Nothing in the archive answers that directly. These records come closest.');
      expect(r.relatedDocuments.map((d) => d.id)).toContain('doc_8f_parks');
      expect(r.answer).not.toContain('$900');
      expect(r.answer).not.toMatch(DEAD_END);
    }
  });

  it('answers a general civic question from general knowledge when no sentence needs a source', async () => {
    const env = await seed();
    const write = () => 'A splash pad is a play area where water sprays from the ground instead of filling a pool. It is meant for small children to cool off without standing water, so it needs no lifeguard.';
    const r = await ask({ ...env, AI: ai(write) } as unknown as Env, { question: 'What is a splash pad?' });
    expect(r.engine).toMatch(/\+ general$/);
    expect(r.answer).toContain('play area where water sprays');
    expect(r.citations).toEqual([]);
  });

  it('routes to the portal page that holds it when nothing matches', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'Youth Council meeting minutes on the zebra quorum' });
    expect(r.answer).not.toMatch(DEAD_END);
    expect(r.section?.path).toBe('/meetings?view=past&type=meetings&body=youth-council');
  });

  it('opens the fee schedule at the page that lists the fee, quoting it, never pairing a figure by code', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'How much is the pavilion rental fee?' });
    expect(r.engine).toBe('fee-schedule');
    expect(r.citations[0]).toMatchObject({ documentId: 'doc_7a00ea67e1a359b2', page: 2 });
    expect(r.answer).toContain('page 2');
    expect(r.answer).toContain('due at the time of reservation');
    expect(r.answer).not.toMatch(/\$75|\$40/);
  });

  it('names the staff contact by title and last name', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'Who do I contact about a pothole on my street?' });
    expect(r.engine).toBe('directory');
    expect(r.answer).toBe('The city staff contact for this is Streets & Stormwater Manager Thomas (christophert@vineyardutah.gov).');
    expect(r.contact).toBe('christopher-thomas');
  });
});

describe('suggested follow-ups are answerable', () => {
  it('every follow-up a votes answer suggests is answered by code, without a model and without a dead end', async () => {
    const env = await seed();
    const r = await ask(env as unknown as Env, { question: 'What did the City Council vote on at the September 8, 2026 meeting?' });
    expect(r.suggestedFollowUps.length).toBeGreaterThanOrEqual(2);
    for (const f of r.suggestedFollowUps) {
      const x = await ask(env as unknown as Env, { question: f });
      expect(['votes-meeting', 'meeting-docs', 'votes-measure', 'record-lookup'], `${f}: ${x.engine}`).toContain(x.engine);
      expect(x.answer).not.toMatch(DEAD_END);
    }
  });
});

describe('pure parts', () => {
  it('reads lookups from the question', () => {
    expect(recordLookupIntent('show ordinance 2026-09')).toEqual({ kind: 'ordinance', year: 2026, number: '2026-09', label: 'Ordinance 2026-09' });
    expect(recordLookupIntent('What is Resolution 2026-34 about?')?.label).toBe('Resolution 2026-34');
    expect(recordLookupIntent('RDA Resolution 2026-03')?.kind).toBe('rda-resolution');
    expect(recordLookupIntent('How did the council vote on Ordinance 2026-07?')).toBeNull();
    expect(docLookupIntent('find the minutes for the September 8 meeting', TODAY)).toEqual({ kind: 'minutes', date: '2026-09-08', body: null, latest: false });
    expect(docLookupIntent('show me the agenda for the last RDA meeting', TODAY)).toEqual({ kind: 'agenda', date: null, body: 'redevelopment-agency', latest: true });
    expect(docLookupIntent('what did the minutes say about parking on September 8', TODAY)).toBeNull();
    expect(lastMeetingIntent('What passed at the last council meeting?', TODAY)).toEqual({ body: 'city-council', before: null, kind: 'all' });
    expect(lastMeetingIntent('What did the RDA approve at its most recent meeting?', TODAY)?.body).toBe('redevelopment-agency');
    expect(lastMeetingIntent('What did the City Council vote on at the meeting before September 8, 2026?', TODAY)).toEqual({ body: 'city-council', before: '2026-09-08', kind: 'all' });
    expect(lastMeetingIntent('When is the next council meeting?', TODAY)).toBeNull();
    expect(lastMeetingIntent('What was discussed at the last council meeting?', TODAY)).toBeNull();
    expect(feeIntent('How much is the pavilion rental fee?')?.words).toEqual(['pavilion', 'rental']);
    expect(feeIntent('How much revenue do impact fees bring in?')).toBeNull();
  });

  it('resolves short follow-ups from the conversation', () => {
    const c = (q: string, a = 'ok') => [{ role: 'user' as const, content: q }, { role: 'assistant' as const, content: a }];
    expect(resolveFollowUp('what about the RDA?', c('When is the next City Council meeting?'), TODAY)).toBe('When is the next Redevelopment Agency meeting?');
    expect(resolveFollowUp('and the planning commission?', [...c('When is the next City Council meeting?'), ...c('what about the RDA?')], TODAY)).toBe('When is the next Planning Commission meeting?');
    expect(resolveFollowUp('and the one before that?', c('What did the RDA approve on September 15, 2026?', 'The Redevelopment Agency recorded 2 motions at its September 15, 2026 meeting:'), TODAY)).toBe('What did the Redevelopment Agency vote on at the meeting before September 15, 2026?');
    expect(resolveFollowUp('who seconded it?', c('How did the council vote on Ordinance 2026-07?'), TODAY)).toBe('Who moved and seconded Ordinance 2026-07?');
    expect(resolveFollowUp('show me the minutes', c('What did the City Council vote on at the August 11, 2026 meeting?'), TODAY)).toBe('Show the minutes of the August 11, 2026 City Council meeting');
    expect(resolveFollowUp('and parks?', c('How much is the police budget?'), TODAY)).toBeNull();
    expect(resolveFollowUp('Who is the mayor?', c('When is the next City Council meeting?'), TODAY)).toBeNull();
  });

  it('asks rather than guesses', () => {
    expect(bodyClarify('What happened at the September 15 meeting?', '2026-09-15', ['city-council', 'redevelopment-agency'])!.choices.map((c) => c.question)).toEqual(['What happened at the September 15 City Council meeting?', 'What happened at the September 15 Redevelopment Agency meeting?']);
    expect(bodyClarify('What happened at the September 15 RDA meeting?', '2026-09-15', ['city-council', 'redevelopment-agency'])).toBeNull();
    expect(bodyClarify('What happened at the September 8 meeting?', '2026-09-08', ['city-council'])).toBeNull();
    const officials = [{ name: 'Jacob Holdaway', title: 'Council Member' }, { name: 'Jacob Wood', title: 'Council Member' }, { name: 'David Lauret', title: 'Council Member' }];
    expect(personClarify('Who is Jacob Wood?', officials)).toBeNull();
    expect(personClarify('How did David vote?', officials)).toBeNull();
    expect(personClarify("What is Jacob's position on the budget?", officials)?.choices).toHaveLength(2);
  });

  it('quotes whole sentences that hold the question words, never a dead-end line or a table row', () => {
    const hits = [
      { documentId: 'a', title: 'A', documentType: 'minutes', documentDate: '2026-09-08', pageStart: 3, text: 'Staff was unable to attend the splash pad meeting at Grove Park this week. 1,200 | 3,400 | 5,600 | splash pad | Grove Park | 2026. The splash pad at Grove Park reopens in May after repairs to the pump.' },
    ];
    const q = pickQuotes('When does the splash pad at Grove Park open?', hits);
    expect(q).toHaveLength(1);
    expect(q[0].sentences.join(' ')).toContain('reopens in May');
    expect(q[0].sentences.join(' ')).not.toMatch(DEAD_END);
    expect(recordSentences('Administrative Fees..........2 Building Fees.......4')).toEqual([]);
  });

  it('routes to the right page when nothing can be quoted', () => {
    expect(routeFor('When does the Planning Commission meet?').section.path).toBe('/meetings?view=past&type=meetings&body=planning-commission');
    expect(routeFor('How did the council vote on the splash pad?').section.path).toBe('/votes');
    expect(routeFor('What roads are closed for construction?').section.path).toBe('/construction');
    expect(routeFor('What is the zoning of my lot?').section.path).toBe('/map');
    expect(routeFor('Who were the 2025 candidates?').section.path).toMatch(/^\/records\?q=/);
    for (const q of ['anything at all', 'What is the RDA?', 'pavilion reservation']) expect(routeFor(q).text).not.toMatch(DEAD_END);
  });

  it('lays three or more budget figures out as a table, keeping the sentences', () => {
    const segs = [
      { text: 'The city budget is presented by fund, and the FY 27 Final Budget lists each fund on page 3:', citations: [1] },
      { text: 'General: $17,774,808.', citations: [1] },
      { text: 'Water: $7,575,979.', citations: [1] },
      { text: 'Storm Water: $2,218,000.', citations: [1] },
      { text: 'Every line is on the portal’s Budget page.', citations: [] },
    ];
    const p = budgetParagraphs(segs);
    expect(p).toHaveLength(3);
    expect(p[1].list).toBe(true);
    expect(p[1].table?.rows.map((r) => r.cells)).toEqual([
      ['General', '$17,774,808'],
      ['Water', '$7,575,979'],
      ['Storm Water', '$2,218,000'],
    ]);
    expect(p.flatMap((x) => x.segments)).toEqual(segs);
  });

  it('suggests only follow-ups with an answer path for that context', () => {
    expect(suggestFollowUps({ engine: 'votes-meeting', meeting: { date: '2026-09-08', body: 'city-council' } })).toEqual([
      'Who moved and seconded the motions at the September 8, 2026 City Council meeting?',
      'Show the minutes of the September 8, 2026 City Council meeting',
      'What did the City Council vote on at the meeting before September 8, 2026?',
    ]);
    expect(suggestFollowUps({ engine: 'schedule', scheduleBody: 'Library Board' })).toEqual(['When is the next City Council meeting?', 'When is the next Planning Commission meeting?', 'When is the next Redevelopment Agency meeting?']);
    expect(suggestFollowUps({ engine: 'gpt' })).toEqual([]);
  });
});

// Chat suite run 38155123085 (October 11, 2026): the fixes below, each checked against the record named.
describe('clarifying questions, month counts, minutes and motions read from the records', () => {
  const addMotion = (env: Awaited<ReturnType<typeof seed>>, m: MotionSeed, votes: Array<[string, string]>) => {
    const db = env.CATALOG_DB.db;
    db.prepare(`INSERT INTO motions (id, document_id, meeting_id, body_id, meeting_date, seq, item, motion, mover, seconder, result, tally, unanimous, refs, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(m.id, m.doc, m.meeting, m.body, m.date, m.seq, m.item, m.motion, m.mover, m.seconder, m.result, m.tally, votes.every(([, v]) => v === 'yes') ? 1 : 0, JSON.stringify(m.refs ?? []), m.page);
    for (const [member, vote] of votes) db.prepare(`INSERT INTO motion_votes (motion_id, member, vote, meeting_date, body_id) VALUES (?, ?, ?, ?, ?)`).run(m.id, member, vote, m.date, m.body);
  };
  const addDoc = (env: Awaited<ReturnType<typeof seed>>, id: string, title: string, date: string, body: string, meetingId: string) =>
    env.CATALOG_DB.db
      .prepare(
        `INSERT INTO documents (id, slug, title, document_type, document_date, year, government_body_id, government_body_name, meeting_id, source_id, created_at, updated_at, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, 'minutes', ?, ?, ?, ?, ?, 'civicclerk', ?, ?, ?, ?)`,
      )
      .run(id, id, title, date, Number(date.slice(0, 4)), body, body === 'city-council' ? 'City Council' : 'Redevelopment Agency', meetingId, now, now, now, now);

  it('names the bodies, the officials and the meeting dates in the question itself, and keeps the choices', async () => {
    const env = await seed();
    const bodies = await ask(env as unknown as Env, { question: 'What was approved at the September 15, 2026 meeting?' });
    expect(bodies.answer).toBe('The City Council and the Redevelopment Agency both met on September 15, 2026. Which meeting do you mean?');
    expect(bodies.clarify?.choices).toHaveLength(2);
    const jacob = await ask(env as unknown as Env, { question: 'How did Jacob vote on Ordinance 2026-09?' });
    expect(jacob.answer).toBe('Two officials are named Jacob: Council Member Holdaway and Council Member Wood. Which one do you mean?');
    env.CATALOG_DB.db.prepare(`INSERT INTO motions (id, document_id, meeting_id, body_id, meeting_date, seq, item, motion, mover, seconder, result, tally, unanimous, refs, page) VALUES ('x:1', 'x', 'm', 'city-council', '2026-09-22', 1, 'Consent items', 'approve the consent items', null, null, 'carried', '4-0', 1, '[]', 1)`).run();
    const month = await ask(env as unknown as Env, { question: 'What did the City Council vote on in September 2026?' });
    expect(month.engine).toBe('clarify');
    expect(month.answer).toBe('The City Council recorded votes at 3 meetings in September 2026: September 8, 2026; September 15, 2026; and September 22, 2026. Which meeting do you mean?');
    expect(month.clarify?.choices.map((c) => c.label)).toEqual(['September 8, 2026', 'September 15, 2026', 'September 22, 2026']);
    for (const r of [bodies, jacob, month]) expect(r.answer).not.toMatch(/[–—]/);
  });

  it('does not count a meeting whose only motions approve minutes or adjourn as a meeting with votes', async () => {
    const env = await seed();
    // The September 8, 2026 RDA meeting with only housekeeping motions recorded.
    addMotion(env, { id: 'doc_d32abfbdbbab1c76:1', doc: 'doc_d32abfbdbbab1c76', meeting: 'mtg_cc_1674', body: 'redevelopment-agency', date: '2026-09-08', seq: 1, item: '2.1 Approval of the August 25, 2026 Minutes', motion: 'approve the minutes of August 25, 2026', mover: 'Parker McCumber', seconder: 'Jacob Wood', result: 'carried', tally: '5-0', page: 1 }, MEMBERS.map((m) => [m, 'yes']));
    addMotion(env, { id: 'doc_d32abfbdbbab1c76:2', doc: 'doc_d32abfbdbbab1c76', meeting: 'mtg_cc_1674', body: 'redevelopment-agency', date: '2026-09-08', seq: 2, item: '4 Adjournment', motion: 'adjourn', mover: 'David Lauret', seconder: 'Jacob Wood', result: 'carried', tally: '5-0', page: 1 }, MEMBERS.map((m) => [m, 'yes']));
    const r = await ask(env as unknown as Env, { question: 'What did the RDA vote on in September 2026?' });
    expect(r.engine).toBe('votes-meeting');
    expect(r.answer).toContain('September 15, 2026');
    expect(r.answer).toContain('Rob Sant');
  });

  it('finds the minutes titled with the meeting date, not earlier minutes reprinted in its packet, and minutes filed under a later meeting', async () => {
    const env = await seed();
    // Filed under the September 8, 2026 meeting: the August 25 draft (an agenda item) beside the September 8 minutes.
    addDoc(env, 'doc_7a0b2b44683f4559', '8.25.26 CC Minutes - Draft (City Council, 2026-09-08, item 1)', '2026-09-08', 'city-council', 'mtg_cc_1442');
    const sep8 = await ask(env as unknown as Env, { question: 'Find the minutes for the September 8, 2026 City Council meeting' });
    expect(sep8.citations[0]).toMatchObject({ documentId: 'doc_87aac14fa329d527', page: 1 });
    // The September 15, 2026 RDA minutes: a draft filed under the October 13 meeting; the September 15 meeting holds only the September 8 draft.
    env.CATALOG_DB.db.prepare(`INSERT INTO meetings (id, slug, title, government_body_id, government_body_name, meeting_type, meeting_date, source_id, created_at, updated_at) VALUES ('mtg_cc_1706', 'mtg_cc_1706', 'Redevelopment Agency Meeting', 'redevelopment-agency', 'Redevelopment Agency', 'regular', '2026-10-13', 'civicclerk', ?, ?)`).run(now, now);
    addDoc(env, 'doc_f90799c6e8f89b75', '9.8.26 DRAFT RDA Minutes (Redevelopment Agency Board Meeting, 2026-09-15, item 1)', '2026-09-15', 'redevelopment-agency', 'mtg_cc_1677');
    addDoc(env, 'doc_65bbcb853249cc0d', '9.15.26 DRAFT RDA Minutes FIN (Redevelopment Agency Board Meeting, 2026-10-13, item 1)', '2026-10-13', 'redevelopment-agency', 'mtg_cc_1706');
    addDoc(env, 'doc_29fa094146ef6037', 'RDA September 2026 Advisor Report-Jared Tamez (Redevelopment Agency Board Meeting, 2026-10-13, item 1)', '2026-10-13', 'redevelopment-agency', 'mtg_cc_1706');
    const rda = await ask(env as unknown as Env, { question: 'Find the minutes for the September 15, 2026 RDA meeting' });
    expect(rda.engine).toBe('meeting-docs');
    expect(rda.answer).toContain('9.15.26 DRAFT RDA Minutes FIN');
    expect(rda.citations[0]).toMatchObject({ documentId: 'doc_65bbcb853249cc0d', page: 1 });
    expect(rda.section?.path).toBe('/meetings/mtg_cc_1677');
  });

  it("says the minutes are not posted when the only minutes filed under a meeting are an earlier meeting's", async () => {
    const env = await seed();
    env.CATALOG_DB.db.exec("DELETE FROM documents WHERE id = 'doc_87aac14fa329d527'");
    addDoc(env, 'doc_7a0b2b44683f4559', '8.25.26 CC Minutes - Draft (City Council, 2026-09-08, item 1)', '2026-09-08', 'city-council', 'mtg_cc_1442');
    const r = await ask(env as unknown as Env, { question: 'Find the minutes for the September 8, 2026 City Council meeting' });
    expect(r.engine).toBe('meeting-docs');
    expect(r.answer).toContain('not posted yet');
    expect(r.answer).not.toContain('8.25.26');
    expect(r.answer).not.toMatch(DEAD_END);
  });

  it('answers who moved an ordinance from its own motion, not a consent motion printed above its heading', async () => {
    const env = await seed();
    // June 23, 2026 minutes (doc_f7aa0533b44d693c): the consent motion (Wood seconded) is printed just above "8.1. Approve Ordinance 2026-09";
    // parser 18 stored it with that ordinance among its references.
    addMotion(env, { id: 'doc_f7aa0533b44d693c:1', doc: 'doc_f7aa0533b44d693c', meeting: 'mtg_cc_1430', body: 'city-council', date: '2026-06-23', seq: 1, item: '7.2 Ordinance 2026-06, Floodplain Ordinance Update', motion: 'approve the consentitems as presented', mover: 'Jacob Holdaway', seconder: 'Jacob Wood', result: 'carried', tally: '4-0', refs: ['Ordinance 2026-09'], page: 2 }, MEMBERS.map((m) => [m, 'yes']));
    const r = await ask(env as unknown as Env, { question: 'Who made the motion on Ordinance 2026-09?' });
    expect(r.engine).toBe('votes-measure');
    expect(r.answer.startsWith('Council Member Holdaway moved Ordinance 2026-09 and Council Member Lauret seconded.')).toBe(true);
  });

  it("keeps a former member's No vote when a set of minutes prints only the last name", async () => {
    const env = await seed();
    // Ezra Nair left the council in September 2026; earlier minutes print his full name.
    for (let i = 0; i < 5; i++) addMotion(env, { id: `old:${i}`, doc: 'old', meeting: 'mtg_old', body: 'city-council', date: '2026-03-10', seq: i + 1, item: `7.${i + 1} Appointment`, motion: `approve appointment ${i}`, mover: 'Ezra Nair', seconder: 'David Lauret', result: 'carried', tally: '5-0', page: 3 }, [['Ezra Nair', 'yes']]);
    // June 23, 2026 minutes, page 3: "Yes: Council Member Holdaway, Lauret, and Wood. No: Nair. MOTION PASSED 3-1".
    addMotion(env, { id: 'doc_f7aa0533b44d693c:3', doc: 'doc_f7aa0533b44d693c', meeting: 'mtg_cc_1430', body: 'city-council', date: '2026-06-23', seq: 3, item: '3.2 Bb Accept the Final FY 2026-2027 Budget (Evan Smith)', motion: 'to-approve the Fiscal Year 2026-2027 Budget with an amendment for the road project', mover: 'Jacob Holdaway', seconder: 'Jacob Wood', result: 'carried', tally: '3-1', page: 3 }, [['David Lauret', 'yes'], ['Jacob Holdaway', 'yes'], ['Jacob Wood', 'yes'], ['Nair', 'no']]);
    const r = await ask(env as unknown as Env, { question: 'Did anyone vote no at the June 23, 2026 City Council meeting?' });
    expect(r.engine).toBe('votes-meeting');
    expect(r.answer).toContain('2026-2027 Budget');
    expect(r.answer).toContain('Voting No: Council Member Nair.');
  });
});

describe('suite requests count apart from residents', () => {
  it('uses the tests columns for the chat suite', () => {
    expect(quotaField({}, 'ai_requests')).toBe('ai_requests');
    expect(quotaField({ AI_SPENDER: 'public' }, 'ai_failures')).toBe('ai_failures');
    expect(quotaField({ AI_SPENDER: 'tests' }, 'ai_requests')).toBe('ai_requests_tests');
    expect(quotaField({ AI_SPENDER: 'tests' }, 'ai_failures')).toBe('ai_failures_tests');
  });
});
