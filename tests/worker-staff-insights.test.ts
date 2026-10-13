import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';
import { ensureActivityTables } from '../worker/panel/store';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;
let owner: { cookie: string };
let admin: { cookie: string };
let editor: { cookie: string };

beforeEach(async () => {
  h = await staffHarness();
  owner = await h.makeOwner();
  admin = await h.addPerson(owner.cookie, { name: 'Ada Admin', email: 'ada@vineyard.example', role: 'admin' });
  // An editor with every area still is not an administrator.
  editor = await h.addPerson(
    owner.cookie,
    { name: 'Eve Editor', email: 'eve@vineyard.example', role: 'editor', areas: ['records', 'votes', 'people', 'map', 'budget', 'notices', 'site', 'submissions'] },
    'a different long password',
  );
});

const READS = ['/insights/summary', '/coverage/report', '/health/report'];

describe('who may see Insights, Coverage and Health', () => {
  it('refuses editors in a plain sentence, and anyone not signed in', async () => {
    for (const path of READS) {
      const r = await h.call('GET', path, undefined, { cookie: editor.cookie });
      expect(r.status, path).toBe(403);
      expect(r.body.error.message).toBe('Only owners and administrators can see this.');
      expect((await h.call('GET', path)).status, path).toBe(401);
    }
    expect((await h.call('POST', '/coverage/refresh', {}, { cookie: editor.cookie })).status).toBe(403);
  });

  it('lets owners and administrators in', async () => {
    for (const who of [owner, admin]) {
      for (const path of READS) expect((await h.call('GET', path, undefined, { cookie: who.cookie })).status, path).toBe(200);
    }
    const refresh = await h.call('POST', '/coverage/refresh', {}, { cookie: admin.cookie });
    expect(refresh.status).toBe(200);
    expect(refresh.body.counts).toBeTruthy();
  });
});

describe('what they show', () => {
  it('counts visits, questions and ratings with the panel numbers, and leaves out addresses', async () => {
    await ensureActivityTables(h.env as never);
    const now = new Date().toISOString();
    const db = h.env.CATALOG_DB.db;
    db.prepare("INSERT INTO activity_visits (at, ip, path, is_bot) VALUES (?, '203.0.113.5', '/', 0), (?, '203.0.113.6', '/votes', 0), (?, '203.0.113.6', '/', 1)").run(now, now, now);
    db.prepare("INSERT INTO activity_questions (ask_id, at, ip, question, status) VALUES ('ask_0000000000000001', ?, '203.0.113.5', 'When is trash pickup?', 'ok')").run(now);
    db.prepare("INSERT INTO activity_feedback (ask_id, at, ip, vote, question) VALUES ('ask_0000000000000001', ?, '203.0.113.5', 'down', 'When is trash pickup?')").run(now);

    const r = await h.call('GET', '/insights/summary', undefined, { cookie: admin.cookie });
    expect(r.body.day).toMatchObject({ visits: 2, people: 2, questions: 1, up: 0, down: 1 });
    expect(r.body.questions[0]).toMatchObject({ question: 'When is trash pickup?', down: 1, up: 0 });
    expect(r.body.ratings[0]).toMatchObject({ vote: 'down', question: 'When is trash pickup?' });
    expect(JSON.stringify(r.body)).not.toContain('203.0.113');
  });

  it('reports job health with the fallbacks and AI use', async () => {
    const r = await h.call('GET', '/health/report', undefined, { cookie: owner.cookie });
    expect(Array.isArray(r.body.jobs)).toBe(true);
    expect(Array.isArray(r.body.sources)).toBe(true);
    expect(r.body.threshold).toBeGreaterThan(0);
    expect(r.body).toHaveProperty('aiFallbacks');
    expect(r.body).toHaveProperty('ai');
  });
});
