import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

// Password hashing is deliberately slow; give a busy machine room.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
let h: H;

beforeEach(async () => {
  h = await staffHarness();
});

const CODE = /^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/;

/** An editor who finished setup; returns what their sheet of codes said. */
async function person(owner: { cookie: string }, email = 'ed@vineyard.example') {
  const made = await h.call('POST', '/users', { name: 'Ed Editor', email, role: 'editor', areas: ['notices'] }, { cookie: owner.cookie });
  const token = (made.body.invite.path as string).split('#')[1];
  const joined = await h.call('POST', '/invite/accept', { token, password: 'a good long password' });
  expect(joined.status).toBe(200);
  return { id: made.body.id as string, email, cookie: joined.cookie!, codes: joined.body.recoveryCodes as string[], password: 'a good long password' };
}

async function recover(email: string, code: string, ip = '10.0.0.1') {
  return h.call('POST', '/recover', { email, code, pow: await h.pow(ip) }, { ip });
}

describe('recovery codes', () => {
  it('gives each new account eight single-use codes, shown once', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    expect(ed.codes).toHaveLength(8);
    for (const c of ed.codes) expect(c).toMatch(CODE);
    expect(new Set(ed.codes).size).toBe(8);
    const creds = await h.call('GET', '/me/credentials', undefined, { cookie: ed.cookie });
    expect(creds.body.recoveryLeft).toBe(8);
    const stored = await h.env.CATALOG_DB.prepare('SELECT code_hash FROM staff_recovery').all<{ code_hash: string }>();
    for (const row of stored.results ?? []) for (const c of ed.codes) expect(row.code_hash).not.toContain(c.replace(/-/g, ''));
  });

  it('lets a person who lost everything set up a new sign-in with a code', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    const r = await recover(ed.email.toUpperCase(), ed.codes[0].toLowerCase().replace(/-/g, ' '));
    expect(r.status).toBe(200);
    const look = await h.call('POST', '/invite/lookup', { token: r.body.token });
    expect(look.body).toMatchObject({ kind: 'recovery', email: ed.email });
    const joined = await h.call('POST', '/invite/accept', { token: r.body.token, password: 'a brand new password' });
    expect(joined.status).toBe(200);
    expect((await h.call('POST', '/login', { email: ed.email, password: ed.password, pow: await h.pow() })).status).toBe(401);
    expect((await h.call('POST', '/login', { email: ed.email, password: 'a brand new password', pow: await h.pow() })).status).toBe(200);
    // The old sheet is gone, a fresh one was issued, and the used code cannot be used again.
    expect(joined.body.recoveryCodes).toHaveLength(8);
    expect((await recover(ed.email, ed.codes[0])).status).toBe(401);
    expect((await recover(ed.email, ed.codes[1])).status).toBe(401);
    expect((await recover(ed.email, joined.body.recoveryCodes[0])).status).toBe(200);
    // Old sessions ended.
    expect((await h.call('GET', '/state', undefined, { cookie: ed.cookie })).body.user).toBeNull();
    // The audit log says it happened.
    const log = await h.call('GET', '/audit', undefined, { cookie: owner.cookie });
    expect(log.body.items.map((i: { summary: string }) => i.summary)).toContain('Ed Editor signed in with a recovery code');
  });

  it('answers the same way for an unknown email, a wrong code and a malformed code', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    const a = await recover('nobody@vineyard.example', ed.codes[0], '10.0.2.1');
    const b = await recover(ed.email, 'ABCD-EFGH-JKMN-PQRS', '10.0.2.2');
    const c = await recover(ed.email, 'nope', '10.0.2.3');
    for (const r of [a, b, c]) expect(r.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(b.body.error.message).toBe(c.body.error.message);
  });

  it('needs the bot check and ignores the honeypot', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    expect((await h.call('POST', '/recover', { email: ed.email, code: ed.codes[0] })).status).toBe(400);
    expect((await h.call('POST', '/recover', { email: ed.email, code: ed.codes[0], website: 'http://spam', pow: await h.pow() })).status).toBe(400);
    expect((await recover(ed.email, ed.codes[0])).status).toBe(200);
  });

  it('spends a code once even when many requests race for it', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    const pows = await Promise.all(Array.from({ length: 6 }, (_, i) => h.pow(`10.0.3.${i}`)));
    const results = await Promise.all(pows.map((p, i) => h.call('POST', '/recover', { email: ed.email, code: ed.codes[2], pow: p }, { ip: `10.0.3.${i}` })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
  });

  it('lets only one of many simultaneous link redemptions finish', async () => {
    const owner = await h.makeOwner();
    const made = await h.call('POST', '/users', { name: 'Ed', email: 'ed@vineyard.example', role: 'editor', areas: ['notices'] }, { cookie: owner.cookie });
    const token = (made.body.invite.path as string).split('#')[1];
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => h.call('POST', '/invite/accept', { token, password: `a good long password ${i}` }, { ip: `10.0.4.${i}` })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 404)).toHaveLength(5);
    const sessions = await h.env.CATALOG_DB.prepare('SELECT count(*) AS n FROM staff_sessions WHERE user_id = ?').bind(made.body.id).first<{ n: number }>();
    expect(sessions?.n).toBe(1);
    const codes = await h.env.CATALOG_DB.prepare('SELECT count(*) AS n FROM staff_recovery WHERE user_id = ?').bind(made.body.id).first<{ n: number }>();
    expect(codes?.n).toBe(8);
  });

  it('is not blocked by wrong passwords typed for the same email', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    for (let i = 0; i < 7; i++) await h.call('POST', '/login', { email: ed.email, password: `wrong password ${i}`, pow: await h.pow(`10.0.5.${i}`) }, { ip: `10.0.5.${i}` });
    expect((await h.call('POST', '/login', { email: ed.email, password: ed.password, pow: await h.pow('10.0.5.9') }, { ip: '10.0.5.9' })).status).toBe(429);
    expect((await recover(ed.email, ed.codes[3], '10.0.5.9')).status).toBe(200);
  });

  it('stops one address that keeps guessing codes', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    for (let i = 0; i < 8; i++) expect((await recover(ed.email, 'ABCD-EFGH-JKMN-PQRS', '10.0.6.1')).status).toBe(401);
    expect((await recover(ed.email, ed.codes[0], '10.0.6.1')).status).toBe(429);
    expect((await recover(ed.email, ed.codes[0], '10.0.6.2')).status).toBe(200);
  });
});

