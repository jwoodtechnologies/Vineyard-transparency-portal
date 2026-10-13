/**
 * Site content staff have changed (worker/lib/siteContent.ts), for the public pages to use in place of their built-in wording.
 *
 *   GET /api/content   { content: { projects?: ... }, changedAt }
 *
 * Small, and cached at the edge with the other public lists; it refreshes the moment staff publish a change.
 */
import type { Env } from '../env';
import { json } from '../lib/http';
import { allContent } from '../lib/siteContent';

export async function publicContent(env: Env): Promise<Response> {
  try {
    return json(await allContent(env), { cache: 'public, max-age=60' });
  } catch {
    // The database could not be read: pages fall back to their built-in wording, and this answer is not kept by any cache.
    return json({ content: {}, changedAt: null }, { cache: 'no-store' });
  }
}
