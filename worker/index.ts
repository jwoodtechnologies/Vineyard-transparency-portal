/**
 * Vineyard Transparency Portal: Cloudflare Worker.
 *
 * One application on one origin:
 *   /api/*        → this Worker (D1 catalog + FTS5 search shards, R2 archive, Workers AI)
 *   everything    → static SPA assets (dist/), with SPA fallback for client routes
 *
 * No public accounts. Visits and questions are logged for the owner's private activity panel
 * (see worker/panel). An hourly Cron Trigger (worker/cron.ts) keeps meetings and news current.
 */
import type { Env } from './env';
import { HttpError, errorResponse, json, notFound } from './lib/http';
import { isSafeId } from './lib/util';
import { getDocumentDetail, getDocumentFile, getDocumentText, getRelated, listDocuments } from './api/documents';
import { filtersFromUrl, handleSearch } from './api/search';
import { browseFacets, getMeeting, handleHealth, handleStats, listBodies, listCategories, listMeetings, listSources, notImplementedYet, submitReport, suggestions } from './api/misc';
import { handleAsk } from './ai/rag';
import { listEvents } from './api/events';
import { getMapLayer, listMapLayers } from './api/map';
import { getLatest } from './api/latest';
import { getPerson, getPersonPhoto, listPeople } from './api/people';
import { handleVotes } from './api/votes';
import { listBoards } from './api/boards';
import { runFrequent, runHourly } from './cron';
import { handleAdmin } from './admin/routes';
import { PANEL_PREFIX, handleFeedback, handlePanel, handleVisit } from './panel/routes';
import { logQuestion, who } from './panel/store';

function id(segment: string | undefined): string {
  const value = decodeURIComponent(segment ?? '');
  if (!isSafeId(value)) throw notFound();
  return value;
}

async function route(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  if (path.startsWith('/api/admin/')) return handleAdmin(env, request, url);
  if (path === PANEL_PREFIX || path.startsWith(`${PANEL_PREFIX}/`)) return handlePanel(env, request, url);

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, POST, OPTIONS' } });
  if (!['GET', 'HEAD', 'POST'].includes(method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

  const parts = path.split('/').slice(2); // after /api
  const [a, b, c] = parts;

  if (method === 'POST') {
    if (a === 'ask' && parts.length === 1) {
      const w = who(request);
      return handleAsk(env, request, ctx, (r, ms) =>
        ctx.waitUntil(
          logQuestion(env, w, {
            askId: r.id,
            question: r.question,
            status: r.retrievalStatus,
            mode: (r as { mode?: string }).mode ?? null,
            engine: r.engine,
            citations: r.citations.length,
            latencyMs: ms,
            answer: r.answer,
          }),
        ),
      );
    }
    if (a === 'visit' && parts.length === 1) return handleVisit(env, request, ctx);
    if (a === 'feedback' && parts.length === 1) return handleFeedback(env, request, ctx);
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
    case 'events':
      if (!b) return listEvents(env, url);
      break;
    case 'latest':
      if (!b) return getLatest(env);
      break;
    case 'people':
      if (!b) return listPeople(env);
      if (/^[a-z0-9-]{2,80}$/.test(b) && !c) return getPerson(env, b);
      if (/^[a-z0-9-]{2,80}$/.test(b) && c === 'photo') return getPersonPhoto(env, b);
      break;
    case 'boards':
      if (!b) return listBoards(env);
      break;
    case 'votes':
      if (!b || ((b === 'members' || b === 'years' || b === 'attendance' || b === 'meetings') && !c)) return handleVotes(env, url, b);
      break;
    case 'map':
      if (b === 'layers' && !c) return listMapLayers();
      if (b === 'layers' && c && /^[a-z]{2,20}$/.test(c) && parts.length === 3) return getMapLayer(env, c, url);
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

/**
 * Public, read-only API responses are cached at Cloudflare's edge (free Cache API), keyed by the
 * full URL, for as long as each route's own Cache-Control allows. Repeat views of the same meeting
 * list, record or search skip D1 entirely. Nothing personal is ever cached: there are no cookies,
 * and POST /api/ask, admin, health and file streams are excluded.
 */
const EDGE_CACHEABLE = /^\/api\/(search|events|latest|people(\/[a-z0-9-]+)?|votes(\/members|\/years|\/attendance|\/meetings)?|boards|map\/layers(\/[a-z]+)?|meetings|documents\/[^/]+(\/text|\/related)?|documents|bodies|sources|categories|browse\/facets|suggestions|stats)$/;

async function cached(request: Request, url: URL, ctx: ExecutionContext, compute: () => Promise<Response>): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  if (request.method !== 'GET' || !EDGE_CACHEABLE.test(path) || request.headers.has('range')) return compute();
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(url.toString(), { method: 'GET' });
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) {
    const etag = hit.headers.get('etag');
    if (etag && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: hit.headers });
    return hit;
  }
  const res = await compute();
  const cc = res.headers.get('cache-control') ?? '';
  if (res.status === 200 && /max-age=\d*[1-9]/.test(cc) && !/no-store|private/.test(cc)) ctx.waitUntil(cache.put(key, res.clone()).catch(() => undefined));
  return res;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Canonical host: www → apex, permanent. (HTTP → HTTPS is enforced at the zone.)
    if (url.hostname === 'www.vineyardportal.org') {
      url.hostname = 'vineyardportal.org';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      return await cached(request, url, ctx, () => route(request, env, url, ctx));
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e);
      console.error(JSON.stringify({ event: 'api_error', path: url.pathname, message: e instanceof Error ? e.message : String(e) }));
      return json({ error: { kind: 'server', message: 'Something went wrong while reading the archive.' } }, { status: 500 });
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Every five minutes the agenda portal is checked; once an hour the full check (news too) runs and is logged.
    const hourly = new Date(controller.scheduledTime).getUTCMinutes() < 5;
    ctx.waitUntil(
      (hourly ? runHourly(env) : runFrequent(env)).then(
        (summary) => console.log(hourly ? 'hourly' : 'five-minute', JSON.stringify(summary)),
        (e) => console.error('scheduled check failed', String(e)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