describe('turned-off accounts stay off', () => {
  it('has no codes or links that work after the account is turned off', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    const r = await recover(ed.email, ed.codes[0]);
    expect(r.status).toBe(200);
    expect((await h.call('POST', '/users/update', { id: ed.id, active: false }, { cookie: owner.cookie })).status).toBe(200);
    // The link made a moment ago is gone, and so is every code.
    expect((await h.call('POST', '/invite/lookup', { token: r.body.token })).status).toBe(404);
    expect((await h.call('POST', '/invite/accept', { token: r.body.token, password: 'a brand new password' })).status).toBe(404);
    expect((await recover(ed.email, ed.codes[1])).status).toBe(401);
    const left = await h.env.CATALOG_DB.prepare('SELECT count(*) AS n FROM staff_recovery WHERE user_id = ?').bind(ed.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
    const row = await h.env.CATALOG_DB.prepare('SELECT active FROM staff_users WHERE id = ?').bind(ed.id).first<{ active: number }>();
    expect(row?.active).toBe(0);
  });

  it('refuses to make a link for a turned-off account until it is turned on', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    await h.call('POST', '/users/update', { id: ed.id, active: false }, { cookie: owner.cookie });
    expect((await h.call('POST', '/users/reset', { id: ed.id }, { cookie: owner.cookie })).status).toBe(409);
    await h.call('POST', '/users/update', { id: ed.id, active: true }, { cookie: owner.cookie });
    expect((await h.call('POST', '/users/reset', { id: ed.id }, { cookie: owner.cookie })).status).toBe(200);
  });

  it('does not let a link made for a new account switch on one that was turned off', async () => {
    const owner = await h.makeOwner();
    const made = await h.call('POST', '/users', { name: 'Ed', email: 'ed@vineyard.example', role: 'editor', areas: ['notices'] }, { cookie: owner.cookie });
    const token = (made.body.invite.path as string).split('#')[1];
    // Turned off before the link was ever used.
    await h.call('POST', '/users/update', { id: made.body.id, active: false }, { cookie: owner.cookie });
    expect((await h.call('POST', '/invite/lookup', { token })).status).toBe(404);
  });
});

