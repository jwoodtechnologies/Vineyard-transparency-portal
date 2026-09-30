/**
 * The owner's private activity panel and the two public write endpoints that feed it.
 *
 * The panel lives under an unguessable path (PANEL_PREFIX) that is not linked anywhere and does not
 * appear in the public site's JavaScript. It is also marked noindex and requires the owner sign-in.
 *
 * Public:  POST /api/visit     (page view beacon)   POST /api/feedback  (thumbs up or down)
 * Private: GET  PANEL_PREFIX   (the page)           PANEL_PREFIX/api/*  (sign-in and data)
 */
import type { Env } from '../env';
import { HttpError, badRequest, json, notFound, readJson } from '../lib/http';
import { PANEL_PAGE } from './page';
import { PBKDF2_ITERATIONS, getOwner, hashPassword, issueSession, lockedOut, randomToken, readSession, recordAttempt, sameString, sessionCookie, sha256 } from './auth';
import { databaseBytes, ensureActivityTables, logFeedback, logVisit, STORAGE_CEILING_BYTES, who } from './store';
import { bytesToB64url, newChallenge, registerPasskey, verifyPasskey, type LoginInput, type RegisterInput } from './passkey';

export const PANEL_PREFIX = '/api/k/x79k82r8fjjz9ki9b3dpi2';

const PRIVATE_HEADERS = { 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer' };

// ------------------------------------------------------------------ public beacons

const beaconBuckets = new Map<string, { n: number; at: number }>();
function tooMany(ip: string, perMinute: number): boolean {
  const now = Date.now();
  const b = beaconBuckets.get(ip);
  if (!b || now - b.at > 60_000) {
    beaconBuckets.set(ip, { n: 1, at: now });
    if (beaconBuckets.size > 5000) beaconBuckets.clear();
    return false;
  }
  b.n++;
  return b.n > perMinute;
}

export async function handleVisit(env: Env, request: Request, ctx: ExecutionContext): Promise<Response> {
  const w = who(request);
  let body: { path?: unknown; referrer?: unknown } = {};
  try {
    body = JSON.parse((await request.text()).slice(0, 2000)) as typeof body;
  } catch {
    /* sendBeacon bodies are small JSON; anything else is ignored */
  }
  const path = typeof body.path === 'string' && body.path.startsWith('/') ? body.path : null;
  if (path && !tooMany(w.ip ?? 'anon', 60)) {
    const ref = typeof body.referrer === 'string' && /^https?:\/\//.test(body.referrer) ? body.referrer : null;
    ctx.waitUntil(logVisit(env, w, path, ref));
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function handleFeedback(env: Env, request: Request, ctx: ExecutionContext): Promise<Response> {
  const w = who(request);
  if (tooMany(`fb:${w.ip ?? 'anon'}`, 30)) throw new HttpError(429, 'rate_limited', 'Too many votes. Try again shortly.', 60);
  const b = await readJson<{ askId?: unknown; vote?: unknown; question?: unknown; answer?: unknown }>(request, 16 * 1024);
  const askId = typeof b.askId === 'string' && /^ask_[0-9a-f]{16}$/.test(b.askId) ? b.askId : null;
  const vote = b.vote === 'up' || b.vote === 'down' ? b.vote : null;
  if (!askId || !vote) throw badRequest('askId and vote (up or down) are required.');
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  ctx.waitUntil(logFeedback(env, w, askId, vote, text(b.question), text(b.answer)));
  return json({ ok: true });
}

// ------------------------------------------------------------------ private panel

function page(): Response {
  const nonce = randomToken(16);
  return new Response(PANEL_PAGE.replaceAll('__NONCE__', nonce).replaceAll('__PREFIX__', PANEL_PREFIX), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      ...PRIVATE_HEADERS,
    },
  });
}

const reply = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) => json(body, { status: init.status, headers: { ...PRIVATE_HEADERS, ...(init.headers ?? {}) } });

function checkPost(request: Request, url: URL) {
  // CSRF: same-origin JSON requests from the panel page only.
  const origin = request.headers.get('origin');
  if (request.headers.get('x-vtp-panel') !== '1' || (origin && origin !== url.origin)) throw new HttpError(403, 'unauthorized', 'Not allowed.');
}

const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 10 && p.length <= 200;

async function signedIn(env: Env, request: Request) {
  const owner = await readSession(env, request);
  if (!owner) throw new HttpError(401, 'unauthorized', 'Please sign in.');
  return owner;
}

function limitOf(url: URL): number {
  const n = Number(url.searchParams.get('limit'));
  return Number.isInteger(n) && n > 0 && n <= 200 ? n : 50;
}

