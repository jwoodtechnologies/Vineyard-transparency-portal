/**
 * Vineyard Transparency Portal — Cloudflare Worker gateway.
 *
 * Serves the SPA from static assets and exposes a thin /api gateway:
 *  - /api/health is always answered here so the frontend can tell "backend not connected"
 *    apart from "network down".
 *  - Every other /api/* request is proxied to API_ORIGIN (the Phase 2 backend) when configured.
 *  - Without API_ORIGIN, /api/* returns a structured 503 the frontend renders as
 *    "backend offline" instead of a broken page.
 *
 * The Worker holds no secrets that reach the browser and does not log request bodies
 * (questions are not profiled server-side).
 */

export interface Env {
  ASSETS: Fetcher;
  API_ORIGIN?: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function apiOrigin(env: Env): URL | null {
  if (!env.API_ORIGIN) return null;
  try {
    const url = new URL(env.API_ORIGIN);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url : null;
  } catch {
    return null;
  }
}

async function proxy(request: Request, origin: URL): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);
  const headers = new Headers(request.headers);
  // Never forward cookies or client auth to the backend; the portal has no accounts.
  headers.delete('cookie');
  headers.delete('authorization');
  const init: RequestInit = {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  };
  try {
    const upstream = await fetch(target, init);
    const response = new Response(upstream.body, upstream);
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.delete('set-cookie');
    return response;
  } catch {
    return json(
      { error: { kind: 'backend_unavailable', message: 'The archive backend could not be reached.' } },
      502,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const origin = apiOrigin(env);

      if (url.pathname === '/api/health' && !origin) {
        return json({
          status: 'backend_not_connected',
          gateway: 'cloudflare-worker',
          checkedAt: new Date().toISOString(),
        });
      }

      if (!origin) {
        return json(
          {
            error: {
              kind: 'backend_unavailable',
              message: 'The archive backend is not connected to this deployment yet.',
            },
          },
          503,
        );
      }

      if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(request.method)) {
        return json({ error: { kind: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
      }

      return proxy(request, origin);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
