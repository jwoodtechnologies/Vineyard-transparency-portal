import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnv } from './helpers/d1';

type Env = ReturnType<typeof testEnv>;
// Password hashing is deliberately slow; give a busy machine room.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined), passThroughOnException() {} } as unknown as ExecutionContext;

function solve(id: string, bits: number): string {
  for (let n = 0; ; n++) {
    const nonce = n.toString(36);
    const d = createHash('sha256').update(`${id}:${nonce}`).digest();
    let z = 0;
    for (const b of d) {
      if (b === 0) z += 8;
      else {
        z += Math.clz32(b) - 24;
        break;
      }
    }
    if (z >= bits) return nonce;
  }
}

let env: Env;
let mod: typeof import('../worker/staff/routes');
let http: typeof import('../worker/lib/http');
let panel: typeof import('../worker/panel/auth');
let store: typeof import('../worker/panel/store');

beforeEach(async () => {
  vi.resetModules();
  env = testEnv();
  mod = await import('../worker/staff/routes');
  http = await import('../worker/lib/http');
  panel = await import('../worker/panel/auth');
  store = await import('../worker/panel/store');
});

interface Reply {
  status: number;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  cookie: string | null;
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown, opts: { cookie?: string | null; ip?: string; csrf?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: 'https://vineyardportal.org', 'content-type': 'application/json', 'cf-connecting-ip': opts.ip ?? '10.0.0.1' };
  if (opts.csrf !== false) headers['x-vtp-staff'] = '1';
  if (opts.cookie) headers.cookie = opts.cookie;
  const url = new URL(`https://vineyardportal.org/api/staff${path}`);
  let res: Response;
  try {
    res = await mod.handleStaff(env as never, new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), url, ctx);
  } catch (e) {
    if (!(e instanceof http.HttpError)) throw e;
    res = http.errorResponse(e);
  }
  const set = res.headers.get('set-cookie');
  return { status: res.status, body: (await res.json()) as Reply['body'], cookie: set ? set.split(';')[0] : null };
}

async function pow(ip?: string) {
  const c = await call('GET', '/challenge', undefined, { ip });
  return { id: c.body.id as string, nonce: solve(c.body.id as string, c.body.bits as number) };
}

async function seedPanelOwner(email = 'jacob@example.org', password = 'a long panel password') {
  await store.ensureActivityTables(env as never);
  const salt = panel.randomToken(16);
  await env.CATALOG_DB.prepare('INSERT INTO panel_owner (id, email, pass_hash, salt, iterations, session_key, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)')
    .bind(email, await panel.hashPassword(password, salt), salt, panel.PBKDF2_ITERATIONS, panel.randomToken(32), 'x', 'x')
    .run();
  return { email, password };
}

/** First owner through the whole setup, ending with a signed-in cookie. */
async function makeOwner(password = 'owner password 123') {
  const o = await seedPanelOwner();
  const boot = await call('POST', '/bootstrap', { email: o.email, password: o.password, pow: await pow() });
  expect(boot.status).toBe(200);
  const joined = await call('POST', '/invite/accept', { token: boot.body.token, name: 'Jacob Wood', password });
  expect(joined.status).toBe(200);
  return { cookie: joined.cookie!, email: o.email, password };
}

async function addPerson(cookie: string, input: Record<string, unknown>, password = 'another long password') {
  const made = await call('POST', '/users', input, { cookie });
  expect(made.status).toBe(200);
  const token = (made.body.invite.path as string).split('#')[1];
  const joined = await call('POST', '/invite/accept', { token, password });
  expect(joined.status).toBe(200);
  return { cookie: joined.cookie!, id: made.body.id as string, token, password };
}