function beforeOf(url: URL): number {
  const n = Number(url.searchParams.get('before'));
  return Number.isInteger(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
}

async function summary(env: Env): Promise<unknown> {
  const db = env.CATALOG_DB;
  const at = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
  const windows = { day: at(24), week: at(24 * 7), month: at(24 * 30), all: '0000' };
  const out: Record<string, unknown> = {};
  for (const [name, since] of Object.entries(windows)) {
    const [v, q, f] = await db.batch([
      db.prepare('SELECT count(*) AS visits, count(DISTINCT ip) AS people FROM activity_visits WHERE at >= ? AND is_bot = 0').bind(since),
      db.prepare('SELECT count(*) AS questions FROM activity_questions WHERE at >= ?').bind(since),
      db.prepare("SELECT sum(vote = 'up') AS up, sum(vote = 'down') AS down FROM activity_feedback WHERE at >= ?").bind(since),
    ]);
    const vr = (v.results?.[0] ?? {}) as Record<string, number>;
    const qr = (q.results?.[0] ?? {}) as Record<string, number>;
    const fr = (f.results?.[0] ?? {}) as Record<string, number | null>;
    out[name] = { visits: Number(vr.visits ?? 0), people: Number(vr.people ?? 0), questions: Number(qr.questions ?? 0), up: Number(fr.up ?? 0), down: Number(fr.down ?? 0) };
  }
  const top = await db
    .prepare("SELECT lower(trim(question)) AS q, count(*) AS n, max(at) AS last FROM activity_questions WHERE at >= ? AND mode IS NOT 'conversation' GROUP BY lower(trim(question)) ORDER BY n DESC, last DESC LIMIT 15")
    .bind(windows.month)
    .all<{ q: string; n: number; last: string }>();
  out.topQuestions = top.results ?? [];
  const size = databaseBytes() || Number(((await db.prepare('SELECT 1').run()).meta as { size_after?: number } | undefined)?.size_after ?? 0);
  out.storage = { bytes: size, ceiling: STORAGE_CEILING_BYTES, paused: size > STORAGE_CEILING_BYTES };
  return out;
}

export async function handlePanel(env: Env, request: Request, url: URL): Promise<Response> {
  const path = url.pathname.slice(PANEL_PREFIX.length).replace(/\/+$/, '');
  const method = request.method;
  if (path === '' && method === 'GET') return page();
  if (!path.startsWith('/api/')) throw notFound('Unknown API route.');
  await ensureActivityTables(env);
  const route = path.slice(4);
  const ip = request.headers.get('cf-connecting-ip') ?? 'anon';

  if (method === 'GET' && route === '/state') {
    const owner = await getOwner(env);
    const me = owner ? await readSession(env, request) : null;
    const pk = owner ? await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM panel_passkeys').first<{ n: number }>() : null;
    return reply({ hasOwner: Boolean(owner), signedIn: Boolean(me), email: me?.email ?? null, hasPasskeys: Number(pk?.n ?? 0) > 0 });
  }

  if (method === 'POST') {
    checkPost(request, url);
    const b = await readJson<Record<string, unknown>>(request, 8 * 1024);

    if (route === '/setup') {
      if (await getOwner(env)) throw new HttpError(409, 'bad_request', 'The account already exists. Sign in instead.');
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
      const row = await env.CATALOG_DB.prepare('SELECT code_hash FROM panel_setup WHERE code_hash = ? AND expires_at > ?').bind(await sha256(code), new Date().toISOString()).first();
      if (!row) {
        await recordAttempt(env, ip, false);
        throw new HttpError(403, 'unauthorized', 'That setup code is not valid or has expired.');
      }
      if (!validEmail(b.email)) throw badRequest('Enter a valid email address.');
      if (!validPassword(b.password)) throw badRequest('Use a password of at least 10 characters.');
      const salt = randomToken(16);
      const now = new Date().toISOString();
      await env.CATALOG_DB.batch([
        env.CATALOG_DB.prepare('INSERT INTO panel_owner (id, email, pass_hash, salt, iterations, session_key, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').bind(
          b.email.toLowerCase(),
          await hashPassword(b.password, salt),
          salt,
          PBKDF2_ITERATIONS,
          randomToken(32),
          now,
          now,
        ),
        env.CATALOG_DB.prepare('DELETE FROM panel_setup'),
      ]);
      await recordAttempt(env, ip, true);
      const owner = await getOwner(env);
      const s = await issueSession(owner!);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, s.value, s.maxAge) } });
    }

    if (route === '/login') {
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const owner = await getOwner(env);
      const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      const password = typeof b.password === 'string' ? b.password : '';
      // Always derive a hash so a wrong email and a wrong password take the same time.
      const hash = await hashPassword(password, owner?.salt ?? randomToken(16), owner?.iterations ?? PBKDF2_ITERATIONS);
      const ok = Boolean(owner) && sameString(email, owner!.email) && sameString(hash, owner!.pass_hash);
      await recordAttempt(env, ip, ok);
      if (!ok) throw new HttpError(401, 'unauthorized', 'That email and password do not match.');
      const s = await issueSession(owner!);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, s.value, s.maxAge) } });
    }

    const rpId = url.hostname;
    const origin = url.origin;

    if (route === '/passkey/login/options') return reply({ challenge: await newChallenge(env, 'login'), rpId });

    if (route === '/passkey/login') {
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const owner = await getOwner(env);
      try {
        if (!owner) throw new Error('No account yet.');
        await verifyPasskey(env, b as unknown as LoginInput, origin, rpId);
      } catch (e) {
        await recordAttempt(env, ip, false);
        throw new HttpError(401, 'unauthorized', e instanceof Error ? e.message : 'Passkey sign-in failed.');
      }
      await recordAttempt(env, ip, true);
      const s = await issueSession(owner);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, s.value, s.maxAge) } });
    }

    if (route === '/passkey/register/options') {
      const owner = await signedIn(env, request);
      const ids = await env.CATALOG_DB.prepare('SELECT id FROM panel_passkeys').all<{ id: string }>();
      const userId = bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`vtp-owner:${owner.email}`))).slice(0, 16));
      return reply({ challenge: await newChallenge(env, 'register'), rpId, userId, email: owner.email, exclude: (ids.results ?? []).map((r) => r.id) });
    }

    if (route === '/passkey/register') {
      await signedIn(env, request);
      try {
        await registerPasskey(env, b as unknown as RegisterInput, origin, rpId);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Could not add the passkey.');
      }
      return reply({ ok: true });
    }

    if (route === '/passkey/delete') {
      await signedIn(env, request);
      await env.CATALOG_DB.prepare('DELETE FROM panel_passkeys WHERE id = ?').bind(String(b.id ?? '')).run();
      return reply({ ok: true });
    }

    if (route === '/logout') return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, '', 0) } });

    if (route === '/password') {
      const owner = await signedIn(env, request);
      const current = typeof b.current === 'string' ? b.current : '';
      if (!sameString(await hashPassword(current, owner.salt, owner.iterations), owner.pass_hash)) throw new HttpError(403, 'unauthorized', 'The current password is not right.');
      if (!validPassword(b.next)) throw badRequest('Use a password of at least 10 characters.');
      const salt = randomToken(16);
      await env.CATALOG_DB.prepare('UPDATE panel_owner SET pass_hash = ?, salt = ?, iterations = ?, session_key = ?, updated_at = ? WHERE id = 1')
        .bind(await hashPassword(b.next, salt), salt, PBKDF2_ITERATIONS, randomToken(32), new Date().toISOString())
        .run();
      const s = await issueSession((await getOwner(env))!);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, s.value, s.maxAge) } });
    }
    throw notFound('Unknown API route.');
  }

  if (method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  await signedIn(env, request);
  const db = env.CATALOG_DB;
  const p = url.searchParams;
  const limit = limitOf(url);
  const before = beforeOf(url);
  const like = (v: string | null) => (v ? `%${v.slice(0, 100).replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null);

  if (route === '/summary') return reply(await summary(env));

  if (route === '/passkeys') {
    const r = await db.prepare('SELECT id, name, created_at, last_used_at FROM panel_passkeys ORDER BY created_at').all();
    return reply({ items: r.results ?? [] });
  }

  if (route === '/visits') {
    const bots = p.get('bots') === '1' ? 1 : 0;
    const ipq = like(p.get('ip'));
    const r = await db
      .prepare(`SELECT * FROM activity_visits WHERE id < ? AND (? = 1 OR is_bot = 0) AND (? IS NULL OR ip LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT ?`)
      .bind(before, bots, ipq, ipq, ipq, ipq, limit)
      .all();
    return reply({ items: r.results ?? [] });
  }

  if (route === '/questions') {
    const q = like(p.get('q'));
    const r = await db
      .prepare(
        `SELECT q.*, f.up, f.down FROM activity_questions q
         LEFT JOIN (SELECT ask_id, sum(vote = 'up') AS up, sum(vote = 'down') AS down FROM activity_feedback GROUP BY ask_id) f ON f.ask_id = q.ask_id
         WHERE q.id < ? AND (? IS NULL OR q.question LIKE ? ESCAPE '\\' OR q.ip LIKE ? ESCAPE '\\') ORDER BY q.id DESC LIMIT ?`,
      )
      .bind(before, q, q, q, limit)
      .all();
    return reply({ items: r.results ?? [] });
  }

  if (route === '/feedback') {
    const vote = p.get('vote') === 'up' || p.get('vote') === 'down' ? p.get('vote') : null;
    const r = await db
      .prepare('SELECT * FROM activity_feedback WHERE id < ? AND (? IS NULL OR vote = ?) ORDER BY id DESC LIMIT ?')
      .bind(before, vote, vote, limit)
      .all();
    return reply({ items: r.results ?? [] });
  }

  throw notFound('Unknown API route.');
}
