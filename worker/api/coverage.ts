/** GET /api/coverage/summary?year=2026 : the year's number-sequence gaps and held meetings missing documents (public, edge cached). */
import type { Env } from '../env';
import { badRequest, json } from '../lib/http';
import { coverage, publicSummary, utahToday } from '../lib/coverage';

export async function coverageSummary(env: Env, url: URL): Promise<Response> {
  const y = url.searchParams.get('year') ?? utahToday().slice(0, 4);
  if (!/^\d{4}$/.test(y)) throw badRequest('Invalid year.');
  // Read from the stored daily report; it is computed here only when none is stored yet.
  const report = await coverage(env, 2 * 86_400_000);
  return json(publicSummary(report, Number(y)), { cache: 'public, max-age=900' });
}