describe('the bot check', () => {
  it('accepts a solved challenge once and nothing else', async () => {
    const { checkPow, newPow, leadingZeroBits } = await import('../worker/staff/pow');
    await mod.handleStaff(env as never, new Request('https://vineyardportal.org/api/staff/state'), new URL('https://vineyardportal.org/api/staff/state'), ctx);
    const c = await newPow(env as never, 8);
    const nonce = solve(c.id, 8);
    await expect(checkPow(env as never, { id: c.id, nonce })).resolves.toBeUndefined();
    await expect(checkPow(env as never, { id: c.id, nonce })).rejects.toThrow(/security check/);
    const d = await newPow(env as never, 12);
    // A nonce that does not reach 12 zero bits is refused.
    let bad = 'a';
    while (leadingZeroBits(new Uint8Array(createHash('sha256').update(`${d.id}:${bad}`).digest())) >= 12) bad += 'a';
    await expect(checkPow(env as never, { id: d.id, nonce: bad })).rejects.toThrow();
    await expect(checkPow(env as never, null)).rejects.toThrow();
    await expect(checkPow(env as never, { id: 'x'.repeat(24), nonce: '1' })).rejects.toThrow();
  });

  it('counts leading zero bits', async () => {
    const { leadingZeroBits } = await import('../worker/staff/pow');
    expect(leadingZeroBits(new Uint8Array([0, 0, 0x10]))).toBe(19);
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(leadingZeroBits(new Uint8Array([0, 0x80]))).toBe(8);
  });
});

describe('first owner and sign-in', () => {
  it('stays closed until the portal owner exists, then opens setup', async () => {
    expect((await call('GET', '/state')).body.setupOpen).toBe(false);
    await seedPanelOwner();
    const s = await call('GET', '/state');
    expect(s.body.setupOpen).toBe(true);
    expect(s.body.user).toBeNull();
  });

  it('refuses setup with the wrong owner password', async () => {
    const o = await seedPanelOwner();
    const r = await call('POST', '/bootstrap', { email: o.email, password: 'not the password', pow: await pow() });
    expect(r.status).toBe(401);
  });

  it('creates the first owner, then closes setup for good', async () => {
    const owner = await makeOwner();
    const state = await call('GET', '/state', undefined, { cookie: owner.cookie });
    expect(state.body.user).toMatchObject({ email: 'jacob@example.org', role: 'owner', name: 'Jacob Wood' });
    expect(state.body.user.areas).toHaveLength(7);
    const again = await call('POST', '/bootstrap', { email: owner.email, password: 'a long panel password', pow: await pow() });
    expect(again.status).toBe(409);
    expect((await call('GET', '/state')).body.setupOpen).toBe(false);
  });

  it('signs in with email and password and signs out', async () => {
    const owner = await makeOwner();
    const out = await call('POST', '/logout', {}, { cookie: owner.cookie });
    expect(out.status).toBe(200);
    expect((await call('GET', '/state', undefined, { cookie: owner.cookie })).body.user).toBeNull();
    const bad = await call('POST', '/login', { email: owner.email, password: 'wrong password here', pow: await pow() });
    expect(bad.status).toBe(401);
    const good = await call('POST', '/login', { email: owner.email.toUpperCase(), password: owner.password, pow: await pow() });
    expect(good.status).toBe(200);
    expect(good.cookie).toMatch(/^vtp_s=/);
  });

  it('needs a solved bot check and ignores the honeypot field', async () => {
    const owner = await makeOwner();
    expect((await call('POST', '/login', { email: owner.email, password: owner.password })).status).toBe(400);
    expect((await call('POST', '/login', { email: owner.email, password: owner.password, pow: { id: 'a'.repeat(24), nonce: '1' } })).status).toBe(400);
    expect((await call('POST', '/login', { email: owner.email, password: owner.password, website: 'http://spam', pow: await pow() })).status).toBe(400);
  });

  it('locks an account after repeated wrong passwords', async () => {
    const owner = await makeOwner();
    for (let i = 0; i < 6; i++) await call('POST', '/login', { email: owner.email, password: `wrong password ${i}`, pow: await pow(`10.0.1.${i}`) }, { ip: `10.0.1.${i}` });
    const r = await call('POST', '/login', { email: owner.email, password: owner.password, pow: await pow('10.0.1.9') }, { ip: '10.0.1.9' });
    expect(r.status).toBe(429);
  });

  it('rejects state-changing requests without the page header', async () => {
    const r = await call('POST', '/logout', {}, { csrf: false });
    expect(r.status).toBe(403);
  });
});

