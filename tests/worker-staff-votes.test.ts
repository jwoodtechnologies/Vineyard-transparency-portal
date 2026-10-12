import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileForm } from './helpers/panel';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let api: typeof import('../worker/api/votes');
let owner: { cookie: string };
let clerk: { cookie: string };

const AUG = `NOTICE OF A REGULAR
CITY COUNCIL MEETING
August 11, 2026, at 4:00 PM
Present
Mayor Zack Stratton
Councilmember Jacob Holdaway
Councilmember David Lauret
Councilmember Parker McCumber
Councilmember Ezra Nair
Absent
Councilmember Jacob Wood
Staff Present: City Manager Brian Voeks
5. CONSENT ITEMS
MOTION: Council Member Lauret motioned to approve the Consent Items 5.1, 5.2, and 5.3 as presented. Council Member Nair seconded the motion. Vote Yes: Council Members Holdaway, Lauret, McCumber, and Nair No: None. Motion carried 4-0.
5.4. Approve Ordinance 2026-07 Amending Municipal Code for the Planning
Motion: Council Member Nair moved approve item 5.4 as presented. (Ordinance 2026-07)
Council Member McCumber seconded the motion. Roll Call Vote. Yes: Council Members
McCumber and Nair. No: Council Members Holdaway and Lauret. Tie Vote resolved by Mayor
Stratton's vote of Yes. Motion Passed 3-2.
MOTION: Council Member McCumber motioned to approve the settlement of the pending litigation as discussed. Council Member Lauret seconded the motion. Roll Call Vote Yes: Nair, McCumber, and Lauret. No: None. Recused: Holdaway. Motion carried 3-0.`;

const SEPT = `NOTICE OF A REGULAR
CITY COUNCIL MEETING
September 1, 2026, at 4:00 PM
Present
Mayor Zack Stratton
Councilmember Jacob Holdaway
Councilmember David Lauret
Councilmember Parker McCumber
Councilmember Jacob Wood
Staff Present: City Manager Brian Voeks
6.1. Approve Resolution 2026-40 Park Rules
MOTION: Council Member Wood motioned to approve Resolution 2026-40 as presented. Council Member Lauret seconded the motion. Vote Yes: Council Members Holdaway, Lauret, McCumber, and Wood. No: None. Motion carried 4-0.`;

const enc = new TextEncoder();
const db = () => h.env.CATALOG_DB.db;
const count = (sql: string, ...p: unknown[]) => Number((db().prepare(sql).get(...p) as { n: number }).n);

beforeEach(async () => {
  h = await staffHarness();
  // Loaded after the harness reset the modules, so it is the same copy the staff routes use (its table checks are per copy).
  api = await import('../worker/api/votes');
  owner = await h.makeOwner();
  clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['votes', 'records'] });
  db()
    .prepare("INSERT INTO government_bodies (id, slug, name, kind) VALUES ('city-council', 'city-council', 'Vineyard City Council', 'council'), ('planning-commission', 'planning-commission', 'Vineyard Planning Commission', 'commission')")
    .run();
});

async function minutes(text: string, title: string, date: string) {
  const r = await h.call('POST', '/records/file', undefined, { cookie: clerk.cookie, form: fileForm(enc.encode(text), `${title}.txt`, { type: 'minutes', title, date }) });
  expect(r.status).toBe(201);
  return r.body.documentId as string;
}

/** The minutes reader, as the cron runs it. */
const read = () => api.processVotes(h.env as never, 20_000, 50);
/** What a parser bump does: every set of minutes is read again. */
const readAgain = () => {
  db().prepare('DELETE FROM vote_docs').run();
  return read();
};

async function seedAugust() {
  const docId = await minutes(AUG, 'City Council Minutes August 11 2026', '2026-08-11');
  const r = await read();
  expect(r.motions).toBe(3);
  return docId;
}

const motions = async (date = '2026-08-11', body = 'city-council') => (await h.call('GET', `/votes/motions?date=${date}&body=${body}`, undefined, { cookie: clerk.cookie })).body;
const litigation = async () => (await motions()).motions.find((m: { motion: string }) => /settlement/.test(m.motion));

describe('who may use the votes area', () => {
  it('keeps people without the area out', async () => {
    const other = await h.addPerson(owner.cookie, { name: 'Bo Budget', email: 'bo@vineyard.example', role: 'editor', areas: ['budget'] }, 'a different long password');
    expect((await h.call('GET', '/votes/meetings', undefined, { cookie: other.cookie })).status).toBe(403);
    expect((await h.call('POST', '/votes/remove', { id: 'x' }, { cookie: other.cookie })).status).toBe(403);
    expect((await h.call('GET', '/votes/meetings')).status).toBe(401);
  });
});