describe('making a new sheet of codes', () => {
  it('needs the current password and replaces the old sheet', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    expect((await h.call('POST', '/recovery/new', {}, { cookie: ed.cookie })).status).toBe(403);
    expect((await h.call('POST', '/recovery/new', { current: 'wrong password here' }, { cookie: ed.cookie })).status).toBe(403);
    const made = await h.call('POST', '/recovery/new', { current: ed.password }, { cookie: ed.cookie });
    expect(made.status).toBe(200);
    expect(made.body.codes).toHaveLength(8);
    expect((await recover(ed.email, ed.codes[0])).status).toBe(401);
    expect((await recover(ed.email, made.body.codes[0])).status).toBe(200);
  });

  it('is removed when an administrator resets the sign-in', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    expect((await h.call('POST', '/users/reset', { id: ed.id }, { cookie: owner.cookie })).status).toBe(200);
    expect((await recover(ed.email, ed.codes[0])).status).toBe(401);
  });

  it('asks a passkey-only account for a passkey, not for nothing', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    await h.env.CATALOG_DB.prepare('UPDATE staff_users SET pass_hash = NULL, salt = NULL, iterations = NULL WHERE id = ?').bind(ed.id).run();
    const r = await h.call('POST', '/recovery/new', {}, { cookie: ed.cookie });
    expect(r.status).toBe(400);
    const bad = await h.call('POST', '/recovery/new', { passkey: { id: 'x'.repeat(30), clientDataJSON: '', authenticatorData: '', signature: '' } }, { cookie: ed.cookie });
    expect(bad.status).toBe(403);
  });
});

describe('a passkey that does not verify', () => {
  it('leaves the link usable and the old passkeys in place', async () => {
    const owner = await h.makeOwner();
    const ed = await person(owner);
    await h.env.CATALOG_DB.prepare("INSERT INTO staff_passkeys (id, user_id, public_key, alg, sign_count, created_at) VALUES ('old-key-id-1234567890', ?, 'k', -7, 0, 't')").bind(ed.id).run();
    const reset = await h.call('POST', '/users/reset', { id: ed.id }, { cookie: owner.cookie });
    const token = (reset.body.invite.path as string).split('#')[1];
    // The reset removed the old key; put one back to prove a failed ceremony does not remove it.
    await h.env.CATALOG_DB.prepare("INSERT INTO staff_passkeys (id, user_id, public_key, alg, sign_count, created_at) VALUES ('old-key-id-1234567890', ?, 'k', -7, 0, 't')").bind(ed.id).run();
    const bad = await h.call('POST', '/invite/accept', { token, passkey: { id: 'y'.repeat(30), alg: -7, publicKey: 'zz', clientDataJSON: '', authenticatorData: '' } });
    expect(bad.status).toBe(400);
    const keys = await h.env.CATALOG_DB.prepare('SELECT id FROM staff_passkeys WHERE user_id = ?').bind(ed.id).all<{ id: string }>();
    expect((keys.results ?? []).map((k) => k.id)).toEqual(['old-key-id-1234567890']);
    expect((await h.call('POST', '/invite/lookup', { token })).status).toBe(200);
    expect((await h.call('POST', '/invite/accept', { token, password: 'a brand new password' })).status).toBe(200);
    const after = await h.env.CATALOG_DB.prepare('SELECT count(*) AS n FROM staff_passkeys WHERE user_id = ?').bind(ed.id).first<{ n: number }>();
    expect(after?.n).toBe(0);
  });
});