describe('people and permissions', () => {
  it('lets an owner add an editor who can only reach the areas given', async () => {
    const owner = await makeOwner();
    const clerk = await addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', department: 'Recorder', role: 'editor', areas: ['records', 'votes'] });
    const me = await call('GET', '/state', undefined, { cookie: clerk.cookie });
    expect(me.body.user).toMatchObject({ role: 'editor', areas: ['records', 'votes'], department: 'Recorder' });
    expect((await call('GET', '/users', undefined, { cookie: clerk.cookie })).status).toBe(403);
    expect((await call('POST', '/users', { name: 'X', email: 'x@y.org', role: 'editor', areas: ['votes'] }, { cookie: clerk.cookie })).status).toBe(403);
    const list = await call('GET', '/users', undefined, { cookie: owner.cookie });
    expect(list.body.items).toHaveLength(2);
  });

  it('keeps editors out of the accounts log and other areas', async () => {
    const owner = await makeOwner();
    const clerk = await addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['votes'] });
    await env.CATALOG_DB.prepare("INSERT INTO staff_audit (at, user_id, user_name, area, action, entity, summary) VALUES ('t', 'u', 'U', 'budget', 'edited', 'budget', 'Edited the budget')").run();
    await env.CATALOG_DB.prepare("INSERT INTO staff_audit (at, user_id, user_name, area, action, entity, summary) VALUES ('t', 'u', 'U', 'votes', 'edited', 'vote', 'Edited a vote')").run();
    const mine = await call('GET', '/audit', undefined, { cookie: clerk.cookie });
    expect(mine.body.items.map((i: { area: string }) => i.area)).toEqual(['votes']);
    const all = await call('GET', '/audit', undefined, { cookie: owner.cookie });
    expect(new Set(all.body.items.map((i: { area: string }) => i.area))).toEqual(new Set(['accounts', 'budget', 'votes']));
  });

  it('lets an administrator manage editors but not owners or other administrators', async () => {
    const owner = await makeOwner();
    const admin = await addPerson(owner.cookie, { name: 'Ann Admin', email: 'ann@vineyard.example', role: 'admin' });
    const ok = await call('POST', '/users', { name: 'Ed Editor', email: 'ed@vineyard.example', role: 'editor', areas: ['map'] }, { cookie: admin.cookie });
    expect(ok.status).toBe(200);
    const noAdmin = await call('POST', '/users', { name: 'Bo', email: 'bo@vineyard.example', role: 'admin' }, { cookie: admin.cookie });
    expect(noAdmin.status).toBe(403);
    const list = await call('GET', '/users', undefined, { cookie: admin.cookie });
    const ownerRow = list.body.items.find((u: { role: string }) => u.role === 'owner');
    expect(ownerRow.canManage).toBe(false);
    const attempt = await call('POST', '/users/update', { id: ownerRow.id, active: false }, { cookie: admin.cookie });
    expect(attempt.status).toBe(403);
  });

  it('requires an area for an editor and a real email', async () => {
    const owner = await makeOwner();
    expect((await call('POST', '/users', { name: 'A', email: 'a@b.org', role: 'editor', areas: [] }, { cookie: owner.cookie })).status).toBe(400);
    expect((await call('POST', '/users', { name: 'A', email: 'nope', role: 'editor', areas: ['votes'] }, { cookie: owner.cookie })).status).toBe(400);
    expect((await call('POST', '/users', { name: 'A', email: 'a@b.org', role: 'editor', areas: ['votes'] }, { cookie: owner.cookie })).status).toBe(200);
    expect((await call('POST', '/users', { name: 'A2', email: 'A@B.org', role: 'editor', areas: ['votes'] }, { cookie: owner.cookie })).status).toBe(409);
  });

  it('never lets the last owner be turned off or demoted', async () => {
    const owner = await makeOwner();
    const list = await call('GET', '/users', undefined, { cookie: owner.cookie });
    const me = list.body.items[0];
    expect((await call('POST', '/users/update', { id: me.id, active: false }, { cookie: owner.cookie })).status).toBe(400);
    expect((await call('POST', '/users/update', { id: me.id, role: 'admin' }, { cookie: owner.cookie })).status).toBe(400);
  });

  it('turning an account off signs it out at once', async () => {
    const owner = await makeOwner();
    const ed = await addPerson(owner.cookie, { name: 'Ed Editor', email: 'ed@vineyard.example', role: 'editor', areas: ['map'] });
    expect((await call('GET', '/state', undefined, { cookie: ed.cookie })).body.user).not.toBeNull();
    expect((await call('POST', '/users/update', { id: ed.id, active: false }, { cookie: owner.cookie })).status).toBe(200);
    expect((await call('GET', '/state', undefined, { cookie: ed.cookie })).body.user).toBeNull();
    const login = await call('POST', '/login', { email: 'ed@vineyard.example', password: ed.password, pow: await pow() });
    expect(login.status).toBe(401);
  });

  it('changes areas and shows them to the person', async () => {
    const owner = await makeOwner();
    const ed = await addPerson(owner.cookie, { name: 'Ed Editor', email: 'ed@vineyard.example', role: 'editor', areas: ['map'] });
    await call('POST', '/users/update', { id: ed.id, areas: ['map', 'budget'] }, { cookie: owner.cookie });
    expect((await call('GET', '/state', undefined, { cookie: ed.cookie })).body.user.areas).toEqual(['map', 'budget']);
  });
});

