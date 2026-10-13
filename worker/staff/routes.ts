/**
 * Staff portal API: GET/POST /api/staff/*.
 *
 * Sign-in is a passkey (fastest) or an email and password, behind the invisible proof-of-work bot
 * check, lockouts and rate limits. Accounts are created by an owner or administrator, who hands the
 * person a one-time link; the person chooses their own passkey or password. Every change made by
 * staff lands in the activity log, and most can be undone from there.
 */
import type { Env } from '../env';
import { HttpError, badRequest, json, notFound, readJson } from '../lib/http';
import { PBKDF2_ITERATIONS, getOwner, hashPassword, lockedOut, randomToken, recordAttempt as recordPanelAttempt, sameString, sha256 } from '../panel/auth';
import { bytesToB64url, newChallenge, type LoginInput, type RegisterInput } from '../panel/passkey';
import {
  AREAS,
  AREA_LABELS,
  auditStatement,
  canGrant,
  canManage,
  canManageUsers,
  currentUser,
  endSession,
  isArea,
  isRole,
  newUserId,
  published,
  requireUser,
  sessionCookie,
  startSession,
  toUser,
  type Area,
  type AuditRow,
  type Role,
  type StaffUser,
} from './core';
import { checkPow, newPow, POW_BITS, POW_BITS_UNDER_ATTACK } from './pow';
import { MAX_PASSKEYS, registerStaffPasskey, verifyStaffPasskey } from './passkey';
import { codesLeft, newCodeSet, normalizeCode, spendCode } from './recovery';
import { ensureStaffTables } from './schema';
import { undoerFor, canUndoEntity } from './undo';
import { handleStaffModules } from './modules';

const PRIVATE_HEADERS = { 'x-robots-tag': 'noindex, nofollow, noarchive', 'referrer-policy': 'no-referrer' };
const INVITE_DAYS = 7;
const MIN_PASSWORD = 12;
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const RECOVERY_LINK_MINUTES = 15;

const reply = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) => json(body, { status: init.status, headers: { ...PRIVATE_HEADERS, ...(init.headers ?? {}) } });

// ------------------------------------------------------------------ small guards

const buckets = new Map<string, { n: number; at: number }>();
function limit(key: string, perMinute: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.at > 60_000) {
    buckets.set(key, { n: 1, at: now });
    if (buckets.size > 5000) buckets.clear();
    return;
  }
  b.n++;
  if (b.n > perMinute) throw new HttpError(429, 'rate_limited', 'Too many requests. Wait a minute and try again.', 60);
}

/** Same-origin JSON requests from the staff page only. */
export function checkPost(request: Request, url: URL): void {
  const origin = request.headers.get('origin');
  if (request.headers.get('x-vtp-staff') !== '1' || (origin && origin !== url.origin)) throw new HttpError(403, 'unauthorized', 'Not allowed.');
}

const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= 200;

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

async function failuresFor(env: Env, ip: string, email: string | null): Promise<{ mine: number; theirs: number }> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const r = await env.CATALOG_DB.prepare('SELECT sum(CASE WHEN ip = ?1 THEN 1 ELSE 0 END) AS mine, sum(CASE WHEN email = ?2 THEN 1 ELSE 0 END) AS theirs FROM staff_attempts WHERE at >= ?3 AND ok = 0')
    .bind(ip, email ?? '', since)
    .first<{ mine: number | null; theirs: number | null }>();
  return { mine: Number(r?.mine ?? 0), theirs: Number(r?.theirs ?? 0) };
}

async function guardAttempts(env: Env, ip: string, email: string | null): Promise<void> {
  const f = await failuresFor(env, ip, email);
  if (f.mine >= 8 || (email && f.theirs >= 6)) throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in 15 minutes.', 900);
}

/** Recovery has its own counters, so junk sign-in attempts for someone's email can never block their recovery. */
async function guardRecover(env: Env, ip: string, key: string): Promise<void> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const r = await env.CATALOG_DB.prepare(
    "SELECT sum(CASE WHEN ip = ?1 AND email LIKE 'recover:%' THEN 1 ELSE 0 END) AS mine, sum(CASE WHEN email = ?2 THEN 1 ELSE 0 END) AS theirs FROM staff_attempts WHERE at >= ?3 AND ok = 0",
  )
    .bind(ip, key, since)
    .first<{ mine: number | null; theirs: number | null }>();
  if (Number(r?.mine ?? 0) >= 8 || Number(r?.theirs ?? 0) >= 30) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
}

