/** Passkeys for staff accounts: the same WebAuthn checks as the owner panel, stored per person. */
import type { Env } from '../env';
import { b64urlToBytes, derToRaw, type LoginInput, type RegisterInput } from '../panel/passkey';

export const MAX_PASSKEYS = 10;

const enc = new TextEncoder();

/** Consumes a challenge (single use). */
async function takeChallenge(env: Env, challenge: string, kind: string): Promise<boolean> {
  const r = await env.CATALOG_DB.prepare('DELETE FROM panel_challenges WHERE challenge = ? AND kind = ? AND expires_at > ? RETURNING challenge')
    .bind(challenge, kind, new Date().toISOString())
    .first();
  return Boolean(r);
}

interface ClientData {
  type?: string;
  challenge?: string;
  origin?: string;
}

async function checkCommon(env: Env, kind: 'register' | 'login', clientDataJSON: string, authenticatorData: string, origin: string, rpId: string): Promise<{ authData: Uint8Array<ArrayBuffer>; signCount: number }> {
  const client = JSON.parse(new TextDecoder().decode(b64urlToBytes(clientDataJSON))) as ClientData;
  if (client.type !== (kind === 'register' ? 'webauthn.create' : 'webauthn.get')) throw new Error('Wrong ceremony type.');
  if (client.origin !== origin) throw new Error('Wrong origin.');
  if (!client.challenge || !(await takeChallenge(env, client.challenge, kind))) throw new Error('This request expired. Try again.');
  const authData = b64urlToBytes(authenticatorData);
  if (authData.length < 37) throw new Error('Bad authenticator data.');
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(rpId)));
  for (let i = 0; i < 32; i++) if (authData[i] !== rpHash[i]) throw new Error('Wrong site for this passkey.');
  const flags = authData[32];
  if (!(flags & 0x01)) throw new Error('User presence is required.');
  if (!(flags & 0x04)) throw new Error('User verification is required.');
  const signCount = ((authData[33] << 24) >>> 0) + (authData[34] << 16) + (authData[35] << 8) + authData[36];
  return { authData, signCount };
}

async function importKey(spkiB64: string, alg: number): Promise<{ key: CryptoKey; params: { name: string; hash?: string } }> {
  const spki = b64urlToBytes(spkiB64);
  if (alg === -7) return { key: await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']), params: { name: 'ECDSA', hash: 'SHA-256' } };
  if (alg === -257) return { key: await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']), params: { name: 'RSASSA-PKCS1-v1_5' } };
  throw new Error('Unsupported passkey type.');
}

export async function registerStaffPasskey(env: Env, userId: string, input: RegisterInput, origin: string, rpId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(input.id)) throw new Error('Bad credential id.');
  if (input.alg !== -7 && input.alg !== -257) throw new Error('Unsupported passkey type.');
  const n = await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM staff_passkeys WHERE user_id = ?').bind(userId).first<{ n: number }>();
  if (Number(n?.n ?? 0) >= MAX_PASSKEYS) throw new Error('This account already has the most passkeys allowed. Remove one first.');
  const { signCount } = await checkCommon(env, 'register', input.clientDataJSON, input.authenticatorData, origin, rpId);
  await importKey(input.publicKey, input.alg); // proves the key parses
  await env.CATALOG_DB.prepare('INSERT INTO staff_passkeys (id, user_id, public_key, alg, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(input.id, userId, input.publicKey, input.alg, signCount, (input.name ?? '').slice(0, 60) || 'Passkey', new Date().toISOString())
    .run();
}

/** Checks a sign-in assertion and returns the id of the person it belongs to. */
export async function verifyStaffPasskey(env: Env, input: LoginInput, origin: string, rpId: string): Promise<string> {
  const row = await env.CATALOG_DB.prepare('SELECT user_id, public_key, alg, sign_count FROM staff_passkeys WHERE id = ?')
    .bind(String(input.id ?? ''))
    .first<{ user_id: string; public_key: string; alg: number; sign_count: number }>();
  if (!row) throw new Error('This passkey is not registered here.');
  const { authData, signCount } = await checkCommon(env, 'login', input.clientDataJSON, input.authenticatorData, origin, rpId);
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', b64urlToBytes(input.clientDataJSON)));
  const signed = new Uint8Array(new ArrayBuffer(authData.length + 32));
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);
  const { key, params } = await importKey(row.public_key, row.alg);
  let sig = b64urlToBytes(input.signature);
  if (row.alg === -7) sig = derToRaw(sig);
  if (!(await crypto.subtle.verify(params, key, sig, signed))) throw new Error('The passkey signature did not verify.');
  // A counter that goes backwards suggests a cloned authenticator (synced passkeys report 0).
  if (signCount !== 0 && row.sign_count !== 0 && signCount <= row.sign_count) throw new Error('This passkey looks cloned. Ask an administrator to reset your sign-in.');
  await env.CATALOG_DB.prepare('UPDATE staff_passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?').bind(signCount, new Date().toISOString(), input.id).run();
  return row.user_id;
}