describe('invitations and recovery', () => {
  it('works once and not again', async () => {
    const owner = await makeOwner();
    const made = await call('POST', '/users', { name: 'Ed', email: 'ed@vineyard.example', role: 'editor', areas: ['map'] }, { cookie: owner.cookie });
    const token = (made.body.invite.path as string).split('#')[1];
    const look = await call('POST', '/invite/lookup', { token });
    expect(look.body).toMatchObject({ email: 'ed@vineyard.example', kind: 'invite', minPassword: 12 });
    expect((await call('POST', '/invite/accept', { token, password: 'short' })).status).toBe(400);
    expect((await call('POST', '/invite/accept', { token })).status).toBe(400);
    expect((await call('POST', '/invite/accept', { token, password: 'a good long password' })).status).toBe(200);
    expect((await call('POST', '/invite/accept', { token, password: 'a good long password' })).status).toBe(404);
    expect((await call('POST', '/invite/lookup', { token: 'x'.repeat(43) })).status).toBe(404);
  });

  it('cannot sign in before the link is used', async () => {
    const owner = await makeOwner();
    await call('POST', '/users', { name: 'Ed', email: 'ed@vineyard.example', role: 'editor', areas: ['map'] }, { cookie: owner.cookie });
    expect((await call('POST', '/login', { email: 'ed@vineyard.example', password: 'anything long enough', pow: await pow() })).status).toBe(401);
  });

  it('reset removes the old sign-in and a new link sets up another', async () => {
    const owner = await makeOwner();
    const ed = await addPerson(owner.cookie, { name: 'Ed', email: 'ed@vineyard.example', role: 'editor', areas: ['map'] });
    const r = await call('POST', '/users/reset', { id: ed.id }, { cookie: owner.cookie });
    expect(r.status).toBe(200);
    expect((await call('GET', '/state', undefined, { cookie: ed.cookie })).body.user).toBeNull();
    expect((await call('POST', '/login', { email: 'ed@vineyard.example', password: ed.password, pow: await pow() })).status).toBe(401);
    const token = (r.body.invite.path as string).split('#')[1];
    expect((await call('POST', '/invite/lookup', { token })).body.kind).toBe('recovery');
    const joined = await call('POST', '/invite/accept', { token, password: 'a brand new password' });
    expect(joined.status).toBe(200);
    expect((await call('POST', '/login', { email: 'ed@vineyard.example', password: 'a brand new password', pow: await pow() })).status).toBe(200);
  });

  it('a new link replaces the old one', async () => {
    const owner = await makeOwner();
    const made = await call('POST', '/users', { name: 'Ed', email: 'ed@vineyard.example', role: 'editor', areas: ['map'] }, { cookie: owner.cookie });
    const first = (made.body.invite.path as string).split('#')[1];
    const again = await call('POST', '/users/reset', { id: made.body.id }, { cookie: owner.cookie });
    const second = (again.body.invite.path as string).split('#')[1];
    expect((await call('POST', '/invite/lookup', { token: first })).status).toBe(404);
    expect((await call('POST', '/invite/lookup', { token: second })).status).toBe(200);
  });
});