const record = (env: Env, ip: string, email: string | null, ok: boolean) =>
  env.CATALOG_DB.prepare('INSERT INTO staff_attempts (ip, email, at, ok) VALUES (?, ?, ?, ?)')
    .bind(ip, email, new Date().toISOString(), ok ? 1 : 0)
    .run();

let lastCleanup = 0;
async function maybeCleanup(env: Env): Promise<void> {
  if (Date.now() - lastCleanup < 3600_000) return;
  lastCleanup = Date.now();
  const now = new Date().toISOString();
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM staff_sessions WHERE expires_at < ?').bind(now),
    env.CATALOG_DB.prepare('DELETE FROM staff_invites WHERE expires_at < ?').bind(new Date(Date.now() - 30 * 86_400_000).toISOString()),
    env.CATALOG_DB.prepare('DELETE FROM staff_attempts WHERE at < ?').bind(new Date(Date.now() - 2 * 86_400_000).toISOString()),
    env.CATALOG_DB.prepare('DELETE FROM staff_pow WHERE expires_at < ?').bind(now),
  ]);
}

// ------------------------------------------------------------------ accounts

interface FullRow {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: string;
  areas: string;
  active: number;
  pass_hash: string | null;
  salt: string | null;
  iterations: number | null;
  last_login_at: string | null;
}

const byEmail = (env: Env, email: string) => env.CATALOG_DB.prepare('SELECT * FROM staff_users WHERE email = ?').bind(email).first<FullRow>();
const byId = (env: Env, id: string) => env.CATALOG_DB.prepare('SELECT * FROM staff_users WHERE id = ?').bind(id).first<FullRow>();

async function issueInvite(env: Env, userId: string, kind: 'invite' | 'recovery', createdBy: string | null, hours = INVITE_DAYS * 24): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM staff_invites WHERE user_id = ?').bind(userId),
    env.CATALOG_DB.prepare('INSERT INTO staff_invites (token_hash, user_id, kind, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(
      await sha256(token),
      userId,
      kind,
      expiresAt,
      new Date().toISOString(),
      createdBy,
    ),
  ]);
  return { token, expiresAt };
}

interface InviteRow {
  token_hash: string;
  user_id: string;
  kind: string;
  expires_at: string;
  created_at: string;
  created_by: string | null;
}

const LINK_GONE = 'This link has expired or was already used. Ask for a new one.';

/**
 * A link only works for the state it was made for: a first link for an account that has never been
 * used, a recovery link for an account that is on. A turned-off account can never be switched back on
 * by a link, however it was made.
 */
async function readInvite(env: Env, token: unknown): Promise<{ user: FullRow; kind: string; hash: string; invite: InviteRow }> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{30,80}$/.test(token)) throw new HttpError(404, 'not_found', 'This link is not valid. Ask for a new one.');
  const hash = await sha256(token);
  const inv = await env.CATALOG_DB.prepare('SELECT token_hash, user_id, kind, expires_at, created_at, created_by FROM staff_invites WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, new Date().toISOString())
    .first<InviteRow>();
  const user = inv ? await byId(env, inv.user_id) : null;
  const fits = user && inv && (inv.kind === 'recovery' ? user.active === 1 : user.active === 0 && user.last_login_at === null);
  if (!inv || !user || !fits) throw new HttpError(404, 'not_found', LINK_GONE);
  return { user, kind: inv.kind, hash, invite: inv };
}

const userHandle = async (id: string) => bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`vtp-staff:${id}`))).slice(0, 16));

function publicUser(u: StaffUser) {
  return { id: u.id, email: u.email, name: u.name, department: u.department, role: u.role, areas: u.areas };
}

async function activeOwners(env: Env): Promise<number> {
  const r = await env.CATALOG_DB.prepare("SELECT count(*) AS n FROM staff_users WHERE role = 'owner' AND active = 1").first<{ n: number }>();
  return Number(r?.n ?? 0);
}

function readAreas(v: unknown): Area[] {
  return Array.isArray(v) ? [...new Set(v.filter(isArea))] : [];
}

// ------------------------------------------------------------------ router

