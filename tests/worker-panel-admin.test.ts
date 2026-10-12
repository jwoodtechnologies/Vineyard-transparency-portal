import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { accept, addOwnerPasskey, cookieOf, invite, panel, register, setupOwner, signIn, type Device, type TestEnv } from './helpers/panel';
import { ensureContribTables } from '../worker/contrib/schema';

// Admin accounts: invited by the owner, sign in with their own name and password (or a passkey).

const OWNER = { email: 'owner@example.org', password: 'correct horse battery' };
const ADMIN_PASSWORD = 'vineyard city hall 2026';

async function adminInvite(env: TestEnv, owner: string, name?: string): Promise<string> {
  const r = await panel(env, 'POST', '/api/invites/create', { body: { role: 'admin', name }, cookie: owner });
  expect(r.status).toBe(200);
  const j = (await r.json()) as { path: string; role: string };
  expect(j.role).toBe('admin');
  return j.path.split('/invite/')[1];
}

const join = (env: TestEnv, token: string, login: string, password = ADMIN_PASSWORD, ip = '10.0.5.1') => panel(env, 'POST', '/api/invite/accept', { body: { token, login, password }, ip });

async function adminSession(env: TestEnv, owner: string, login = 'cityadmin'): Promise<string> {
  const r = await join(env, await adminInvite(env, owner), login);
  expect(r.status, await r.clone().text()).toBe(200);
  return cookieOf(r);
}

const login = (env: TestEnv, email: string, password: string, ip = '10.0.6.1') => panel(env, 'POST', '/api/login', { body: { email, password }, ip });
const state = async (env: TestEnv, cookie: string) => (await (await panel(env, 'GET', '/api/state', { cookie })).json()) as { signedIn: boolean; account: { name: string; role: string } | null; login: string | null; email: string | null };

async function addPasskey(env: TestEnv, cookie: string): Promise<Device> {
  const o = (await (await panel(env, 'POST', '/api/passkey/register/options', { body: {}, cookie })).json()) as { challenge: string; email: string };
  expect(o.email).toBe('cityadmin');
  const { device, body } = await register(o.challenge);
  expect((await panel(env, 'POST', '/api/passkey/register', { body, cookie })).status).toBe(200);
  return device;
}

