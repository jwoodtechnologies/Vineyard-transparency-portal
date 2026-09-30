import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { webcrypto } from 'node:crypto';
import { requireIngestAuth, verifyGithubOidc } from '../worker/admin/auth';

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
let keys: webcrypto.CryptoKeyPair;
let jwk: webcrypto.JsonWebKey;
const config = { OIDC_AUDIENCE: 'vineyardportal.org', OIDC_REPOSITORY: 'jwoodtechnologies/Vineyard-transparency-portal', OIDC_ALLOWED_REFS: 'refs/heads/main' };

async function token(claims: Record<string, unknown>, kid = 'test-kid'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://token.actions.githubusercontent.com', aud: 'vineyardportal.org', exp: now + 300, nbf: now - 5, repository: config.OIDC_REPOSITORY, ref: 'refs/heads/main', ...claims };
  const head = enc({ alg: 'RS256', kid });
  const signed = `${head}.${enc(body)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(signed));
  return `${signed}.${Buffer.from(sig).toString('base64url')}`;
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
  jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid' }] }), { headers: { 'content-type': 'application/json' } }));
});

describe('GitHub Actions OIDC verification', () => {
  it('accepts a valid token from the configured repository and ref', async () => {
    const claims = await verifyGithubOidc(await token({}), config);
    expect(claims.repository).toBe(config.OIDC_REPOSITORY);
  });

  it.each([
    ['another repository', { repository: 'someone/else' }],
    ['another branch', { ref: 'refs/heads/feature' }],
    ['another audience', { aud: 'example.com' }],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ['another issuer', { iss: 'https://evil.example' }],
  ])('rejects %s', async (_label, claims) => {
    await expect(verifyGithubOidc(await token(claims), config)).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('rejects a tampered payload', async () => {
    const t = await token({});
    const [h, , s] = t.split('.');
    await expect(verifyGithubOidc(`${h}.${enc({ repository: config.OIDC_REPOSITORY, ref: 'refs/heads/main' })}.${s}`, config)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects garbage and missing credentials', async () => {
    await expect(verifyGithubOidc('a.b.c', config)).rejects.toMatchObject({ status: 401 });
    await expect(requireIngestAuth(new Request('https://x/api/admin/quota'), config)).rejects.toMatchObject({ status: 401 });
  });

  it('accepts the optional static token only when it is long enough and matches', async () => {
    const secret = 'x'.repeat(40);
    const ok = new Request('https://x', { headers: { authorization: `Bearer ${secret}` } });
    await expect(requireIngestAuth(ok, { ...config, INGEST_TOKEN: secret })).resolves.toBe('static-token');
    const bad = new Request('https://x', { headers: { authorization: `Bearer ${'y'.repeat(40)}` } });
    await expect(requireIngestAuth(bad, { ...config, INGEST_TOKEN: secret })).rejects.toMatchObject({ status: 401 });
  });
});