describe('own credentials', () => {
  it('changes a password and keeps the person signed in', async () => {
    const owner = await makeOwner();
    expect((await call('POST', '/password', { current: 'wrong', next: 'a brand new password' }, { cookie: owner.cookie })).status).toBe(403);
    const ok = await call('POST', '/password', { current: owner.password, next: 'a brand new password' }, { cookie: owner.cookie });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/state', undefined, { cookie: owner.cookie })).body.user).toBeNull(); // old session ended
    expect((await call('GET', '/state', undefined, { cookie: ok.cookie })).body.user).not.toBeNull();
  });

  it('lists credentials', async () => {
    const owner = await makeOwner();
    const c = await call('GET', '/me/credentials', undefined, { cookie: owner.cookie });
    expect(c.body).toMatchObject({ hasPassword: true, passkeys: [] });
  });
});

describe('undo and the public data version', () => {
  it('runs a registered undo once and logs it', async () => {
    const owner = await makeOwner();
    const { registerUndo } = await import('../worker/staff/undo');
    const seen: number[] = [];
    registerUndo('thing', async (_env, _user, entry) => {
      seen.push(entry.id);
      return 'Put the thing back';
    });
    await env.CATALOG_DB.prepare("INSERT INTO staff_audit (at, user_id, user_name, area, action, entity, summary) VALUES ('t', 'u', 'U', 'votes', 'edited', 'thing', 'Edited a thing')").run();
    const list = await call('GET', '/audit', undefined, { cookie: owner.cookie });
    const row = list.body.items.find((i: { entity: string }) => i.entity === 'thing');
    expect(row.undoable).toBe(true);
    expect((await call('POST', '/audit/undo', { id: row.id }, { cookie: owner.cookie })).status).toBe(200);
    expect(seen).toEqual([row.id]);
    expect((await call('POST', '/audit/undo', { id: row.id }, { cookie: owner.cookie })).status).toBe(400);
    const after = await call('GET', '/audit', undefined, { cookie: owner.cookie });
    expect(after.body.items[0]).toMatchObject({ action: 'undid', summary: 'Put the thing back' });
  });

  it('moves the archive data version when a change is undone, so public pages refresh', async () => {
    const owner = await makeOwner();
    const { registerUndo } = await import('../worker/staff/undo');
    const { dataVersion } = await import('../worker/lib/dataVersion');
    registerUndo('thing', async () => 'Put the thing back');
    await env.CATALOG_DB.prepare("INSERT INTO staff_audit (at, user_id, user_name, area, action, entity, summary) VALUES ('t', 'u', 'U', 'votes', 'edited', 'thing', 'Edited a thing')").run();
    const before = await dataVersion(env as never);
    const list = await call('GET', '/audit', undefined, { cookie: owner.cookie });
    const row = list.body.items.find((i: { entity: string }) => i.entity === 'thing');
    expect((await call('POST', '/audit/undo', { id: row.id }, { cookie: owner.cookie })).status).toBe(200);
    expect(await dataVersion(env as never)).toBe(before + 1);
  });

  it('does not touch the data version for sign-in or account changes', async () => {
    const { dataVersion } = await import('../worker/lib/dataVersion');
    const owner = await makeOwner();
    await addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['votes'] });
    expect(await dataVersion(env as never)).toBe(0);
  });
});

// ---------------------------------------------------------------- passkeys with a software authenticator

const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');

function rawToDer(raw: Uint8Array): Uint8Array {
  const part = (x: Uint8Array) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    let v = Array.from(x.slice(i));
    if (v[0] & 0x80) v = [0, ...v];
    return [0x02, v.length, ...v];
  };
  const r = part(raw.slice(0, 32));
  const s = part(raw.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

async function authenticator() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const id = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const rp = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('vineyardportal.org')));
  const authData = (flags: number, count: number) => {
    const out = new Uint8Array(37);
    out.set(rp, 0);
    out[32] = flags;
    new DataView(out.buffer).setUint32(33, count);
    return out;
  };
  return {
    id,
    async create(challenge: string) {
      const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: 'https://vineyardportal.org' }));
      return {
        id,
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData(0x45, 0)),
        publicKey: b64u((await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer),
        alg: -7,
        name: 'Test laptop',
      };
    },
    async get(challenge: string, count = 0, origin = 'https://vineyardportal.org') {
      const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const data = authData(0x05, count);
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
      const signed = new Uint8Array(data.length + 32);
      signed.set(data, 0);
      signed.set(hash, data.length);
      const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signed));
      return { id, clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(data), signature: b64u(rawToDer(sig)) };
    },
  };
}