describe('admin accounts', () => {
  it('the owner makes a one-time admin link, valid 7 days, named Vineyard Admin', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const token = await adminInvite(env, owner);
    const row = env.CATALOG_DB.db.prepare('SELECT role, name, created_at, expires_at FROM panel_invites').get() as Record<string, string>;
    expect(row.role).toBe('admin');
    expect(row.name).toBe('Vineyard Admin');
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(7 * 24 * 3600_000);
    const check = (await (await panel(env, 'POST', '/api/invite/check', { body: { token } })).json()) as { role: string; name: string };
    expect(check).toMatchObject({ role: 'admin', name: 'Vineyard Admin' });
    // Uploader invites are unchanged: 72 hours, passkey only.
    await invite(env, owner);
    const up = env.CATALOG_DB.db.prepare("SELECT created_at, expires_at FROM panel_invites WHERE role = 'uploader'").get() as Record<string, string>;
    expect(Date.parse(up.expires_at) - Date.parse(up.created_at)).toBe(72 * 3600_000);
  });

  it('joining sets a sign-in name and a 12+ character password; the link works once', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const token = await adminInvite(env, owner);
    expect((await join(env, token, 'cityadmin', 'short pass1')).status).toBe(400);
    expect((await join(env, token, OWNER.email)).status).toBe(400); // the owner's email is not available
    expect((await join(env, token, 'a b')).status).toBe(400);
    // The admin link cannot be used to make a passkey-only uploader.
    expect((await accept(env, token, 'Mallory', '10.0.5.9')).res.status).toBe(410);
    const ok = await join(env, token, 'CityAdmin');
    expect(ok.status).toBe(200);
    const s = await state(env, cookieOf(ok));
    expect(s).toMatchObject({ signedIn: true, account: { name: 'Vineyard Admin', role: 'admin' }, login: 'cityadmin', email: null });
    expect((await join(env, token, 'another')).status).toBe(410);
    // Only a salted hash is stored.
    const stored = env.CATALOG_DB.db.prepare('SELECT * FROM panel_logins').get() as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain(ADMIN_PASSWORD);
    expect(stored.iterations).toBe(100_000);
    // A second admin cannot take the same name.
    expect((await join(env, await adminInvite(env, owner), 'cityadmin', ADMIN_PASSWORD, '10.0.5.2')).status).toBe(400);
  });

  it('admins sign in with name and password; the owner signs in with email and password as before', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    await adminSession(env, owner, 'admin@vineyard.example');
    const a = await login(env, 'Admin@Vineyard.example', ADMIN_PASSWORD);
    expect(a.status).toBe(200);
    expect((await state(env, cookieOf(a))).account).toMatchObject({ role: 'admin' });
    expect((await login(env, 'admin@vineyard.example', 'wrong password here', '10.0.6.2')).status).toBe(401);
    // The admin's password never signs in as the owner, and the owner's path is unchanged.
    expect((await login(env, OWNER.email, ADMIN_PASSWORD, '10.0.6.3')).status).toBe(401);
    const o = await login(env, OWNER.email, OWNER.password, '10.0.6.4');
    expect(o.status).toBe(200);
    expect((await state(env, cookieOf(o))).account).toMatchObject({ id: 1, role: 'owner' });
    // The owner password still works after the owner adds a passkey.
    await addOwnerPasskey(env, cookieOf(o));
    expect((await login(env, OWNER.email, OWNER.password, '10.0.6.4')).status).toBe(200);
  });

  it('wrong admin passwords count toward the same lockout', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    await adminSession(env, owner);
    for (let i = 0; i < 5; i++) expect((await login(env, 'cityadmin', 'not the password', '10.0.7.1')).status).toBe(401);
    expect((await login(env, 'cityadmin', ADMIN_PASSWORD, '10.0.7.1')).status).toBe(429);
    expect((await login(env, 'cityadmin', ADMIN_PASSWORD, '10.0.7.2')).status).toBe(200);
  });

  it('admins may add a passkey, sign in with it, and remove it (the password remains)', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const admin = await adminSession(env, owner);
    const device = await addPasskey(env, admin);
    const pk = await signIn(env, device, '10.0.8.1');
    expect(pk.status).toBe(200);
    expect((await state(env, cookieOf(pk))).account).toMatchObject({ role: 'admin' });
    expect((await panel(env, 'POST', '/api/passkey/delete', { body: { id: device.id }, cookie: admin })).status).toBe(200);
    expect((await login(env, 'cityadmin', ADMIN_PASSWORD)).status).toBe(200);
  });

  it('changing the admin password ends its other sessions', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const first = await adminSession(env, owner);
    const second = cookieOf(await login(env, 'cityadmin', ADMIN_PASSWORD));
    expect((await panel(env, 'POST', '/api/password', { body: { current: ADMIN_PASSWORD, next: 'too short' }, cookie: first })).status).toBe(400);
    expect((await panel(env, 'POST', '/api/password', { body: { current: 'wrong', next: 'a brand new passphrase' }, cookie: first })).status).toBe(403);
    const r = await panel(env, 'POST', '/api/password', { body: { current: ADMIN_PASSWORD, next: 'a brand new passphrase' }, cookie: first });
    expect(r.status).toBe(200);
    expect((await state(env, second)).signedIn).toBe(false);
    expect((await state(env, cookieOf(r))).signedIn).toBe(true);
    expect((await login(env, 'cityadmin', 'a brand new passphrase')).status).toBe(200);
    // The owner is not signed out, and the owner's password is untouched.
    expect((await state(env, owner)).signedIn).toBe(true);
    expect((await login(env, OWNER.email, OWNER.password, '10.0.9.9')).status).toBe(200);
  });

  it('admins reach Activity, Submissions review, Coverage and Health, never people or invites', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const admin = await adminSession(env, owner);
    for (const route of ['/api/summary', '/api/visits', '/api/questions', '/api/feedback', '/api/submissions', '/api/submissions/log', '/api/uploads']) {
      expect((await panel(env, 'GET', route, { cookie: admin })).status, route).toBe(200);
    }
    for (const route of ['/api/accounts', '/api/invites', '/api/audit']) {
      expect((await panel(env, 'GET', route, { cookie: admin })).status, route).toBe(403);
    }
    expect((await panel(env, 'POST', '/api/invites/create', { body: { role: 'admin' }, cookie: admin })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/accounts/disable', { body: { id: 1 }, cookie: admin })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/submissions/switch', { body: { open: false }, cookie: admin })).status).toBe(403);
    // Approve and reject are open to admins (an unknown id is a 404, not a 403).
    expect((await panel(env, 'POST', '/api/submissions/approve', { body: { id: 'sub_none' }, cookie: admin })).status).toBe(404);
    expect((await panel(env, 'POST', '/api/submissions/reject', { body: { id: 'sub_none' }, cookie: admin })).status).toBe(404);
  });

  it('a turned-off admin is signed out at once and cannot sign in', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const admin = await adminSession(env, owner);
    const id = (env.CATALOG_DB.db.prepare("SELECT id FROM panel_accounts WHERE role = 'admin'").get() as { id: number }).id;
    expect((await panel(env, 'POST', '/api/accounts/disable', { body: { id }, cookie: owner })).status).toBe(200);
    expect((await panel(env, 'GET', '/api/uploads', { cookie: admin })).status).toBe(401);
    expect((await login(env, 'cityadmin', ADMIN_PASSWORD)).status).toBe(401);
    expect((await panel(env, 'POST', '/api/accounts/enable', { body: { id }, cookie: owner })).status).toBe(200);
    expect((await login(env, 'cityadmin', ADMIN_PASSWORD, '10.0.6.9')).status).toBe(200);
    const people = (await (await panel(env, 'GET', '/api/accounts', { cookie: owner })).json()) as { items: Array<{ role: string; login: string | null; name: string }> };
    expect(people.items.map((a) => [a.role, a.name, a.login])).toEqual([
      ['owner', 'Owner', null],
      ['admin', 'Vineyard Admin', 'cityadmin'],
    ]);
  });

  it('a session cannot claim another role than its account has', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const admin = await adminSession(env, owner);
    env.CATALOG_DB.db.prepare("UPDATE panel_accounts SET role = 'uploader' WHERE role = 'admin'").run();
    expect((await state(env, admin)).signedIn).toBe(false);
  });

  it('accounts tables from before admins existed are widened once, keeping every row', async () => {
    const env = testEnv();
    env.CATALOG_DB.db.exec(`CREATE TABLE panel_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'uploader')),
      created_at TEXT NOT NULL, disabled_at TEXT)`);
    env.CATALOG_DB.db.prepare("INSERT INTO panel_accounts (id, name, role, created_at) VALUES (1, 'Owner', 'owner', '2026-01-01'), (2, 'Sam', 'uploader', '2026-02-01')").run();
    await ensureContribTables(env);
    expect(env.CATALOG_DB.db.prepare('SELECT id, name, role FROM panel_accounts ORDER BY id').all()).toEqual([
      { id: 1, name: 'Owner', role: 'owner' },
      { id: 2, name: 'Sam', role: 'uploader' },
    ]);
    env.CATALOG_DB.db.prepare("INSERT INTO panel_accounts (name, role, created_at) VALUES ('Vineyard Admin', 'admin', '2026-10-12')").run();
    expect((env.CATALOG_DB.db.prepare("SELECT id FROM panel_accounts WHERE role = 'admin'").get() as { id: number }).id).toBe(3);
  });
});
