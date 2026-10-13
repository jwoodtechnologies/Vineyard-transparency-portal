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
import { readContent } from '../lib/siteContent';
import { mergeConstruction, type ConstructionContent } from '../../src/lib/constructionRows';

export { findGlance, type GlanceTable };
type Table = Parameters<typeof findGlance>[0][number];

interface Parsed {
  retrievedAt: string;
  url: string;
  heading: string | null;
  glance: GlanceTable | null;
  text: string;
  documents: Array<{ url: string; label: string; group: string | null; documentId?: string }>;
}

/**
 * The archive's record for each linked city file, so the page opens it in the portal's own viewer. The city
 * adds a changing ?t= stamp to its file links, so the address is matched without its query.
 */
async function withRecordIds(env: Env, docs: Parsed['documents']): Promise<Parsed['documents']> {
  const found = await Promise.all(
    docs.slice(0, 80).map(async (d) => {
      const bare = d.url.replace(/[?#].*$/, '');
      if (!/^https:\/\//.test(bare)) return null;
      const row = await env.CATALOG_DB.prepare(
        `SELECT d.id FROM documents d WHERE d.original_url = ? OR d.original_url = ? OR d.original_url LIKE ?
         UNION SELECT ds.document_id FROM document_sources ds WHERE ds.source_url = ? OR ds.source_url LIKE ? LIMIT 1`,
      )
        .bind(d.url, bare, `${bare}?%`, d.url, `${bare}?%`)
        .first<{ id: string }>()
        .catch(() => null);
      return row?.id ?? null;
    }),
  );
  return docs.map((d, i) => (found[i] ? { ...d, documentId: found[i]! } : d));
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

/** What staff corrected or added under Construction now; nothing when it cannot be read, so the city page still shows. */
const staffWork = (env: Env): Promise<ConstructionContent | null> =>
  readContent(env, 'construction')
    .then((r) => (r?.value as ConstructionContent | undefined) ?? null)
    .catch(() => null);

export async function getConstruction(env: Env): Promise<Response> {
  const page = WATCHED_PAGES.find((p) => p.id === 'construction')!;
  const [best, snap, mine] = await Promise.all([bestConstruction(env), latestSnapshot(env, 'construction'), staffWork(env)]);
  const glance = mergeConstruction(best?.glance ?? null, mine);
  if (!best && glance?.rows.length) {
    // The city page has not been read yet, but staff have posted projects: those show on their own.
    return json({ available: true, sourceUrl: page.url, asOf: null, lastCheckedAt: snap.lastCheckedAt, heading: null, glance, city: null, text: '', documents: [], versions: snap.versions }, { cache: 'public, max-age=60' });
  }
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
      glance,
      // The city's own table before staff changes, for the staff screen.
      city: best.glance,
      text: best.text,
      documents: await withRecordIds(env, best.documents),
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