describe('passkeys', () => {
  it('sets up an account with a passkey and signs in with it', async () => {
    const owner = await makeOwner();
    const made = await call('POST', '/users', { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['records'] }, { cookie: owner.cookie });
    const token = (made.body.invite.path as string).split('#')[1];
    const key = await authenticator();
    const opts = await call('POST', '/invite/options', { token });
    expect(opts.body.rpId).toBe('vineyardportal.org');
    const joined = await call('POST', '/invite/accept', { token, passkey: await key.create(opts.body.challenge) });
    expect(joined.status).toBe(200);

    const login = await call('POST', '/passkey/options', {});
    const ok = await call('POST', '/passkey/login', await key.get(login.body.challenge, 1));
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^vtp_s=/);
    expect((await call('GET', '/state', undefined, { cookie: ok.cookie })).body.user.name).toBe('Pat Clerk');
    // The password route does not work for a passkey-only account.
    expect((await call('POST', '/login', { email: 'pat@vineyard.example', password: 'anything at all here', pow: await pow() })).status).toBe(401);
  });

  it('uses each sign-in challenge once, and only from the real site', async () => {
    const owner = await makeOwner();
    const made = await call('POST', '/users', { name: 'Pat', email: 'pat@vineyard.example', role: 'editor', areas: ['records'] }, { cookie: owner.cookie });
    const token = (made.body.invite.path as string).split('#')[1];
    const key = await authenticator();
    const opts = await call('POST', '/invite/options', { token });
    await call('POST', '/invite/accept', { token, passkey: await key.create(opts.body.challenge) });
    const a = await call('POST', '/passkey/options', {});
    const proof = await key.get(a.body.challenge, 1);
    expect((await call('POST', '/passkey/login', proof)).status).toBe(200);
    expect((await call('POST', '/passkey/login', proof)).status).toBe(401); // replay
    const b = await call('POST', '/passkey/options', {});
    expect((await call('POST', '/passkey/login', await key.get(b.body.challenge, 2, 'https://evil.example'))).status).toBe(401);
    const stranger = await authenticator();
    const c = await call('POST', '/passkey/options', {});
    expect((await call('POST', '/passkey/login', await stranger.get(c.body.challenge))).status).toBe(401);
  });

  it('adds a second passkey while signed in and refuses to remove the last way in', async () => {
    const owner = await makeOwner();
    const key = await authenticator();
    const opts = await call('POST', '/passkey/add/options', {}, { cookie: owner.cookie });
    expect((await call('POST', '/passkey/add', await key.create(opts.body.challenge), { cookie: owner.cookie })).status).toBe(200);
    const creds = await call('GET', '/me/credentials', undefined, { cookie: owner.cookie });
    expect(creds.body.passkeys).toHaveLength(1);
    expect((await call('POST', '/passkey/remove', { id: key.id }, { cookie: owner.cookie })).status).toBe(200); // the password remains
    const again = await call('POST', '/passkey/add/options', {}, { cookie: owner.cookie });
    await call('POST', '/passkey/add', await key.create(again.body.challenge), { cookie: owner.cookie });
    await env.CATALOG_DB.prepare('UPDATE staff_users SET pass_hash = NULL').run();
    expect((await call('POST', '/passkey/remove', { id: key.id }, { cookie: owner.cookie })).status).toBe(400);
  });

  it('stops a passkey whose account was turned off', async () => {
    const owner = await makeOwner();
    const made = await call('POST', '/users', { name: 'Pat', email: 'pat@vineyard.example', role: 'editor', areas: ['records'] }, { cookie: owner.cookie });
    const token = (made.body.invite.path as string).split('#')[1];
    const key = await authenticator();
    const opts = await call('POST', '/invite/options', { token });
    await call('POST', '/invite/accept', { token, passkey: await key.create(opts.body.challenge) });
    await call('POST', '/users/update', { id: made.body.id, active: false }, { cookie: owner.cookie });
    const a = await call('POST', '/passkey/options', {});
    expect((await call('POST', '/passkey/login', await key.get(a.body.challenge, 1))).status).toBe(401);
  });
});
