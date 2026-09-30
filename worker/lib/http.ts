/** JSON responses, error envelope, caching and security headers shared by every API route. */

export type ErrorKind =
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'ai_unavailable'
  | 'search_unavailable'
  | 'backend_unavailable'
  | 'method_not_allowed'
  | 'unauthorized'
  | 'quota_exhausted'
  | 'server';

export const CACHE = {
  none: 'no-store',
  list: 'public, max-age=60, stale-while-revalidate=300',
  detail: 'public, max-age=300, stale-while-revalidate=3600',
  stats: 'public, max-age=300',
  immutable: 'public, max-age=31536000, immutable',
  file: 'public, max-age=3600',
} as const;

export const API_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly kind: ErrorKind,
    message: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

export function json(body: unknown, init: { status?: number; cache?: string; headers?: Record<string, string> } = {}): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': init.cache ?? CACHE.none,
    ...API_SECURITY_HEADERS,
    ...(init.headers ?? {}),
  });
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export function errorResponse(err: HttpError): Response {
  const headers: Record<string, string> = {};
  if (err.retryAfterSeconds != null) headers['retry-after'] = String(err.retryAfterSeconds);
  return json(
    { error: { kind: err.kind, message: err.message, ...(err.retryAfterSeconds != null ? { retryAfterSeconds: err.retryAfterSeconds } : {}) } },
    { status: err.status, headers },
  );
}

export const notFound = (what = 'That record is not in the archive.') => new HttpError(404, 'not_found', what);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);

/** Weak ETag over a JSON body; lets browsers and the edge revalidate detail responses cheaply. */
export async function jsonWithEtag(request: Request, body: unknown, cache: string): Promise<Response> {
  const text = JSON.stringify(body);
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  const etag = `W/"${[...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
  const baseHeaders = { 'cache-control': cache, etag, ...API_SECURITY_HEADERS };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: baseHeaders });
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...baseHeaders } });
}

export async function readJson<T>(request: Request, maxBytes: number): Promise<T> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new HttpError(413, 'bad_request', 'Request body too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'bad_request', 'Request body too large.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest('Request body must be valid JSON.');
  }
}
