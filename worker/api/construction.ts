/**
 * GET /api/construction : the city's Construction Projects page as last stored by the five-minute
 * check (worker/sync/city.ts). Everything shown comes from that stored copy: the "at a glance"
 * table, the page text and the documents it links, with the retrieval time as "as of".
 */
import type { Env } from '../env';
import { json } from '../lib/http';
import { latestSnapshot, WATCHED_PAGES } from '../sync/city';
import { categorize } from '../sync/urls';
import { findGlance, type GlanceTable } from '../lib/glance';

export { findGlance, type GlanceTable };
type Table = Parameters<typeof findGlance>[0][number];

export async function getConstruction(env: Env): Promise<Response> {
  const page = WATCHED_PAGES.find((p) => p.id === 'construction')!;
  const snap = await latestSnapshot(env, 'construction');
  if (!snap.current) {
    return json({ available: false, sourceUrl: page.url, lastCheckedAt: snap.lastCheckedAt }, { cache: 'public, max-age=60' });
  }
  const tables = JSON.parse(String(snap.current.tables_json ?? '[]')) as Table[];
  const links = JSON.parse(String(snap.current.links_json ?? '[]')) as Array<{ url: string; text: string }>;
  return json(
    {
      available: true,
      sourceUrl: String(snap.current.url ?? page.url),
      asOf: String(snap.current.retrieved_at),
      lastCheckedAt: snap.lastCheckedAt,
      heading: snap.current.heading ?? null,
      glance: findGlance(tables),
      text: String(snap.current.text ?? ''),
      documents: links.filter((l) => categorize(l.url).category === 'document').map((l) => ({ url: l.url, label: l.text || decodeURIComponent(l.url.split('/').pop() ?? '') })),
      versions: snap.versions,
    },
    { cache: 'public, max-age=120' },
  );
}