describe('seeing the votes', () => {
  it('lists meetings, then the motions of one with the people who can be picked', async () => {
    await seedAugust();
    const list = await h.call('GET', '/votes/meetings', undefined, { cookie: clerk.cookie });
    expect(list.body.meetings).toEqual([{ date: '2026-08-11', body: 'city-council', motions: 3, edited: 0 }]);
    expect(list.body.bodies.map((b: { name: string }) => b.name)).toContain('City Council');
    const m = await motions();
    expect(m.motions).toHaveLength(3);
    expect(m.bodyName).toBe('City Council');
    expect(m.roster).toEqual(expect.arrayContaining(['Jacob Holdaway', 'David Lauret', 'Parker McCumber', 'Ezra Nair']));
    // A last name alone is not offered when the full name is.
    expect(m.roster).not.toContain('Holdaway');
  });

  it('finds a motion by a word in it', async () => {
    await seedAugust();
    const r = await h.call('GET', '/votes/meetings?q=settlement', undefined, { cookie: clerk.cookie });
    expect(r.body.matches).toHaveLength(1);
    expect(r.body.matches[0]).toMatchObject({ date: '2026-08-11', body: 'city-council' });
  });
});

describe('correcting a vote', () => {
  const fix = (m: Record<string, unknown>, over: Record<string, unknown>) => ({
    id: m.id,
    item: m.item,
    motion: m.motion,
    mover: m.mover,
    seconder: m.seconder,
    result: m.result,
    votes: m.votes,
    ...over,
  });

  it('changes the vote, works out the tally and keeps it through a re-read of the minutes', async () => {
    await seedAugust();
    const m = await litigation();
    const votes = m.votes.map((v: { member: string; vote: string }) => (/Holdaway/.test(v.member) ? { ...v, vote: 'no' } : v));
    const r = await h.call('POST', '/votes/save', fix(m, { votes, motion: 'approve the settlement of the pending litigation, as amended' }), { cookie: clerk.cookie });
    expect(r.status).toBe(200);
    const after = await litigation();
    expect(after).toMatchObject({ manual: true, tally: '3-1', motion: 'approve the settlement of the pending litigation, as amended' });
    expect(after.votes.find((v: { member: string }) => /Holdaway/.test(v.member))).toMatchObject({ vote: 'no' });

    await readAgain();
    const again = await motions();
    expect(again.motions).toHaveLength(3);
    expect((await litigation()).votes.find((v: { member: string }) => /Holdaway/.test(v.member))).toMatchObject({ vote: 'no' });
    expect(count("SELECT count(*) AS n FROM motions WHERE motion LIKE '%settlement%'")).toBe(1);
    expect((await h.call('GET', '/votes/meetings', undefined, { cookie: clerk.cookie })).body.meetings[0].edited).toBe(1);
  });

  it('shows the correction on the public votes list', async () => {
    await seedAugust();
    await (await import('../worker/api/people')).ensurePeopleTable(h.env as never);
    for (const [slug, name] of [['jacob-holdaway', 'Jacob Holdaway'], ['david-lauret', 'David Lauret'], ['parker-mccumber', 'Parker McCumber'], ['ezra-nair', 'Ezra Nair']]) {
      db().prepare("INSERT OR IGNORE INTO people (slug, name, kind, role, source_url, current, first_seen, last_seen) VALUES (?, ?, 'elected', 'Council Member', 'x', 1, 't', 't')").run(slug, name);
    }
    const m = await litigation();
    await h.call('POST', '/votes/save', fix(m, { result: 'failed', votes: [{ member: 'Jacob Holdaway', vote: 'no' }, { member: 'David Lauret', vote: 'no' }, { member: 'Parker McCumber', vote: 'yes' }] }), { cookie: clerk.cookie });
    const pub = await api.queryMotions(h.env as never, { body: 'city-council', year: 2026, pageSize: 50 });
    const row = pub.items.find((x) => /settlement/.test(x.motion))!;
    expect(row).toMatchObject({ result: 'failed', tally: '1-2' });
    expect(row.votes.map((v) => `${v.member}:${v.vote}`)).toEqual(['Parker McCumber:yes', 'David Lauret:no', 'Jacob Holdaway:no']);
  });

  it('refuses a result the votes contradict', async () => {
    await seedAugust();
    const m = await litigation();
    const lost = [{ member: 'Jacob Holdaway', vote: 'no' }, { member: 'David Lauret', vote: 'no' }, { member: 'Parker McCumber', vote: 'yes' }];
    expect((await h.call('POST', '/votes/save', fix(m, { result: 'carried', votes: lost }), { cookie: clerk.cookie })).status).toBe(400);
    const won = [{ member: 'Jacob Holdaway', vote: 'yes' }, { member: 'David Lauret', vote: 'yes' }, { member: 'Parker McCumber', vote: 'no' }];
    expect((await h.call('POST', '/votes/save', fix(m, { result: 'failed', votes: won }), { cookie: clerk.cookie })).status).toBe(400);
    expect((await h.call('POST', '/votes/save', fix(m, { motion: '   ' }), { cookie: clerk.cookie })).status).toBe(400);
    expect((await h.call('POST', '/votes/save', fix(m, { result: 'maybe' }), { cookie: clerk.cookie })).status).toBe(400);
    expect((await h.call('POST', '/votes/save', fix(m, { votes: [{ member: 'Jacob Holdaway', vote: 'sort of' }] }), { cookie: clerk.cookie })).status).toBe(400);
    expect((await litigation()).manual).toBe(false);
  });

  it('puts the earlier version back with one tap', async () => {
    await seedAugust();
    const m = await litigation();
    await h.call('POST', '/votes/save', fix(m, { motion: 'something else entirely' }), { cookie: clerk.cookie });
    const log = await h.call('GET', '/audit', undefined, { cookie: clerk.cookie });
    const entry = log.body.items.find((i: { action: string; area: string }) => i.area === 'votes' && i.action === 'edited');
    expect(entry.undoable).toBe(true);
    expect((await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: clerk.cookie })).status).toBe(200);
    const back = await litigation();
    expect(back).toMatchObject({ motion: m.motion, manual: false });
    expect(back.votes).toEqual(m.votes);
  });
});

