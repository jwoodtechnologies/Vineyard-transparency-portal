import { beforeEach, describe, expect, it } from 'vitest';
import { staffHarness } from './helpers/staff';

type H = Awaited<ReturnType<typeof staffHarness>>;

describe('staff tour state on the account', () => {
  let h: H;
  let owner: { cookie: string };
  beforeEach(async () => {
    h = await staffHarness();
    owner = await h.makeOwner();
  });

  it('is unset for a person who just joined from an invite, and saved once finished', async () => {
    const pat = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', department: 'Recorder', role: 'editor', areas: ['records'] });
    let s = (await h.call('GET', '/state', undefined, { cookie: pat.cookie })).body as { user: { tour: string | null; areas: string[] } };
    expect(s.user.tour).toBeNull();
    expect(s.user.areas).toEqual(['records']);
    const r = await h.call('POST', '/me/tour', { state: 'done' }, { cookie: pat.cookie });
    expect(r.status).toBe(200);
    s = (await h.call('GET', '/state', undefined, { cookie: pat.cookie })).body as { user: { tour: string | null; areas: string[] } };
    expect(s.user.tour).toBe('done');
    // Another person's state is their own.
    const lee = await h.addPerson(owner.cookie, { name: 'Lee Planner', email: 'lee@vineyard.example', department: 'Planning', role: 'editor', areas: ['map'] });
    const t = (await h.call('GET', '/state', undefined, { cookie: lee.cookie })).body as { user: { tour: string | null } };
    expect(t.user.tour).toBeNull();
  });

  it('records a skip, refuses anything else, and needs a signed-in person', async () => {
    const pat = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', department: 'Recorder', role: 'editor', areas: ['records'] });
    expect((await h.call('POST', '/me/tour', { state: 'skipped' }, { cookie: pat.cookie })).status).toBe(200);
    expect((await h.call('POST', '/me/tour', { state: 'whatever' }, { cookie: pat.cookie })).status).toBe(400);
    expect((await h.call('POST', '/me/tour', { state: 'done' })).status).toBe(401);
    const row = h.env.CATALOG_DB.db.prepare('SELECT tour FROM staff_users WHERE email = ?').get('pat@vineyard.example') as { tour: string };
    expect(row.tour).toBe('skipped');
  });
});

describe('staff tour for accounts made before it', () => {
  it('marks accounts already in use, so the tour starts by itself only for people who join after', async () => {
    const { vi } = await import('vitest');
    const { testEnv } = await import('./helpers/d1');
    vi.resetModules();
    const env = testEnv();
    // The table as it was before the tour column.
    env.CATALOG_DB.db.exec(`CREATE TABLE staff_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, department TEXT, role TEXT NOT NULL,
      areas TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 0, pass_hash TEXT, salt TEXT, iterations INTEGER,
      created_at TEXT NOT NULL, created_by TEXT, last_login_at TEXT)`);
    env.CATALOG_DB.db.prepare("INSERT INTO staff_users (id, email, name, role, areas, active, created_at) VALUES ('u1', 'jacob@example.org', 'Jacob', 'owner', '[]', 1, 't')").run();
    env.CATALOG_DB.db.prepare("INSERT INTO staff_users (id, email, name, role, areas, active, created_at) VALUES ('u2', 'new@example.org', 'Invited', 'editor', '[\"records\"]', 0, 't')").run();
    const { ensureStaffTables } = await import('../worker/staff/schema');
    await ensureStaffTables(env as never);
    const rows = env.CATALOG_DB.db.prepare('SELECT id, tour FROM staff_users ORDER BY id').all() as Array<{ id: string; tour: string | null }>;
    expect(rows).toEqual([
      { id: 'u1', tour: 'before' },
      { id: 'u2', tour: null },
    ]);
  });
});
