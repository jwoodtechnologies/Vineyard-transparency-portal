/**
 * The private panel and the two public write endpoints that feed its activity log.
 *
 * The panel lives under an unguessable path (PANEL_PREFIX) that is not linked anywhere and does not
 * appear in the public site's JavaScript. It is also marked noindex and requires a sign-in.
 *
 * Accounts: one owner (account 1) and uploaders the owner invites with a one-time link
 * (PANEL_PREFIX/invite/<token>, 72 hours). Uploaders sign in with a passkey only. The owner's
 * signs in with email and password (passkeys optional), unchanged; uploaders use passkeys only. Sessions name the
 * account and role, and the account is checked (exists, role, not turned off) on every request.
 *
 * Public:  POST /api/visit     (page view beacon)   POST /api/feedback  (thumbs up or down)
 * Private: GET  PANEL_PREFIX   (the page)           PANEL_PREFIX/api/*  (sign-in and data)
 */
import type { Env } from '../env';
import { HttpError, badRequest, json, notFound, readJson } from '../lib/http';
import { PANEL_PAGE } from './page';
import { PBKDF2_ITERATIONS, getOwner, hashPassword, issueSession, lockedOut, randomToken, readSession, recordAttempt, sameString, sessionCookie, sha256, type Owner } from './auth';
import { databaseBytes, ensureActivityTables, logFeedback, logVisit, STORAGE_CEILING_BYTES, who } from './store';
import { bytesToB64url, newChallenge, registerPasskey, verifyPasskey, type LoginInput, type RegisterInput } from './passkey';
import { ensureContribTables, syncOwnerAccount } from '../contrib/schema';
import { archiveRoom } from '../contrib/indexing';
import { plainLine } from '../lib/contrib';
import { auditLog, listUploads, lookupMeetings, lookupProjects, staffDelete, staffEdit, staffFile, staffForm, type Me } from '../contrib/staff';
import { hideSubmission, listSubmissions, removeSubmission, restoreSubmission, setSubmissionsOpen, submissionLog } from '../contrib/resident';
import { coverage, refreshCoverage } from '../lib/coverage';

export const PANEL_PREFIX = '/api/k/x79k82r8fjjz9ki9b3dpi2';
export const INVITE_HOURS = 72;

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
  // CSRF: same-origin requests from the panel page only.
  const origin = request.headers.get('origin');
  if (request.headers.get('x-vtp-panel') !== '1' || (origin && origin !== url.origin)) throw new HttpError(403, 'unauthorized', 'Not allowed.');
}

const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 10 && p.length <= 200;

interface Session {
  owner: Owner;
  me: Me;
}

/** The signed-in account, checked against its row: it must exist, keep its role and not be turned off. */
export async function currentAccount(env: Env, request: Request): Promise<Session | null> {
  const s = await readSession(env, request);
  if (!s) return null;
  await ensureContribTables(env);
  const a = await env.CATALOG_DB.prepare('SELECT id, name, role, disabled_at FROM panel_accounts WHERE id = ?').bind(s.account.id).first<{ id: number; name: string; role: 'owner' | 'uploader'; disabled_at: string | null }>();
  if (!a || a.disabled_at || a.role !== s.account.role) return null;
  return { owner: s.owner, me: { id: Number(a.id), name: a.name, role: a.role } };
}

async function signedIn(env: Env, request: Request): Promise<Session> {
  const s = await currentAccount(env, request);
  if (!s) throw new HttpError(401, 'unauthorized', 'Please sign in.');
  return s;
}

async function ownerOnly(env: Env, request: Request): Promise<Session> {
  const s = await signedIn(env, request);
  if (s.me.role !== 'owner') throw new HttpError(403, 'unauthorized', 'Only the owner can do this.');
  return s;
}

