/**
 * The bot check on sign-in: a small proof of work the browser solves by itself while the person
 * types, so nothing has to be clicked, read or recognised and VPNs are not penalised. The server
 * issues a one-time challenge; the browser finds a nonce so that SHA-256("<challenge>:<nonce>")
 * starts with `bits` zero bits (about a fifth of a second at 17 bits). It is cheap for one person
 * and costly for a script trying thousands of passwords. Rate limits and lockouts sit behind it.
 */
import type { Env } from '../env';
import { HttpError } from '../lib/http';
import { bytesToB64url } from '../panel/passkey';

export const POW_BITS = 17;
export const POW_BITS_UNDER_ATTACK = 20;

const enc = new TextEncoder();

export function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

export async function newPow(env: Env, bits = POW_BITS): Promise<{ id: string; bits: number }> {
  const id = bytesToB64url(crypto.getRandomValues(new Uint8Array(18)));
  const now = new Date();
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM staff_pow WHERE expires_at < ?').bind(now.toISOString()),
    env.CATALOG_DB.prepare('INSERT INTO staff_pow (challenge, bits, expires_at) VALUES (?, ?, ?)').bind(id, bits, new Date(now.getTime() + 10 * 60_000).toISOString()),
  ]);
  return { id, bits };
}

/** Spends a challenge. Throws when it is missing, used, expired or not solved. */
export async function checkPow(env: Env, pow: unknown): Promise<void> {
  const fail = () => new HttpError(400, 'bad_request', 'The security check did not finish. Reload the page and try again.');
  if (!pow || typeof pow !== 'object') throw fail();
  const { id, nonce } = pow as { id?: unknown; nonce?: unknown };
  if (typeof id !== 'string' || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{20,40}$/.test(id) || !/^[A-Za-z0-9]{1,24}$/.test(nonce)) throw fail();
  const row = await env.CATALOG_DB.prepare('DELETE FROM staff_pow WHERE challenge = ? AND expires_at > ? RETURNING bits')
    .bind(id, new Date().toISOString())
    .first<{ bits: number }>();
  if (!row) throw fail();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${id}:${nonce}`)));
  if (leadingZeroBits(digest) < row.bits) throw fail();
}