describe('removing a vote', () => {
  it('stays removed when the minutes are read again, and comes back on undo', async () => {
    await seedAugust();
    const m = await litigation();
    expect((await h.call('POST', '/votes/remove', { id: m.id }, { cookie: clerk.cookie })).status).toBe(200);
    expect((await motions()).motions).toHaveLength(2);
    expect(count('SELECT count(*) AS n FROM motion_votes WHERE motion_id = ?', m.id)).toBe(0);

    await readAgain();
    expect((await motions()).motions).toHaveLength(2);

    const log = await h.call('GET', '/audit', undefined, { cookie: clerk.cookie });
    const entry = log.body.items.find((i: { action: string }) => i.action === 'removed');
    expect(entry.undoable).toBe(true);
    expect((await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: clerk.cookie })).status).toBe(200);
    expect((await motions()).motions).toHaveLength(3);
    expect(count('SELECT count(*) AS n FROM vote_tombstones')).toBe(0);
    await readAgain();
    expect((await motions()).motions).toHaveLength(3);
  });
});

describe('adding a vote', () => {
  const vote = (over: Record<string, unknown> = {}) => ({
    date: '2026-09-01',
    body: 'city-council',
    item: '6.1 Approve Resolution 2026-40 Park Rules',
    motion: 'approve Resolution 2026-40 as presented',
    mover: 'Jacob Wood',
    seconder: 'David Lauret',
    result: 'carried',
    votes: [
      { member: 'Jacob Wood', vote: 'yes' },
      { member: 'David Lauret', vote: 'yes' },
      { member: 'Parker McCumber', vote: 'yes' },
      { member: 'Jacob Holdaway', vote: 'no' },
    ],
    ...over,
  });

  it('shows a vote entered before the minutes exist, then yields to the minutes', async () => {
    const r = await h.call('POST', '/votes/add', vote(), { cookie: clerk.cookie });
    expect(r.status).toBe(201);
    expect(count("SELECT count(*) AS n FROM motions WHERE manual = 1 AND document_id = '' AND tally = '3-1'")).toBe(1);
    const list = await h.call('GET', '/votes/meetings', undefined, { cookie: clerk.cookie });
    expect(list.body.meetings[0]).toMatchObject({ date: '2026-09-01', motions: 1, edited: 1 });

    await minutes(SEPT, 'City Council Minutes September 1 2026', '2026-09-01');
    await read();
    const m = await motions('2026-09-01');
    expect(m.motions).toHaveLength(1);
    expect(m.motions[0].manual).toBe(false);
    expect(m.motions[0].documentId).not.toBe('');
  });

  it('keeps a vote added to a meeting whose minutes are read', async () => {
    const docId = await seedAugust();
    const r = await h.call('POST', '/votes/add', vote({ date: '2026-08-11', item: '7.1 Approve a Fee Waiver', motion: 'approve the fee waiver for the park rental', result: 'carried' }), { cookie: clerk.cookie });
    expect(r.status).toBe(201);
    expect(count('SELECT count(*) AS n FROM motions WHERE id = ? AND document_id = ?', r.body.id, docId)).toBe(1);
    await readAgain();
    expect((await motions()).motions).toHaveLength(4);
  });

  it('refuses a vote without a date, a body that does not exist or a result', async () => {
    expect((await h.call('POST', '/votes/add', vote({ date: '' }), { cookie: clerk.cookie })).status).toBe(400);
    expect((await h.call('POST', '/votes/add', vote({ body: 'nowhere' }), { cookie: clerk.cookie })).status).toBe(400);
    expect((await h.call('POST', '/votes/add', vote({ result: '' }), { cookie: clerk.cookie })).status).toBe(400);
    expect(count('SELECT count(*) AS n FROM motions')).toBe(0);
  });

  it('can be undone', async () => {
    const r = await h.call('POST', '/votes/add', vote(), { cookie: clerk.cookie });
    const log = await h.call('GET', '/audit', undefined, { cookie: clerk.cookie });
    const entry = log.body.items.find((i: { action: string; area: string }) => i.area === 'votes' && i.action === 'added');
    expect((await h.call('POST', '/audit/undo', { id: entry.id }, { cookie: clerk.cookie })).status).toBe(200);
    expect(count('SELECT count(*) AS n FROM motions WHERE id = ?', r.body.id)).toBe(0);
    expect(count('SELECT count(*) AS n FROM motion_votes')).toBe(0);
  });
});
