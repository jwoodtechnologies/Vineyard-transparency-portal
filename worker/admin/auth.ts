/**
 * Authentication for /api/admin/* (ingestion only; the public site has no accounts).
 *
 * Preferred: GitHub Actions OIDC. The ingestion workflow requests a short-lived ID token for
 * audience OIDC_AUDIENCE; the Worker verifies its RS256 signature against GitHub's published
 * JWKS and checks issuer, audience, expiry, repository and ref. No long-lived credential exists.
 *
 * Optional: INGEST_TOKEN (a Worker secret, >= 32 chars) for running the CLI from a local machine.
 */
import { HttpError } from '../lib/http';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;

/** The subset of Worker configuration this module reads (Env satisfies it structurally). */
export interface AuthConfig {
  OIDC_AUDIENCE?: string;
  OIDC_REPOSITORY?: string;
  OIDC_ALLOWED_REFS?: string;
  INGEST_TOKEN?: string;
}

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const keyCache = new Map<string, CryptoKey>();

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function jwks(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.fetchedAt < 3600_000) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new HttpError(503, 'server', 'Could not load identity provider keys.');
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

async function keyFor(kid: string): Promise<CryptoKey | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  let jwk = (await jwks()).find((k) => k.kid === kid);
  if (!jwk) jwk = (await jwks(true)).find((k) => k.kid === kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty ?? 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  keyCache.set(kid, key);
  return key;
}

export interface OidcClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  repository?: string;
  ref?: string;
  workflow_ref?: string;
  run_id?: string;
}

export async function verifyGithubOidc(token: string, env: AuthConfig): Promise<OidcClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'unauthorized', 'Invalid token.');
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as { alg?: string; kid?: string };
  } catch {
    throw new HttpError(401, 'unauthorized', 'Invalid token.');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'unauthorized', 'Invalid token.');
  const key = await keyFor(header.kid);
  if (!key) throw new HttpError(401, 'unauthorized', 'Unknown signing key.');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(401, 'unauthorized', 'Invalid token signature.');
  let claims: OidcClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as OidcClaims;
  } catch {
    throw new HttpError(401, 'unauthorized', 'Invalid token.');
  }
  const now = Math.floor(Date.now() / 1000);
  const audience = env.OIDC_AUDIENCE ?? '';
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const allowedRefs = (env.OIDC_ALLOWED_REFS ?? 'refs/heads/main').split(',').map((s) => s.trim()).filter(Boolean);
  if (claims.iss !== ISSUER) throw new HttpError(401, 'unauthorized', 'Wrong issuer.');
  if (!audience || !auds.includes(audience)) throw new HttpError(401, 'unauthorized', 'Wrong audience.');
  if (!(claims.exp > now - 30) || (claims.nbf != null && claims.nbf > now + 60)) throw new HttpError(401, 'unauthorized', 'Token expired.');
  if (!env.OIDC_REPOSITORY || (claims.repository ?? '').toLowerCase() !== env.OIDC_REPOSITORY.toLowerCase()) throw new HttpError(403, 'unauthorized', 'Repository not allowed.');
  if (!allowedRefs.includes(claims.ref ?? '')) throw new HttpError(403, 'unauthorized', 'Ref not allowed.');
  return claims;
}

async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (x: ArrayBuffer, y: ArrayBuffer) => boolean };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(ha, hb);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function requireIngestAuth(request: Request, env: AuthConfig): Promise<string> {
  const header = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) throw new HttpError(401, 'unauthorized', 'Authentication required.');
  const token = m[1].trim();
  if (env.INGEST_TOKEN && env.INGEST_TOKEN.length >= 32 && token.split('.').length !== 3) {
    if (await timingSafeEqualStr(token, env.INGEST_TOKEN)) return 'static-token';
    throw new HttpError(401, 'unauthorized', 'Invalid token.');
  }
  const claims = await verifyGithubOidc(token, env);
  return `github:${claims.repository}@${claims.ref}#${claims.run_id ?? ''}`;
}