async function passkeyCount(env: Env, accountId: number): Promise<number> {
  const r = await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM panel_passkeys WHERE account_id = ?').bind(accountId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/**
 * The owner signs in with email and password, with or without passkeys, exactly as before uploader
 * accounts existed. Do not change the owner's sign-in without the owner's say.
 */
export async function passwordAllowed(env?: Env): Promise<boolean> {
  void env;
  return true;
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
  const room = await archiveRoom(env).catch(() => ({ stored: 0, hardStop: 0 }));
  out.archive = { bytes: room.stored, ceiling: room.hardStop };
  return out;
}

// ------------------------------------------------------------------ invites

async function inviteRow(env: Env, token: unknown): Promise<{ token_hash: string; role: string; name: string | null } | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return env.CATALOG_DB.prepare('SELECT token_hash, role, name FROM panel_invites WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?')
    .bind(await sha256(token), new Date().toISOString())
    .first<{ token_hash: string; role: string; name: string | null }>();
}

/** A new one-time invite. The link is returned once; only its hash is stored. */
export async function createInvite(env: Env, me: Me, name: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(24);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_HOURS * 3600_000).toISOString();
  await env.CATALOG_DB.prepare("INSERT INTO panel_invites (token_hash, role, name, created_by, created_at, expires_at) VALUES (?, 'uploader', ?, ?, ?, ?)")
    .bind(await sha256(token), name || null, me.id, now.toISOString(), expiresAt)
    .run();
  return { token, expiresAt };
}

/** Uses up an invite (once): creates the account and its first passkey, or leaves the invite unused if the passkey fails. */
export async function acceptInvite(env: Env, token: unknown, name: string, credential: RegisterInput, origin: string, rpId: string): Promise<{ id: number; name: string; role: 'uploader' }> {
  const row = await inviteRow(env, token);
  if (!row) throw new HttpError(410, 'unauthorized', 'This invite link is not valid. It may have been used or expired.');
  const now = new Date().toISOString();
  const taken = await env.CATALOG_DB.prepare('UPDATE panel_invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? RETURNING token_hash').bind(now, row.token_hash, now).first();
  if (!taken) throw new HttpError(410, 'unauthorized', 'This invite link is not valid. It may have been used or expired.');
  const created = await env.CATALOG_DB.prepare("INSERT INTO panel_accounts (name, role, created_at) VALUES (?, 'uploader', ?) RETURNING id").bind(name, now).first<{ id: number }>();
  const id = Number(created!.id);
  try {
    await registerPasskey(env, credential, origin, rpId, id);
  } catch (e) {
    await env.CATALOG_DB.batch([env.CATALOG_DB.prepare('DELETE FROM panel_accounts WHERE id = ?').bind(id), env.CATALOG_DB.prepare('UPDATE panel_invites SET used_at = NULL WHERE token_hash = ?').bind(row.token_hash)]);
    throw badRequest(e instanceof Error ? e.message : 'Could not create the passkey.');
  }
  await env.CATALOG_DB.prepare('UPDATE panel_invites SET used_by = ? WHERE token_hash = ?').bind(id, row.token_hash).run();
  return { id, name, role: 'uploader' };
}

const userIdFor = async (seed: string) => bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))).slice(0, 16));
const displayName = (v: unknown) => plainLine(v, 60).replace(/[<>]/g, '');

// ------------------------------------------------------------------ routes

