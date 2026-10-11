/**
 * Optional: start the GitHub CivicClerk check from the five-minute Worker tick. CivicClerk refuses
 * Cloudflare's network, so its meetings and files are read from GitHub's runners; GitHub's own
 * schedule runs far less often than every ten minutes. When the Worker secret GITHUB_DISPATCH_TOKEN
 * is set (a fine-grained token for this repository with Actions: read and write), the Worker starts
 * that run every ten minutes. Without the secret this does nothing.
 */
import type { Env } from '../env';

const REPO = 'jwoodtechnologies/Vineyard-transparency-portal';

export async function dispatchCivicClerk(env: Env & { GITHUB_DISPATCH_TOKEN?: string }): Promise<string> {
  if (!env.GITHUB_DISPATCH_TOKEN) return 'no token';
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/ingest.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'VineyardTransparencyPortal-Worker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { command: 'run', source: 'vineyard-civicclerk-meetings', since, limit: '200', hours: '0.25', ocr: true } }),
  });
  if (res.status !== 204) throw new Error(`GitHub dispatch HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return 'dispatched';
}
