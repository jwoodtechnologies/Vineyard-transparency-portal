/**
 * Owner sign-in for the private panel. One owner account, created once with a one-time setup code
 * (printed by the migrate job, valid 24 hours). The password is never stored: only a salted
 * PBKDF2-SHA256 hash. Sessions are HMAC-signed, HttpOnly, Secure, SameSite=Strict cookies scoped to
 * the panel path; changing the password rotates the signing key, which signs out every session.
 */
import type { Env } from '../env';
import { ensureActivityTables } from './store';

export const PBKDF2_ITERATIONS = 100_000; // the Workers WebCrypto maximum
const SESSION_HOURS = 12;
export const SESSION_COOKIE = 'vtp_k';

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256(text: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hashPassword(password: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations }, key, 256);
  return b64url(bits);
}

/** Constant-time string comparison. */
export function sameString(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export interface Owner {
  email: string;
  pass_hash: string;
  salt: string;
  iterations: number;
  session_key: string;
}

export async function getOwner(env: Env): Promise<Owner | null> {
  await ensureActivityTables(env);
  return env.CATALOG_DB.prepare('SELECT email, pass_hash, salt, iterations, session_key FROM panel_owner WHERE id = 1').first<Owner>();
}

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', fromB64url(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

export async function issueSession(owner: Owner): Promise<{ value: string; maxAge: number }> {
  const maxAge = SESSION_HOURS * 3600;
  const payload = b64url(enc.encode(JSON.stringify({ e: owner.email, x: Math.floor(Date.now() / 1000) + maxAge })));
  return { value: `${payload}.${await hmac(owner.session_key, payload)}`, maxAge };
}

export async function readSession(env: Env, request: Request): Promise<Owner | null> {
  const cookie = request.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)`).exec(cookie);
  if (!m) return null;
  const owner = await getOwner(env);
  if (!owner) return null;
  const [payload, sig] = m[1].split('.');
  if (!sameString(await hmac(owner.session_key, payload), sig)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { e?: string; x?: number };
    if (data.e !== owner.email || typeof data.x !== 'number' || data.x < Date.now() / 1000) return null;
  } catch {
    return null;
  }
  return owner;
}

export function sessionCookie(prefix: string, value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=${prefix}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

/** A fresh one-time setup code while no owner exists (called by the authenticated migrate job). */
export async function newSetupCode(env: Env): Promise<string | null> {
  if (await getOwner(env)) return null;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM panel_setup'),
    env.CATALOG_DB.prepare('INSERT INTO panel_setup (code_hash, expires_at) VALUES (?, ?)').bind(await sha256(code), new Date(Date.now() + 24 * 3600_000).toISOString()),
  ]);
  return code;
}

/** Too many failed sign-ins from this IP (or overall) in the last 15 minutes. */
export async function lockedOut(env: Env, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const r = await env.CATALOG_DB.prepare('SELECT sum(CASE WHEN ip = ? THEN 1 ELSE 0 END) AS mine, count(*) AS allx FROM panel_attempts WHERE at >= ? AND ok = 0')
    .bind(ip, since)
    .first<{ mine: number | null; allx: number }>();
  return Number(r?.mine ?? 0) >= 5 || Number(r?.allx ?? 0) >= 40;
}

export async function recordAttempt(env: Env, ip: string, ok: boolean): Promise<void> {
  await env.CATALOG_DB.prepare('INSERT INTO panel_attempts (ip, at, ok) VALUES (?, ?, ?)').bind(ip, new Date().toISOString(), ok ? 1 : 0).run();
}