export async function handleStaff(env: Env, request: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  const route = url.pathname.replace(/\/+$/, '').slice('/api/staff'.length);
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  await ensureStaffTables(env);
  ctx.waitUntil(maybeCleanup(env).catch(() => undefined));
  const ip = request.headers.get('cf-connecting-ip') ?? 'anon';
  const rpId = url.hostname;
  const origin = url.origin;

  // ---- open to anyone: state, bot check, sign-in, invitations
  if (method === 'GET' && route === '/state') {
    const user = await currentUser(env, request);
    const setupOpen = !user && (await activeOwners(env)) === 0 && Boolean(await getOwner(env));
    return reply({ user: user ? publicUser(user) : null, setupOpen, areas: AREAS.map((key) => ({ key, label: AREA_LABELS[key] })) });
  }

  if (method === 'GET' && route === '/challenge') {
    limit(`ch:${ip}`, 30);
    const f = await failuresFor(env, ip, null);
    return reply(await newPow(env, f.mine >= 3 ? POW_BITS_UNDER_ATTACK : POW_BITS));
  }

  if (method === 'POST') {
    checkPost(request, url);
    // A file upload arrives as a form, not JSON: the person must be signed in, and the area module reads the form itself.
    if (/^multipart\/form-data/i.test(request.headers.get('content-type') ?? '')) {
      const me = await requireUser(env, request);
      limit(`up:${me.id}`, 40);
      const handled = await handleStaffModules({ env, request, url, ctx, me, route, body: null });
      if (handled) return handled;
      throw notFound('Unknown API route.');
    }
    // Wording saved from the content screens carries a whole piece at a time, so it gets a larger limit than other requests.
    const b = await readJson<Record<string, unknown>>(request, route.startsWith('/content/') ? 96 * 1024 : 32 * 1024);

    if (route === '/login') {
      limit(`login:${ip}`, 20);
      if (typeof b.website === 'string' && b.website) throw badRequest('Could not sign in.'); // honeypot
      await checkPow(env, b.pow);
      const email = text(b.email, 200).toLowerCase();
      const password = typeof b.password === 'string' ? b.password.slice(0, 400) : '';
      await guardAttempts(env, ip, email);
      const row = email ? await byEmail(env, email) : null;
      // Always derive a hash so a wrong email and a wrong password take the same time.
      const hash = await hashPassword(password, row?.salt ?? DUMMY_SALT, row?.iterations ?? PBKDF2_ITERATIONS);
      const ok = Boolean(row && row.active === 1 && row.pass_hash && sameString(hash, row.pass_hash));
      await record(env, ip, email, ok);
      if (!ok || !row) throw new HttpError(401, 'unauthorized', 'That email and password do not match.');
      return reply({ user: publicUser(toUser(row)) }, { headers: { 'set-cookie': await startSession(env, row.id, request) } });
    }

    if (route === '/passkey/options') {
      limit(`po:${ip}`, 30);
      return reply({ challenge: await newChallenge(env, 'login'), rpId });
    }

    if (route === '/passkey/login') {
      limit(`pl:${ip}`, 20);
      await guardAttempts(env, ip, null);
      let userId: string;
      try {
        userId = await verifyStaffPasskey(env, b as unknown as LoginInput, origin, rpId);
      } catch (e) {
        await record(env, ip, null, false);
        throw new HttpError(401, 'unauthorized', e instanceof Error ? e.message : 'Passkey sign-in failed.');
      }
      const row = await byId(env, userId);
      if (!row || row.active !== 1) {
        await record(env, ip, null, false);
        throw new HttpError(401, 'unauthorized', 'This account is turned off. Ask an administrator.');
      }
      await record(env, ip, null, true);
      return reply({ user: publicUser(toUser(row)) }, { headers: { 'set-cookie': await startSession(env, row.id, request) } });
    }

    if (route === '/logout') {
      await endSession(env, request);
      return reply({ ok: true }, { headers: { 'set-cookie': sessionCookie('', 0) } });
    }

    // The very first owner proves they are the portal owner with the existing owner-panel sign-in.
    if (route === '/bootstrap') {
      limit(`bs:${ip}`, 10);
      await checkPow(env, b.pow);
      if ((await activeOwners(env)) > 0) throw new HttpError(409, 'bad_request', 'Setup is already done. Sign in instead.');
      if (await lockedOut(env, ip)) throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', 900);
      const panel = await getOwner(env);
      const email = text(b.email, 200).toLowerCase();
      const password = typeof b.password === 'string' ? b.password.slice(0, 400) : '';
      const hash = await hashPassword(password, panel?.salt ?? DUMMY_SALT, panel?.iterations ?? PBKDF2_ITERATIONS);
      const ok = Boolean(panel && sameString(email, panel.email) && sameString(hash, panel.pass_hash));
      await recordPanelAttempt(env, ip, ok);
      if (!ok || !panel) throw new HttpError(401, 'unauthorized', 'That is not the portal owner email and password.');
      const existing = await byEmail(env, panel.email);
      if (existing && existing.active === 1) throw new HttpError(409, 'bad_request', 'That account already exists. Sign in instead.');
      const id = existing?.id ?? newUserId();
      await env.CATALOG_DB.batch([
        env.CATALOG_DB.prepare('DELETE FROM staff_users WHERE active = 0 AND (id = ? OR email = ?)').bind(id, panel.email),
        env.CATALOG_DB.prepare("INSERT INTO staff_users (id, email, name, department, role, areas, active, created_at, created_by) VALUES (?, ?, ?, ?, 'owner', ?, 0, ?, NULL)").bind(
          id,
          panel.email,
          'Owner',
          'Council',
          JSON.stringify(AREAS),
          new Date().toISOString(),
        ),
      ]);
      const inv = await issueInvite(env, id, 'invite', null, 1);
      return reply({ token: inv.token });
    }

    if (route === '/invite/lookup') {
      limit(`il:${ip}`, 30);
      const { user, kind } = await readInvite(env, b.token);
      return reply({ name: user.name, email: user.email, department: user.department, kind, minPassword: MIN_PASSWORD });
    }

    if (route === '/invite/options') {
      limit(`io:${ip}`, 30);
      const { user } = await readInvite(env, b.token);
      return reply({ challenge: await newChallenge(env, 'register'), rpId, userId: await userHandle(user.id), email: user.email, name: user.name });
    }

    if (route === '/invite/accept') {
      limit(`ia:${ip}`, 20);
      const { user, kind, hash, invite } = await readInvite(env, b.token);
      const password = typeof b.password === 'string' && b.password ? b.password : null;
      const passkey = b.passkey && typeof b.passkey === 'object' ? (b.passkey as RegisterInput) : null;
      if (!password && !passkey) throw badRequest('Choose a passkey or a password to finish.');
      if (password && !validPassword(password)) throw badRequest(`Use a password of at least ${MIN_PASSWORD} characters.`);
      const name = text(b.name, 80) || user.name;
      const salt = randomToken(16);
      const passwordHash = password ? await hashPassword(password, salt) : null;
      const oldKeys = kind === 'recovery' ? ((await env.CATALOG_DB.prepare('SELECT id FROM staff_passkeys WHERE user_id = ?').bind(user.id).all<{ id: string }>()).results ?? []).map((r) => r.id) : [];

      // Spend the link first: of any number of simultaneous requests, exactly one gets to finish the account.
      const spent = await env.CATALOG_DB.prepare('DELETE FROM staff_invites WHERE token_hash = ? AND expires_at > ? RETURNING token_hash').bind(hash, new Date().toISOString()).first();
      if (!spent) throw new HttpError(404, 'not_found', LINK_GONE);
      if (passkey) {
        try {
          await registerStaffPasskey(env, user.id, passkey, origin, rpId);
        } catch (e) {
          // A passkey that did not verify must not use up the link or remove the old passkeys.
          await env.CATALOG_DB.prepare('INSERT OR IGNORE INTO staff_invites (token_hash, user_id, kind, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(invite.token_hash, invite.user_id, invite.kind, invite.expires_at, invite.created_at, invite.created_by)
            .run();
          throw badRequest(e instanceof Error ? e.message : 'Could not add the passkey.');
        }
      }
      const sets = ['name = ?', 'active = 1'];
      const vals: unknown[] = [name];
      if (passwordHash) {
        sets.push('pass_hash = ?', 'salt = ?', 'iterations = ?');
        vals.push(passwordHash, salt, PBKDF2_ITERATIONS);
      } else if (kind === 'recovery') {
        sets.push('pass_hash = NULL', 'salt = NULL', 'iterations = NULL');
      }
      const codes = await newCodeSet(env, user.id);
      const joined = auditStatement(
        env,
        { id: user.id, name },
        {
          area: 'accounts',
          action: kind === 'recovery' ? 'recovered' : 'joined',
          entity: 'account',
          entityId: user.id,
          summary: `${name} ${kind === 'recovery' ? 'set up a new sign-in' : 'finished setting up their account'}`,
        },
      );
      const guard = kind === 'recovery' ? 'active = 1' : 'active = 0 AND last_login_at IS NULL';
      const statements = [
        env.CATALOG_DB.prepare(`UPDATE staff_users SET ${sets.join(', ')} WHERE id = ? AND ${guard}`).bind(...vals, user.id),
        env.CATALOG_DB.prepare('DELETE FROM staff_sessions WHERE user_id = ?').bind(user.id),
        ...codes.statements,
        joined,
      ];
      // A recovery removes the passkeys that were there before, and only those.
      if (oldKeys.length) statements.push(env.CATALOG_DB.prepare(`DELETE FROM staff_passkeys WHERE user_id = ? AND id IN (${oldKeys.map(() => '?').join(',')})`).bind(user.id, ...oldKeys));
      const done = await env.CATALOG_DB.batch(statements);
      if (Number(done[0].meta?.changes ?? 0) !== 1) {
        // The account was turned off while the link was open.
        await env.CATALOG_DB.prepare('DELETE FROM staff_recovery WHERE user_id = ?').bind(user.id).run();
        throw new HttpError(404, 'not_found', LINK_GONE);
      }
      const fresh = (await byId(env, user.id))!;
      return reply({ user: publicUser(toUser(fresh)), recoveryCodes: codes.codes }, { headers: { 'set-cookie': await startSession(env, user.id, request) } });
    }

    // Lost a passkey and a password: a recovery code opens the same "set up a new sign-in" step as an administrator's link.
    if (route === '/recover') {
      limit(`rc:${ip}`, 10);
      if (typeof b.website === 'string' && b.website) throw badRequest('Could not recover the account.'); // honeypot
      await checkPow(env, b.pow);
      const email = text(b.email, 200).toLowerCase();
      const key = `recover:${email}`;
      await guardRecover(env, ip, key);
      const row = validEmail(email) ? await byEmail(env, email) : null;
      const code = normalizeCode(b.code);
      // The same lookups run whether or not the email, the account or the code is real.
      const live = Boolean(row && row.active === 1);
      const spent = await spendCode(env, live ? row!.id : 'none', code ?? 'NONE');
      const ok = Boolean(live && code && spent);
      await record(env, ip, key, ok);
      if (!ok || !row) throw new HttpError(401, 'unauthorized', 'That email and recovery code do not match.');
      const inv = await issueInvite(env, row.id, 'recovery', null, RECOVERY_LINK_MINUTES / 60);
      await auditStatement(
        env,
        { id: row.id, name: row.name },
        { area: 'accounts', action: 'used a recovery code', entity: 'account', entityId: row.id, summary: `${row.name} signed in with a recovery code` },
      ).run();
      return reply({ token: inv.token });
    }

    // ---- everything below needs a signed-in person
    const me = await requireUser(env, request);

    if (route === '/passkey/add/options') {
      const ids = await env.CATALOG_DB.prepare('SELECT id FROM staff_passkeys WHERE user_id = ?').bind(me.id).all<{ id: string }>();
      return reply({ challenge: await newChallenge(env, 'register'), rpId, userId: await userHandle(me.id), email: me.email, name: me.name, exclude: (ids.results ?? []).map((r) => r.id) });
    }

    if (route === '/passkey/add') {
      try {
        await registerStaffPasskey(env, me.id, b as unknown as RegisterInput, origin, rpId);
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Could not add the passkey.');
      }
      return reply({ ok: true });
    }

    if (route === '/passkey/remove') {
      const id = String(b.id ?? '');
      const mine = await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM staff_passkeys WHERE user_id = ?').bind(me.id).first<{ n: number }>();
      const row = await byId(env, me.id);
      if (Number(mine?.n ?? 0) <= 1 && !row?.pass_hash) throw badRequest('Keep at least one way to sign in. Add a password or another passkey first.');
      await env.CATALOG_DB.prepare('DELETE FROM staff_passkeys WHERE id = ? AND user_id = ?').bind(id, me.id).run();
      return reply({ ok: true });
    }

    if (route === '/password') {
      const row = (await byId(env, me.id))!;
      if (row.pass_hash) {
        const current = typeof b.current === 'string' ? b.current : '';
        await guardAttempts(env, ip, me.email);
        const ok = sameString(await hashPassword(current, row.salt ?? DUMMY_SALT, row.iterations ?? PBKDF2_ITERATIONS), row.pass_hash);
        await record(env, ip, me.email, ok);
        if (!ok) throw new HttpError(403, 'unauthorized', 'The current password is not right.');
      }
      if (!validPassword(b.next)) throw badRequest(`Use a password of at least ${MIN_PASSWORD} characters.`);
      const salt = randomToken(16);
      await env.CATALOG_DB.batch([
        env.CATALOG_DB.prepare('UPDATE staff_users SET pass_hash = ?, salt = ?, iterations = ? WHERE id = ?').bind(await hashPassword(b.next, salt), salt, PBKDF2_ITERATIONS, me.id),
        env.CATALOG_DB.prepare('DELETE FROM staff_sessions WHERE user_id = ?').bind(me.id),
      ]);
      return reply({ ok: true }, { headers: { 'set-cookie': await startSession(env, me.id, request) } });
    }

    // A new sheet of recovery codes replaces the old one. It needs proof it is really the person: their password, or a passkey.
    if (route === '/recovery/new') {
      limit(`rn:${me.id}`, 6);
      const row = (await byId(env, me.id))!;
      if (row.pass_hash) {
        const current = typeof b.current === 'string' ? b.current : '';
        await guardAttempts(env, ip, me.email);
        const ok = sameString(await hashPassword(current, row.salt ?? DUMMY_SALT, row.iterations ?? PBKDF2_ITERATIONS), row.pass_hash);
        await record(env, ip, me.email, ok);
        if (!ok) throw new HttpError(403, 'unauthorized', 'The current password is not right.');
      } else {
        if (!b.passkey || typeof b.passkey !== 'object') throw badRequest('Confirm with your passkey to make new codes.');
        const who = await verifyStaffPasskey(env, b.passkey as unknown as LoginInput, origin, rpId).catch(() => null);
        if (who !== me.id) throw new HttpError(403, 'unauthorized', 'That passkey does not belong to this account.');
      }
      const codes = await newCodeSet(env, me.id);
      await env.CATALOG_DB.batch([
        ...codes.statements,
        auditStatement(env, me, { area: 'accounts', action: 'made new recovery codes', entity: 'account', entityId: me.id, summary: `${me.name} made a new set of recovery codes` }),
      ]);
      return reply({ codes: codes.codes });
    }

    if (route === '/users') {
      if (!canManageUsers(me)) throw new HttpError(403, 'unauthorized', 'Only administrators can add people.');
      const email = text(b.email, 200).toLowerCase();
      const name = text(b.name, 80);
      const role: Role = isRole(b.role) ? b.role : 'editor';
      if (!validEmail(email)) throw badRequest('Enter a valid email address.');
      if (!name) throw badRequest('Enter the person’s name.');
      if (!canGrant(me, role)) throw new HttpError(403, 'unauthorized', 'You can add editors. Ask an owner for other roles.');
      const areas = role === 'editor' ? readAreas(b.areas) : [...AREAS];
      if (role === 'editor' && !areas.length) throw badRequest('Choose at least one area for this person to edit.');
      if (await byEmail(env, email)) throw new HttpError(409, 'bad_request', 'That email already has an account.');
      const id = newUserId();
      const department = text(b.department, 80) || null;
      await env.CATALOG_DB.batch([
        env.CATALOG_DB.prepare('INSERT INTO staff_users (id, email, name, department, role, areas, active, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)').bind(
          id,
          email,
          name,
          department,
          role,
          JSON.stringify(areas),
          new Date().toISOString(),
          me.id,
        ),
        auditStatement(env, me, { area: 'accounts', action: 'added', entity: 'account', entityId: id, summary: `Added ${name} (${role})`, after: { email, name, department, role, areas } }),
      ]);
      const inv = await issueInvite(env, id, 'invite', me.id);
      return reply({ id, invite: { path: `/staff/join#${inv.token}`, expiresAt: inv.expiresAt } });
    }

    if (route === '/users/update') {
      if (!canManageUsers(me)) throw new HttpError(403, 'unauthorized', 'Only administrators can change accounts.');
      const target = await byId(env, String(b.id ?? ''));
      if (!target) throw notFound('That account does not exist.');
      const t = toUser(target);
      if (!canManage(me, t)) throw new HttpError(403, 'unauthorized', 'Ask an owner to change this account.');
      const role: Role = isRole(b.role) ? b.role : t.role;
      if (role !== t.role && !canGrant(me, role)) throw new HttpError(403, 'unauthorized', 'Ask an owner to change this role.');
      const active = typeof b.active === 'boolean' ? b.active : t.active;
      if (t.id === me.id && (!active || role !== t.role)) throw badRequest('You cannot turn off or change the role of your own account.');
      if (t.role === 'owner' && t.active && (!active || role !== 'owner') && (await activeOwners(env)) <= 1) throw badRequest('There must always be one active owner.');
      const areas = role === 'editor' ? (Array.isArray(b.areas) ? readAreas(b.areas) : t.areas) : [...AREAS];
      if (role === 'editor' && !areas.length) throw badRequest('Choose at least one area for this person to edit.');
      const name = text(b.name, 80) || t.name;
      const department = 'department' in b ? text(b.department, 80) || null : t.department;
      const after = { name, department, role, areas, active };
      const statements = [
        env.CATALOG_DB.prepare('UPDATE staff_users SET name = ?, department = ?, role = ?, areas = ?, active = ? WHERE id = ?').bind(
          name,
          department,
          role,
          JSON.stringify(areas),
          active ? 1 : 0,
          t.id,
        ),
        auditStatement(env, me, {
          area: 'accounts',
          action: active === t.active ? 'changed' : active ? 'turned on' : 'turned off',
          entity: 'account',
          entityId: t.id,
          summary: `${active === t.active ? 'Changed' : active ? 'Turned on' : 'Turned off'} the account for ${name}`,
          before: { name: t.name, department: t.department, role: t.role, areas: t.areas, active: t.active },
          after,
        }),
      ];
      if (!active) {
        // A turned-off account keeps nothing that could bring it back: no sessions, no open links, no recovery codes.
        statements.push(
          env.CATALOG_DB.prepare('DELETE FROM staff_sessions WHERE user_id = ?').bind(t.id),
          env.CATALOG_DB.prepare('DELETE FROM staff_invites WHERE user_id = ?').bind(t.id),
          env.CATALOG_DB.prepare('DELETE FROM staff_recovery WHERE user_id = ?').bind(t.id),
        );
      }
      await env.CATALOG_DB.batch(statements);
      return reply({ ok: true });
    }

    if (route === '/users/reset') {
      if (!canManageUsers(me)) throw new HttpError(403, 'unauthorized', 'Only administrators can reset sign-in.');
      const target = await byId(env, String(b.id ?? ''));
      if (!target) throw notFound('That account does not exist.');
      const t = toUser(target);
      if (!canManage(me, t)) throw new HttpError(403, 'unauthorized', 'Ask an owner to reset this account.');
      if (!t.active && target.last_login_at) throw new HttpError(409, 'bad_request', 'This account is turned off. Turn it on first, then make a new link.');
      // Removes every way to sign in, every recovery code and every open session; the new link sets up fresh ones.
      await env.CATALOG_DB.batch([
        env.CATALOG_DB.prepare('DELETE FROM staff_recovery WHERE user_id = ?').bind(t.id),
        env.CATALOG_DB.prepare('DELETE FROM staff_passkeys WHERE user_id = ?').bind(t.id),
        env.CATALOG_DB.prepare('DELETE FROM staff_sessions WHERE user_id = ?').bind(t.id),
        env.CATALOG_DB.prepare('UPDATE staff_users SET pass_hash = NULL, salt = NULL, iterations = NULL WHERE id = ?').bind(t.id),
        auditStatement(env, me, { area: 'accounts', action: 'reset', entity: 'account', entityId: t.id, summary: `Reset the sign-in for ${t.name}` }),
      ]);
      const inv = await issueInvite(env, t.id, t.active ? 'recovery' : 'invite', me.id);
      return reply({ invite: { path: `/staff/join#${inv.token}`, expiresAt: inv.expiresAt } });
    }

    if (route === '/audit/undo') {
      const entry = await env.CATALOG_DB.prepare('SELECT * FROM staff_audit WHERE id = ?').bind(Number(b.id)).first<AuditRow>();
      if (!entry) throw notFound('That entry does not exist.');
      if (entry.area === 'accounts' || !isArea(entry.area)) throw badRequest('Account changes cannot be undone here.');
      if (me.role === 'editor' && !me.areas.includes(entry.area)) throw new HttpError(403, 'unauthorized', 'Your account does not include this area.');
      if (entry.undone_at) throw badRequest('This change was already undone.');
      const undo = undoerFor(entry.entity);
      if (!undo) throw badRequest('This kind of change cannot be undone automatically.');
      const summary = await undo(env, me, entry);
      await env.CATALOG_DB.batch([
        env.CATALOG_DB.prepare('UPDATE staff_audit SET undone_at = ?, undone_by = ? WHERE id = ?').bind(new Date().toISOString(), me.name, entry.id),
        auditStatement(env, me, { area: entry.area, action: 'undid', entity: entry.entity, entityId: entry.entity_id, summary }),
      ]);
      await published(env);
      return reply({ ok: true, summary });
    }

    // Content areas (records, votes, people, map, budget, notices, site) live in their own modules.
    const handled = await handleStaffModules({ env, request, url, ctx, me, route, body: b });
    if (handled) return handled;
    throw notFound('Unknown API route.');
  }

  // ---- signed-in reads
  const me = await requireUser(env, request);

  if (route === '/me/credentials') {
    const keys = await env.CATALOG_DB.prepare('SELECT id, name, created_at, last_used_at FROM staff_passkeys WHERE user_id = ? ORDER BY created_at').bind(me.id).all();
    const row = await byId(env, me.id);
    return reply({ passkeys: keys.results ?? [], hasPassword: Boolean(row?.pass_hash), maxPasskeys: MAX_PASSKEYS, recoveryLeft: await codesLeft(env, me.id) });
  }

  if (route === '/users') {
    if (!canManageUsers(me)) throw new HttpError(403, 'unauthorized', 'Only administrators can see accounts.');
    const rows = await env.CATALOG_DB.prepare(
      `SELECT u.*, (SELECT count(*) FROM staff_passkeys p WHERE p.user_id = u.id) AS passkeys,
              (SELECT expires_at FROM staff_invites i WHERE i.user_id = u.id AND i.expires_at > ?1 LIMIT 1) AS invite_expires
       FROM staff_users u ORDER BY u.active DESC, lower(u.name)`,
    )
      .bind(new Date().toISOString())
      .all<FullRow & { passkeys: number; invite_expires: string | null }>();
    return reply({
      items: (rows.results ?? []).map((r) => ({
        ...publicUser(toUser(r)),
        active: r.active === 1,
        lastLoginAt: r.last_login_at,
        hasPassword: Boolean(r.pass_hash),
        passkeys: Number(r.passkeys),
        invitePending: Boolean(r.invite_expires),
        canManage: canManage(me, toUser(r)),
      })),
    });
  }

  if (route === '/audit') {
    const p = url.searchParams;
    const n = Number(p.get('limit'));
    const take = Number.isInteger(n) && n > 0 && n <= 100 ? n : 40;
    const before = Number(p.get('before'));
    const area = p.get('area');
    const allowed: string[] = me.role === 'editor' ? [...me.areas] : [...AREAS];
    if (canManageUsers(me)) allowed.push('accounts');
    const areas = area && allowed.includes(area) ? [area] : allowed;
    const marks = areas.map(() => '?').join(',');
    const rows = await env.CATALOG_DB.prepare(
      `SELECT id, at, user_id, user_name, area, action, entity, entity_id, summary, undone_at, undone_by FROM staff_audit
       WHERE id < ? AND area IN (${marks}) ORDER BY id DESC LIMIT ?`,
    )
      .bind(Number.isInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER, ...areas, take)
      .all<AuditRow>();
    return reply({
      items: (rows.results ?? []).map((r) => ({ ...r, undoable: r.area !== 'accounts' && r.action !== 'undid' && !r.undone_at && canUndoEntity(r.entity) })),
    });
  }

  const handled = await handleStaffModules({ env, request, url, ctx, me, route, body: null });
  if (handled) return handled;
  throw notFound('Unknown API route.');
}