export async function handlePanel(env: Env, request: Request, url: URL): Promise<Response> {
  const path = url.pathname.slice(PANEL_PREFIX.length).replace(/\/+$/, '');
  const method = request.method;
  if ((path === '' || /^\/invite\/[A-Za-z0-9_-]{20,100}$/.test(path)) && method === 'GET') return page();
  if (!path.startsWith('/api/')) throw notFound('Unknown API route.');
  await ensureActivityTables(env);
  await ensureContribTables(env);
  const route = path.slice(4);
  const ip = request.headers.get('cf-connecting-ip') ?? 'anon';
  const db = env.CATALOG_DB;

  if (method === 'GET' && route === '/state') {
    const owner = await getOwner(env);
    const s = owner ? await currentAccount(env, request) : null;
    const pk = owner ? await db.prepare('SELECT count(*) AS n FROM panel_passkeys').first<{ n: number }>() : null;
    return reply({
      hasOwner: Boolean(owner),
      signedIn: Boolean(s),
      account: s ? s.me : null,
      email: s?.me.role === 'owner' ? owner!.email : null,
      hasPasskeys: Number(pk?.n ?? 0) > 0,
      passwordAllowed: owner ? await passwordAllowed(env) : true,
    });
  }

  const rpId = url.hostname;
  const origin = url.origin;

  if (method === 'POST') {
    checkPost(request, url);
    // Multipart file uploads are read by their handler; everything else is small JSON.
    if (route === '/uploads/file') {
      const s = await signedIn(env, request);
      return reply(await staffFile(env, request, s.me), { status: 201 });
    }
    const b = await readJson<Record<string, unknown>>(request, 64 * 1024);

    if (route === '/setup') {
      if (await getOwner(env)) throw new HttpError(409, 'bad_request', 'The account already exists. Sign in instead.');
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
      const row = await db.prepare('SELECT code_hash FROM panel_setup WHERE code_hash = ? AND expires_at > ?').bind(await sha256(code), new Date().toISOString()).first();
      if (!row) {
        await recordAttempt(env, ip, false);
        throw new HttpError(403, 'unauthorized', 'That setup code is not valid or has expired.');
      }
      if (!validEmail(b.email)) throw badRequest('Enter a valid email address.');
      if (!validPassword(b.password)) throw badRequest('Use a password of at least 10 characters.');
      const salt = randomToken(16);
      const now = new Date().toISOString();
      await db.batch([
        db.prepare('INSERT INTO panel_owner (id, email, pass_hash, salt, iterations, session_key, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').bind(b.email.toLowerCase(), await hashPassword(b.password, salt), salt, PBKDF2_ITERATIONS, randomToken(32), now, now),
        db.prepare('DELETE FROM panel_setup'),
      ]);
      await syncOwnerAccount(env);
      await recordAttempt(env, ip, true);
      const s = await issueSession((await getOwner(env))!);
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
      await syncOwnerAccount(env);
      const s = await issueSession(owner!);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, s.value, s.maxAge) } });
    }

    if (route === '/passkey/login/options') return reply({ challenge: await newChallenge(env, 'login'), rpId });

    if (route === '/passkey/login') {
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const owner = await getOwner(env);
      let account: { id: number; role: 'owner' | 'uploader' };
      try {
        if (!owner) throw new Error('No account yet.');
        const { accountId } = await verifyPasskey(env, b as unknown as LoginInput, origin, rpId);
        const a = await db.prepare('SELECT id, role, disabled_at FROM panel_accounts WHERE id = ?').bind(accountId).first<{ id: number; role: 'owner' | 'uploader'; disabled_at: string | null }>();
        if (!a || a.disabled_at) throw new Error('This account is turned off.');
        account = { id: Number(a.id), role: a.role };
      } catch (e) {
        await recordAttempt(env, ip, false);
        throw new HttpError(401, 'unauthorized', e instanceof Error ? e.message : 'Passkey sign-in failed.');
      }
      await recordAttempt(env, ip, true);
      const s = await issueSession(owner, account);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, s.value, s.maxAge) } });
    }

    if (route === '/invite/check') {
      const row = await inviteRow(env, b.token);
      if (!row) {
        await recordAttempt(env, ip, false);
        throw new HttpError(410, 'unauthorized', 'This invite link is not valid. It may have been used or expired.');
      }
      return reply({ ok: true, name: row.name ?? '' });
    }

    if (route === '/invite/options') {
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const row = await inviteRow(env, b.token);
      if (!row) {
        await recordAttempt(env, ip, false);
        throw new HttpError(410, 'unauthorized', 'This invite link is not valid. It may have been used or expired.');
      }
      return reply({ challenge: await newChallenge(env, 'register'), rpId, userId: await userIdFor(`vtp-invite:${row.token_hash}`) });
    }

    if (route === '/invite/accept') {
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const owner = await getOwner(env);
      if (!owner) throw new HttpError(409, 'bad_request', 'The panel is not set up yet.');
      const name = displayName(b.name);
      if (!name) throw badRequest('Enter your name.');
      let account: { id: number; role: 'uploader' };
      try {
        account = await acceptInvite(env, b.token, name, b as unknown as RegisterInput, origin, rpId);
      } catch (e) {
        await recordAttempt(env, ip, false);
        throw e;
      }
      await recordAttempt(env, ip, true);
      const s = await issueSession(owner, account);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, s.value, s.maxAge) } });
    }

    if (route === '/logout') return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, '', 0) } });

    // Everything below needs a signed-in account.
    const s = await signedIn(env, request);
    const owner = () => {
      if (s.me.role !== 'owner') throw new HttpError(403, 'unauthorized', 'Only the owner can do this.');
    };

    if (route === '/passkey/register/options') {
      const ids = await db.prepare('SELECT id FROM panel_passkeys WHERE account_id = ?').bind(s.me.id).all<{ id: string }>();
      const label = s.me.role === 'owner' ? s.owner.email : s.me.name;
      const userId = await userIdFor(s.me.role === 'owner' ? `vtp-owner:${s.owner.email}` : `vtp-account:${s.me.id}`);
      return reply({ challenge: await newChallenge(env, 'register'), rpId, userId, email: label, exclude: (ids.results ?? []).map((r) => r.id) });
    }

    if (route === '/passkey/register') {
      try {
        await registerPasskey(env, b as unknown as RegisterInput, origin, rpId, s.me.id);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Could not add the passkey.');
      }
      return reply({ ok: true, passwordAllowed: await passwordAllowed(env) });
    }

    if (route === '/passkey/delete') {
      // Uploaders sign in only with passkeys, so they always keep one. The owner also has a password.
      const keepOne = s.me.role !== 'owner';
      if (keepOne && (await passkeyCount(env, s.me.id)) <= 1) throw badRequest('Keep at least one passkey. Add another before removing this one.');
      const r = keepOne
        ? await db.prepare('DELETE FROM panel_passkeys WHERE id = ? AND account_id = ? AND (SELECT count(*) FROM panel_passkeys WHERE account_id = ?) > 1').bind(String(b.id ?? ''), s.me.id, s.me.id).run()
        : await db.prepare('DELETE FROM panel_passkeys WHERE id = ? AND account_id = ?').bind(String(b.id ?? ''), s.me.id).run();
      if (!Number(r.meta?.changes ?? 0)) throw notFound('That passkey was not found.');
      return reply({ ok: true });
    }

    if (route === '/password') {
      owner();
      const current = typeof b.current === 'string' ? b.current : '';
      if (!sameString(await hashPassword(current, s.owner.salt, s.owner.iterations), s.owner.pass_hash)) throw new HttpError(403, 'unauthorized', 'The current password is not right.');
      if (!validPassword(b.next)) throw badRequest('Use a password of at least 10 characters.');
      const salt = randomToken(16);
      await db.prepare('UPDATE panel_owner SET pass_hash = ?, salt = ?, iterations = ?, session_key = ?, updated_at = ? WHERE id = 1').bind(await hashPassword(b.next, salt), salt, PBKDF2_ITERATIONS, randomToken(32), new Date().toISOString()).run();
      const fresh = await issueSession((await getOwner(env))!);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie(PANEL_PREFIX, fresh.value, fresh.maxAge) } });
    }

    // Uploads (any account; edits and deletes are limited to one's own unless owner).
    if (route === '/uploads/project' || route === '/uploads/note' || route === '/uploads/link') return reply(await staffForm(env, route.slice(9), b, s.me), { status: 201 });
    if (route === '/uploads/edit') return reply(await staffEdit(env, b, s.me));
    if (route === '/uploads/delete') return reply(await staffDelete(env, b, s.me));

    // Owner only from here.
    owner();
    if (route === '/invites/create') {
      const inv = await createInvite(env, s.me, displayName(b.name));
      return reply({ ok: true, path: `${PANEL_PREFIX}/invite/${inv.token}`, expiresAt: inv.expiresAt });
    }
    if (route === '/invites/revoke') {
      await db.prepare('UPDATE panel_invites SET revoked_at = ? WHERE token_hash = ? AND used_at IS NULL').bind(new Date().toISOString(), String(b.id ?? '')).run();
      return reply({ ok: true });
    }
    if (route === '/accounts/disable' || route === '/accounts/enable') {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id === 1) throw badRequest('The owner account cannot be turned off.');
      await db.prepare(`UPDATE panel_accounts SET disabled_at = ${route === '/accounts/disable' ? '?' : 'NULL'} WHERE id = ? AND role = 'uploader'`).bind(...(route === '/accounts/disable' ? [new Date().toISOString(), id] : [id])).run();
      return reply({ ok: true });
    }
    if (route === '/submissions/remove') return reply(await removeSubmission(env, b.id));
    if (route === '/submissions/hide') return reply(await hideSubmission(env, b.id));
    if (route === '/submissions/restore') return reply(await restoreSubmission(env, b.id));
    if (route === '/submissions/switch') return reply(await setSubmissionsOpen(env, b.open === true));
    if (route === '/coverage/refresh') return reply(await refreshCoverage(env));
    throw notFound('Unknown API route.');
  }

  if (method !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  const s = await signedIn(env, request);
  const p = url.searchParams;

  // Any account.
  if (route === '/passkeys') {
    const r = await db.prepare('SELECT id, name, created_at, last_used_at FROM panel_passkeys WHERE account_id = ? ORDER BY created_at').bind(s.me.id).all();
    return reply({ items: r.results ?? [] });
  }
  if (route === '/uploads') return reply(await listUploads(env, s.me, url));
  if (route === '/lookup/meetings') return reply(await lookupMeetings(env, p.get('q') ?? ''));
  if (route === '/lookup/projects') return reply(await lookupProjects(env));

  // Owner only: activity logs, accounts, submissions and settings.
  await ownerOnly(env, request);
  const limit = limitOf(url);
  const before = beforeOf(url);
  const like = (v: string | null) => (v ? `%${v.slice(0, 100).replace(/[%_\\]/g, (m) => `\\${m}`)}%` : null);

  if (route === '/summary') return reply(await summary(env));
  if (route === '/audit') return reply(await auditLog(env));
  if (route === '/submissions') return reply(await listSubmissions(env));
  if (route === '/submissions/log') return reply(await submissionLog(env));
  if (route === '/coverage') return reply(await coverage(env));

  if (route === '/accounts') {
    const r = await db
      .prepare('SELECT a.id, a.name, a.role, a.created_at, a.disabled_at, (SELECT count(*) FROM panel_passkeys k WHERE k.account_id = a.id) AS passkeys, (SELECT count(*) FROM uploads u WHERE u.account_id = a.id) AS uploads FROM panel_accounts a ORDER BY a.id')
      .all();
    return reply({ items: r.results ?? [] });
  }

  if (route === '/invites') {
    const r = await db
      .prepare("SELECT token_hash AS id, name, created_at, expires_at, used_at, revoked_at, (SELECT name FROM panel_accounts WHERE id = used_by) AS used_by_name FROM panel_invites WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50")
      .bind(new Date(Date.now() - 30 * 86_400_000).toISOString())
      .all();
    return reply({ items: r.results ?? [], now: new Date().toISOString() });
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
    const r = await db.prepare('SELECT * FROM activity_feedback WHERE id < ? AND (? IS NULL OR vote = ?) ORDER BY id DESC LIMIT ?').bind(before, vote, vote, limit).all();
    return reply({ items: r.results ?? [] });
  }

  throw notFound('Unknown API route.');
}
