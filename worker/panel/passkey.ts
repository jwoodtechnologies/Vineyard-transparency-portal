/**
 * Passkeys (WebAuthn) for the owner's panel, verified with WebCrypto and no third-party code.
 *
 * Registration (signed in): the browser returns the credential's SPKI public key via
 * response.getPublicKey(), so no CBOR parsing is needed. We check the client data (type,
 * one-time challenge, origin) and the authenticator data (RP ID hash, user present, user verified).
 * Sign-in: the same checks plus the signature over authenticatorData || SHA-256(clientDataJSON),
 * using ES256 (P-256) or RS256 keys.
 */
import type { Env } from '../env';

const enc = new TextEncoder();

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const PASSKEY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS panel_passkeys (
    id TEXT PRIMARY KEY, public_key TEXT NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
    name TEXT, created_at TEXT NOT NULL, last_used_at TEXT)`,
  'CREATE TABLE IF NOT EXISTS panel_challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, expires_at TEXT NOT NULL)',
];

export async function newChallenge(env: Env, kind: 'register' | 'login'): Promise<string> {
  const challenge = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM panel_challenges WHERE expires_at < ?').bind(new Date().toISOString()),
    env.CATALOG_DB.prepare('INSERT INTO panel_challenges (challenge, kind, expires_at) VALUES (?, ?, ?)').bind(challenge, kind, new Date(Date.now() + 5 * 60_000).toISOString()),
  ]);
  return challenge;
}

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
  const clientRaw = b64urlToBytes(clientDataJSON);
  const client = JSON.parse(new TextDecoder().decode(clientRaw)) as ClientData;
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

/** ECDSA signatures from authenticators are DER; WebCrypto wants raw r || s (32 bytes each). */
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const read = () => {
    if (der[i++] !== 0x02) throw new Error('Bad signature.');
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(new ArrayBuffer(64));
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export interface RegisterInput {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  alg: number;
  name?: string;
}

export async function registerPasskey(env: Env, input: RegisterInput, origin: string, rpId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(input.id)) throw new Error('Bad credential id.');
  if (input.alg !== -7 && input.alg !== -257) throw new Error('Unsupported passkey type.');
  const { signCount } = await checkCommon(env, 'register', input.clientDataJSON, input.authenticatorData, origin, rpId);
  await importKey(input.publicKey, input.alg); // proves the key parses
  await env.CATALOG_DB.prepare('INSERT INTO panel_passkeys (id, public_key, alg, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(input.id, input.publicKey, input.alg, signCount, (input.name ?? '').slice(0, 60) || 'Passkey', new Date().toISOString())
    .run();
}

export interface LoginInput {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export async function verifyPasskey(env: Env, input: LoginInput, origin: string, rpId: string): Promise<void> {
  const row = await env.CATALOG_DB.prepare('SELECT public_key, alg, sign_count FROM panel_passkeys WHERE id = ?').bind(input.id).first<{ public_key: string; alg: number; sign_count: number }>();
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
  if (signCount !== 0 && row.sign_count !== 0 && signCount <= row.sign_count) throw new Error('This passkey looks cloned. Sign in with your password.');
  await env.CATALOG_DB.prepare('UPDATE panel_passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?').bind(signCount, new Date().toISOString(), input.id).run();
}
