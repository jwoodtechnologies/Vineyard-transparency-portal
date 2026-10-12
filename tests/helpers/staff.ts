/**
 * A staff-portal test harness: the staff API over the in-memory database, a signed-in first owner,
 * and invited people. Call `staffHarness()` in beforeEach (it resets modules so each test starts clean).
 */
import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';
import { testEnv } from './d1';

export type StaffEnv = ReturnType<typeof testEnv>;

const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => undefined), passThroughOnException() {} } as unknown as ExecutionContext;

/** Finds a nonce whose hash has enough leading zero bits (the sign-in bot check). */
export function solve(id: string, bits: number): string {
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

export interface Reply {
  status: number;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  cookie: string | null;
}

export async function staffHarness() {
  vi.resetModules();
  const env = testEnv();
  const mod = await import('../../worker/staff/routes');
  const http = await import('../../worker/lib/http');
  const panel = await import('../../worker/panel/auth');
  const store = await import('../../worker/panel/store');

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, opts: { cookie?: string | null; ip?: string; csrf?: boolean; form?: FormData } = {}): Promise<Reply> {
    const headers: Record<string, string> = { origin: 'https://vineyardportal.org', 'cf-connecting-ip': opts.ip ?? '10.0.0.1' };
    if (!opts.form) headers['content-type'] = 'application/json';
    if (opts.csrf !== false) headers['x-vtp-staff'] = '1';
    if (opts.cookie) headers.cookie = opts.cookie;
    const url = new URL(`https://vineyardportal.org/api/staff${path}`);
    let res: Response;
    try {
      const init: RequestInit = { method, headers, body: opts.form ?? (body === undefined ? undefined : JSON.stringify(body)) };
      res = await mod.handleStaff(env as never, new Request(url, init), url, ctx);
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

  return { env, call, pow, makeOwner, addPerson, ctx };
}
