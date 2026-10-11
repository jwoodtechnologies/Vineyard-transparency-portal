/**
 * Cache keys and cache headers, so nothing outlives a deploy or an ingest. Pure, unit-tested.
 *
 * - API copies at the edge are keyed to the URL (without the client's `_` marker), the deployed build
 *   (the Worker version id, env.CF_VERSION_METADATA) and the archive's data version (worker/lib/dataVersion.ts).
 *   A deploy or an ingest therefore starts new keys; a copy computed by older code is never served as current.
 * - HTML (index.html, /, every client route) and /theme-init.js are revalidated on every load: no-cache,
 *   max-age=0, must-revalidate. Hashed files under /assets/ never change: public, max-age=31536000, immutable.
 *   public/_headers sets the same for the asset store; assetHeaders applies it when the Worker serves an asset.
 */
/** The deployed build: the Worker version id, or "dev" where there is no version binding (local, tests). */
export function buildId(env: { CF_VERSION_METADATA?: { id?: string } }): string {
  const id = env.CF_VERSION_METADATA?.id;
  return id ? String(id) : 'dev';
}

/** The edge cache key for an API URL: no `_` marker, sorted parameters, the build and the data version. */
export function cacheKey(url: URL, build: string, version: string): Request {
  const u = new URL(url.toString());
  u.searchParams.delete('_');
  u.searchParams.delete('__b');
  u.searchParams.delete('__v');
  u.searchParams.sort();
  u.searchParams.set('__b', build);
  u.searchParams.set('__v', version);
  return new Request(u.toString(), { method: 'GET' });
}

export const HTML_CACHE = 'no-cache, max-age=0, must-revalidate';
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/** The Cache-Control a static response should carry, or null to leave it as served. */
export function assetCacheControl(pathname: string, contentType: string | null): string | null {
  if (pathname.startsWith('/assets/')) return IMMUTABLE_CACHE;
  if (pathname === '/theme-init.js' || /^text\/html\b/i.test(contentType ?? '')) return HTML_CACHE;
  return null;
}

/** A static asset response with its cache header set (HTML and theme-init.js never kept past a deploy). */
export function assetHeaders(url: URL, res: Response): Response {
  const cc = res.status === 200 || res.status === 304 ? assetCacheControl(url.pathname, res.headers.get('content-type')) : null;
  if (!cc || res.headers.get('cache-control') === cc) return res;
  const out = new Response(res.body, res);
  out.headers.set('cache-control', cc);
  return out;
}
