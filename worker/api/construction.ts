/**
 * GET /api/construction : the city's Construction Projects page as last stored by the five-minute
 * check (worker/sync/city.ts). Everything shown comes from that stored copy: the "at a glance"
 * table, the page text and the documents it links, with the retrieval time as "as of".
 */
import type { Env } from '../env';
import { json } from '../lib/http';
import { latestSnapshot, recentSnapshots, snapshotHtml, WATCHED_PAGES } from '../sync/city';
import { extractHtml } from '../sync/extract';
import { categorize } from '../sync/urls';
import { findGlance, type GlanceTable } from '../lib/glance';

export { findGlance, type GlanceTable };
type Table = Parameters<typeof findGlance>[0][number];

interface Parsed {
  retrievedAt: string;
  url: string;
  heading: string | null;
  glance: GlanceTable | null;
  text: string;
  documents: Array<{ url: string; label: string; group: string | null }>;
}

/** A stored version, parsed with the current parser when its HTML was kept (so parser fixes apply to old copies). */
function parseSnapshot(row: Record<string, unknown>): Parsed {
  const url = String(row.url ?? '');
  if (typeof row.html === 'string' && row.html) {
    const page = extractHtml(row.html, url);
    return {
      retrievedAt: String(row.retrieved_at),
      url,
      heading: page.heading,
      glance: findGlance(page.tables),
      text: page.text,
      documents: page.links.filter((l) => categorize(l.url).category === 'document').map((l) => ({ url: l.url, label: l.text || decodeURIComponent(l.url.split('?')[0].split('/').pop() ?? ''), group: l.group ?? null })),
    };
  }
  const tables = JSON.parse(String(row.tables_json ?? '[]')) as Table[];
  const links = JSON.parse(String(row.links_json ?? '[]')) as Array<{ url: string; text: string; group?: string | null }>;
  return {
    retrievedAt: String(row.retrieved_at),
    url,
    heading: (row.heading as string | null) ?? null,
    glance: findGlance(tables),
    text: String(row.text ?? ''),
    documents: links.filter((l) => categorize(l.url).category === 'document').map((l) => ({ url: l.url, label: l.text || decodeURIComponent(l.url.split('?')[0].split('/').pop() ?? ''), group: l.group ?? null })),
  };
}

const good = (p: Parsed) => Boolean(p.glance?.rows.length) || p.documents.length > 0;

/** The newest stored copy that parses into a table or documents; an unreadable copy never replaces a good one. */
export async function bestConstruction(env: Env): Promise<Parsed | null> {
  const rows = await recentSnapshots(env, 'construction', 12);
  return rows.map(parseSnapshot).find(good) ?? null;
}

export async function getConstruction(env: Env): Promise<Response> {
  const page = WATCHED_PAGES.find((p) => p.id === 'construction')!;
  const [best, snap] = await Promise.all([bestConstruction(env), latestSnapshot(env, 'construction')]);
  if (!best) {
    return json({ available: false, sourceUrl: page.url, lastCheckedAt: snap.lastCheckedAt }, { cache: 'public, max-age=60' });
  }
  return json(
    {
      available: true,
      sourceUrl: best.url || page.url,
      asOf: best.retrievedAt,
      lastCheckedAt: snap.lastCheckedAt,
      heading: best.heading,
      glance: best.glance,
      text: best.text,
      documents: best.documents,
      versions: snap.versions,
    },
    { cache: 'public, max-age=120' },
  );
}

export async function getPageSource(env: Env, pageId: string): Promise<Response> {
  if (!WATCHED_PAGES.some((p) => p.id === pageId)) return json({ error: { kind: 'not_found', message: 'Unknown page.' } }, { status: 404 });
  const snap = await snapshotHtml(env, pageId);
  if (!snap) return json({ error: { kind: 'not_found', message: 'No stored copy yet.' } }, { status: 404 });
  return new Response(snap.html, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=60', 'x-source-url': snap.url, 'x-retrieved-at': snap.retrievedAt },
  });
}
