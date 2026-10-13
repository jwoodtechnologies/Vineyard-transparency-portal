/**
 * Vineyard Transparency Portal: Cloudflare Worker.
 *
 * One application on one origin:
 *   /api/*        → this Worker (D1 catalog + FTS5 search shards, R2 archive, Workers AI)
 *   everything    → static SPA assets (dist/), with SPA fallback for client routes
 *
 * No public accounts. Visits and questions are logged for the owner's private activity panel
 * (see worker/panel). A five-minute Cron Trigger (worker/cron.ts) keeps meetings, city pages, notices
 * and newly posted files current.
 */
import type { Env } from './env';
import { API_SECURITY_HEADERS, HttpError, errorResponse, json, notFound } from './lib/http';
import { isSafeId } from './lib/util';
import { getDocumentDetail, getDocumentFile, getDocumentText, getRelated, listDocuments } from './api/documents';
import { getTrail } from './api/trail';
import { filtersFromUrl, handleSearch } from './api/search';
import { browseFacets, getMeeting, handleHealth, handleHealthJobs, handleStats, listBodies, listCategories, listMeetings, listSources, notImplementedYet, submitReport, suggestions } from './api/misc';
import { handleAsk } from './ai/rag';
import { spenderEnv } from './ai/meter';
import { listEvents } from './api/events';
import { getMapLayer, getParcelAt, getParcelLines, getParcelOutlines, listMapLayers } from './api/map';
import { getElevation } from './lib/elevation';
import { getLatest } from './api/latest';
import { getBudget, getBudgetArchive } from './api/budget';
import { getDraftMinutes } from './api/draftMinutes';
import { getPerson, getPersonPhoto, listPeople } from './api/people';
import { handleVotes } from './api/votes';
import { listBoards } from './api/boards';
import { getConstruction, getPageSource } from './api/construction';
import { getProjectDetail } from './api/projects';
import { handlePages } from './api/pages';
import { bumpDataVersion, dataVersion } from './lib/dataVersion';
import { ensureBudgetBook } from './lib/budgetStore';
import { runFrequent, runHourly } from './cron';
import { handleAdmin } from './admin/routes';
import { PANEL_PREFIX, handleFeedback, handlePanel, handleVisit } from './panel/routes';
import { logQuestion, who } from './panel/store';
import { handleStaff } from './staff/routes';
import { addFile, addForm, addStatus, reportSubmission } from './contrib/resident';
import { coverageSummary } from './api/coverage';
import { publicUpdates } from './contrib/updates';
import { publicNotices } from './api/notices';
import { publicContent } from './api/content';
import { handleFeed } from './api/feeds';
import { isIndexKind, recordIndex, recordTopics } from './api/records';
import { assetHeaders, buildId, cacheKey } from './lib/edgeCache';

function id(segment: string | undefined): string {
  const value = decodeURIComponent(segment ?? '');
  if (!isSafeId(value)) throw notFound();
  return value;
}

/** A write by the ingest job (admin routes) or the owner's panel changes the data version, so cached pages refresh. */
function changed(env: Env, ctx: ExecutionContext, method: string, res: Response): Response {
  if (method !== 'GET' && method !== 'HEAD' && res.status >= 200 && res.status < 300) ctx.waitUntil(bumpDataVersion(env).catch(() => undefined));
  return res;
}

