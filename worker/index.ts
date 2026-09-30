/**
 * Vineyard Transparency Portal: Cloudflare Worker.
 *
 * One application on one origin:
 *   /api/*        → this Worker (D1 catalog + FTS5 search shards, R2 archive, Workers AI)
 *   everything    → static SPA assets (dist/), with SPA fallback for client routes
 *
 * The API holds no user accounts, sets no cookies and never logs questions or search text.
 */
import type { Env } from './env';
import { HttpError, errorResponse, json, notFound } from './lib/http';
import { isSafeId } from './lib/util';
import { getDocumentDetail, getDocumentFile, getDocumentText, getRelated, listDocuments } from './api/documents';
import { filtersFromUrl, handleSearch } from './api/search';
import { browseFacets, getMeeting, handleHealth, handleStats, listBodies, listCategories, listMeetings, listSources, notImplementedYet, submitReport, suggestions } from './api/misc';
import { handleAsk } from './ai/rag';
import { handleAdmin } from './admin/routes';

function id(segment: string | undefined): string {
  const value = decodeURIComponent(segment ?? '');
  if (!isSafeId(value)) throw notFound();
  return value;
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path.startsWith('/api/admin/')) return handleAdmin(env, request, url);

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, POST, OPTIONS' } });
  if (!['GET', 'HEAD', 'POST'].includes(method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

  const parts = path.split('/').slice(2); // after /api
  const [a, b, c] = parts;

  if (method === 'POST') {
    if (a === 'ask' && parts.length === 1) return handleAsk(env, request);
    if (a === 'reports' && parts.length === 1) return submitReport(env, request);
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  }

  switch (a) {
    case 'health':
      return handleHealth(env);
    case 'stats':
      return handleStats(env);
    case 'search':
      return handleSearch(env, url);
    case 'documents':
      if (!b) return listDocuments(env, url, filtersFromUrl(url));
      if (!c) return getDocumentDetail(env, request, id(b));
      if (c === 'file') return getDocumentFile(env, request, id(b), url);
      if (c === 'text') return getDocumentText(env, request, id(b));
      if (c === 'related') return getRelated(env, request, id(b));
      break;
    case 'meetings':
      return b ? getMeeting(env, request, id(b)) : listMeetings(env, url);
    case 'sources':
      return listSources(env, request, b ? id(b) : undefined);
    case 'bodies':
      return listBodies(env, request, b ? id(b) : undefined);
    case 'categories':
      return listCategories(env, request);
    case 'browse':
      if (b === 'facets') return browseFacets(env);
      break;
    case 'suggestions':
      return suggestions(env);
    case 'topics':
      return notImplementedYet(b ? 'topic' : 'topics');
    case 'code':
      return notImplementedYet('code');
  }
  throw notFound('Unknown API route.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Canonical host: www → apex, permanent. (HTTP → HTTPS is enforced at the zone.)
    if (url.hostname === 'www.vineyardportal.org') {
      url.hostname = 'vineyardportal.org';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e);
      console.error(JSON.stringify({ event: 'api_error', path: url.pathname, message: e instanceof Error ? e.message : String(e) }));
      return json({ error: { kind: 'server', message: 'Something went wrong while reading the archive.' } }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