async function route(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  // The budget readers see is the saved version staff last published (or the built-in one); a read of the database happens only when the data version moved.
  await ensureBudgetBook(env);

  if (path.startsWith('/api/admin/')) return changed(env, ctx, method, await handleAdmin(env, request, url));
  // The staff portal publishes its own changes (see worker/staff/core.ts `published`), so signing in never refreshes the public caches.
  if (path === '/api/staff' || path.startsWith('/api/staff/')) return handleStaff(env, request, url, ctx);
  if (path === PANEL_PREFIX || path.startsWith(`${PANEL_PREFIX}/`)) return changed(env, ctx, method, await handlePanel(env, request, url));

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, POST, OPTIONS' } });
  if (!['GET', 'HEAD', 'POST'].includes(method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

  const parts = path.split('/').slice(2); // after /api
  const [a, b, c] = parts;

  if (method === 'POST') {
    if (a === 'ask' && parts.length === 1) {
      const w = who(request);
      // Spender hook (worker/ai/meter.ts): the chat suite's x-vtp-suite header bills its own Neuron bucket.
      return handleAsk(await spenderEnv(env, request), request, ctx, (r, ms) =>
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
    if (a === 'add' && parts.length === 1) return addForm(env, request);
    if (a === 'add' && b === 'file' && parts.length === 2) return addFile(env, request);
    if (a === 'add' && b === 'report' && parts.length === 2) return reportSubmission(env, request);
    throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  }

  switch (a) {
    case 'add':
      if (b === 'status' && parts.length === 2) return addStatus(env);
      break;
    case 'health':
      if (b === 'jobs' && !c) return handleHealthJobs(env);
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
      if (c === 'trail') return getTrail(env, request, id(b));
      break;
    case 'events':
      if (!b) return listEvents(env, url);
      break;
    case 'notices':
      if (!b) return publicNotices(env);
      break;
    case 'content':
      if (!b) return publicContent(env);
      break;
    case 'latest':
      if (!b) return getLatest(env);
      break;
    case 'draft-minutes':
      if (!b) return getDraftMinutes(env, url);
      break;
    case 'budget':
      if (!b) return getBudget(env);
      if (b === 'archive' && parts.length === 2) return getBudgetArchive(env);
      break;
    case 'people':
      if (!b) return listPeople(env);
      if (/^[a-z0-9-]{2,80}$/.test(b) && !c) return getPerson(env, b);
      if (/^[a-z0-9-]{2,80}$/.test(b) && c === 'photo') return getPersonPhoto(env, b);
      break;
    case 'boards':
      if (!b) return listBoards(env);
      break;
    case 'construction':
      if (!b) return getConstruction(env);
      break;
    case 'coverage':
      if (b === 'summary' && !c) return coverageSummary(env, url);
      break;
    case 'projects':
      if (b === 'detail' && !c) return getProjectDetail(env, url);
      break;
    case 'pages':
      // One response per heavy page (worker/api/pages.ts).
      if ((b === 'votes' || b === 'planning' || b === 'construction') && parts.length === 2) return handlePages(env, url, b, ctx);
      // The stored copy of a watched city page, exactly as read (text/plain, never rendered).
      if (b && /^[a-z]{2,20}$/.test(b) && c === 'source' && parts.length === 3) return getPageSource(env, b);
      break;
    case 'votes':
      if (!b || ((b === 'members' || b === 'years' || b === 'attendance' || b === 'meetings') && !c)) return handleVotes(env, url, b);
      break;
    case 'map':
      if (b === 'layers' && !c) return listMapLayers(env);
      if (b === 'layers' && c && /^[a-z]{2,20}$/.test(c) && parts.length === 3) return getMapLayer(env, c, url);
      if (b === 'parcels' && parts.length === 5) return getParcelOutlines(parts[2], parts[3], parts[4]);
      if (b === 'parcel' && parts.length === 2) return getParcelAt(url);
      if (b === 'parcel-lines' && parts.length === 2) return getParcelLines(env, request, url);
      if (b === 'elevation' && parts.length === 2) return getElevation(url);
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
    case 'records':
      if (b === 'topics' && !c) return recordTopics(env);
      if (isIndexKind(b) && !c) return recordIndex(env, b, url);
      break;
    case 'updates':
      // Staff updates, newest first (not edge cached, so a new one shows at once).
      if (!b) return publicUpdates(env, url);
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
 * Public, read-only API responses are cached at Cloudflare's edge (free Cache API). The key is the URL
 * without the client's five-minute marker (`_`), plus the deployed build (the Worker version id) and the
 * archive's data version (worker/lib/edgeCache.ts, worker/lib/dataVersion.ts), so a stored copy stays good
 * until the code or the data behind it changes. When the data version moves on (or a copy is older than its
 * route allows), the older copy of the same build is served at once and the new one is computed in the
 * background (stale-while-revalidate). A copy from an earlier build is never served: the first request
 * after a deploy computes its answer. Edge hits read
 * nothing from D1. Nothing personal is ever cached: there are no cookies, and POST /api/ask, admin, panel,
 * health (except the job list, /api/health/jobs) and file streams are excluded.
 */
const EDGE_CACHEABLE =
  /^\/api\/(search|events|notices|content|latest|draft-minutes|budget(\/archive)?|people(\/[a-z0-9-]+)?|votes(\/members|\/years|\/attendance|\/meetings)?|boards|construction|pages\/(votes|planning|construction)|projects\/detail|map\/layers(\/[a-z]+)?|map\/parcels\/16\/\d+\/\d+\.json|map\/parcel|meetings|documents\/[^/]+(\/text|\/related|\/trail)?|documents|bodies|sources|categories|browse\/facets|records\/(?:topics|ordinances|resolutions|rda-resolutions)|suggestions|stats|coverage\/summary|health\/jobs)$/;
/** Lists that depend on today's date (upcoming meetings, "today") are recomputed after five minutes; everything else after an hour, or as soon as the data version changes. */
const TIME_BOUND = /^\/api\/(events|notices|latest|meetings|stats|health\/jobs)/;
const STORE_SECONDS = 7 * 86400;
const refreshing = new Map<string, Promise<void>>();

/** The copy handed to the reader: a short browser cache time, the standing headers back, 304 on a matching ETag. */
function serveStored(request: Request, hit: Response, stale: boolean): Response {
  const headers = new Headers(hit.headers);
  // A phone never keeps showing a list or count that has since changed for more than a minute.
  headers.set('cache-control', 'public, max-age=60');
  headers.delete('cf-cache-status');
  headers.delete('expires');
  headers.delete('x-stored-at');
  headers.set('x-edge-cache', stale ? 'stale' : 'hit');
  // The edge cache drops Strict-Transport-Security from stored copies: put the standing headers back.
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  const etag = headers.get('etag');
  if (etag && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(hit.body, { status: hit.status, headers });
}

async function cached(request: Request, env: Env, url: URL, ctx: ExecutionContext, compute: () => Promise<Response>): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  if (request.method !== 'GET' || !EDGE_CACHEABLE.test(path) || request.headers.has('range')) return compute();
  const cache = (caches as unknown as { default: Cache }).default;
  const version = String(await dataVersion(env).catch(() => 0));
  const build = buildId(env);
  const key = cacheKey(url, build, version);
  // The newest copy for this build (served while a newer data version is computed); never another build's.
  const latestKey = cacheKey(url, build, 'latest');
  const freshFor = (TIME_BOUND.test(path) ? 300 : 3600) * 1000;
  const store = (res: Response) => {
    const cc = res.headers.get('cache-control') ?? '';
    // A record taken out of the archive (or never there): forget the copies, so the old page is not served stale for days.
    if (res.status === 404 || res.status === 410) return Promise.all([cache.delete(key), cache.delete(latestKey)]).then(
      () => undefined,
      () => undefined,
    );
    if (res.status !== 200 || !/max-age=\d*[1-9]/.test(cc) || /no-store|private/.test(cc)) return null;
    const copy = new Response(res.clone().body, res);
    copy.headers.set('cache-control', `public, max-age=${STORE_SECONDS}`);
    copy.headers.set('x-stored-at', String(Date.now()));
    copy.headers.set('x-data-version', version);
    copy.headers.set('x-build', build);
    const twin = copy.clone();
    return Promise.all([cache.put(key, copy), cache.put(latestKey, twin)]).then(
      () => undefined,
      () => undefined,
    );
  };
  const hit = await cache.match(key).catch(() => undefined);
  const age = (r: Response) => Date.now() - Number(r.headers.get('x-stored-at') ?? 0);
  if (hit && age(hit) < freshFor) return serveStored(request, hit, false);
  const old = hit ?? (await cache.match(latestKey).catch(() => undefined));
  if (old) {
    // Stale: serve it now, refresh once per location in the background.
    const k = key.url;
    if (!refreshing.has(k)) {
      const p = compute()
        .then((res) => store(res) ?? undefined)
        .catch(() => undefined)
        .finally(() => refreshing.delete(k));
      refreshing.set(k, p);
      ctx.waitUntil(p);
    }
    return serveStored(request, old, true);
  }
  const res = await compute();
  const put = store(res);
  if (put) ctx.waitUntil(put);
  return res;
}

/** Static files served through the Worker carry the same cache headers as public/_headers (worker/lib/edgeCache.ts). */
async function asset(request: Request, env: Env, url: URL): Promise<Response> {
  return assetHeaders(url, await env.ASSETS.fetch(request));
}

/** Every API response carries the standing security headers, including streamed ones that are built outside json(). */
function hardened(res: Response): Response {
  if (res.headers.has('strict-transport-security')) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
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

    // RSS feeds (no accounts): /feeds/records.xml and /feeds/meetings.xml, edge cached 15 minutes.
    if (url.pathname.startsWith('/feeds/')) {
      try {
        return await handleFeed(request, env, url, ctx);
      } catch (e) {
        if (e instanceof HttpError) return errorResponse(e);
        console.error(JSON.stringify({ event: 'feed_error', path: url.pathname, message: e instanceof Error ? e.message : String(e) }));
        return new Response('Feed unavailable.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
      }
    }
    if (!url.pathname.startsWith('/api/')) return asset(request, env, url);

    try {
      const res = hardened(await cached(request, env, url, ctx, () => route(request, env, url, ctx)));
      // Which build answered (the client discards its kept copies when its own build changes: src/console/api.ts).
      if (!res.headers.has('x-build') && res.status !== 101) {
        try {
          res.headers.set('x-build', buildId(env));
        } catch {
          /* immutable headers (a passed-through fetch): left as is */
        }
      }
      return res;
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e);
      console.error(JSON.stringify({ event: 'api_error', path: url.pathname, message: e instanceof Error ? e.message : String(e) }));
      // The ingest job's own calls (token-gated) get the reason; the public never does.
      const detail = url.pathname.startsWith('/api/admin/') ? { detail: (e instanceof Error ? e.message : String(e)).slice(0, 300) } : {};
      return json({ error: { kind: 'server', message: 'Something went wrong while reading the archive.', ...detail } }, { status: 500 });
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Every five minutes the agenda portal is checked; once an hour the full check (news too) runs and is logged.
    const hourly = new Date(controller.scheduledTime).getUTCMinutes() < 5;
    ctx.waitUntil(
      (hourly ? runHourly(env, controller.scheduledTime) : runFrequent(env, controller.scheduledTime)).then(
        (summary) => console.log(hourly ? 'hourly' : 'five-minute', JSON.stringify(summary)),
        (e) => console.error('scheduled check failed', String(e)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
