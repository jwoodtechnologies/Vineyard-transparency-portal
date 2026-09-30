# Cloudflare Deployment

The portal is a static React SPA (Vite build in `dist/`) plus a thin Cloudflare Worker
(`worker/index.ts`) that answers `/api/*`. It deploys to Cloudflare's free tier. (Vercel is not used.)

## Option A (recommended): Workers with Static Assets

Configured in [`wrangler.jsonc`](../wrangler.jsonc):

| Setting | Value | Effect |
| --- | --- | --- |
| `main` | `worker/index.ts` | The API gateway Worker. |
| `assets.directory` | `./dist` | Output of `npm run build`. |
| `assets.binding` | `ASSETS` | Lets the Worker fall through to static assets. |
| `assets.not_found_handling` | `single-page-application` | Unknown paths (`/documents/doc_…`, `/search?q=…`) serve `index.html`, so client-side routes work on refresh and deep links. |
| `assets.run_worker_first` | `["/api/*"]` | Only `/api/*` executes Worker code; every other request is served straight from the asset store (fast, free, no Worker invocation). |
| `vars.API_ORIGIN` | `""` | Origin of the Phase 2 backend. Empty = backend not connected. |
| `observability.enabled` | `true` | Workers logs/metrics (the Worker does not log request bodies). |

Commands:

```bash
npm ci
npx wrangler login                 # once
npm run cf:dev                     # build + wrangler dev (local preview incl. the Worker)
npm run cf:deploy                  # build + wrangler deploy
```

`npm run build` runs `tsc -b && vite build`. Build-time frontend variables must be present when
building (see below). Vite emits source maps (`build.sourcemap: true`); they are public — disable them
in `vite.config.ts` if you prefer not to publish them.

### The /api gateway

`worker/index.ts` behaviour:

- `GET /api/health` without `API_ORIGIN` → `200 {"status":"backend_not_connected","gateway":"cloudflare-worker","checkedAt":…}`
  so the UI can show "backend not connected" instead of "offline".
- any other `/api/*` without `API_ORIGIN` → `503 {"error":{"kind":"backend_unavailable",…}}`.
- with `API_ORIGIN` (must be `https:` — `localhost` is also accepted for local development):
  requests are proxied path-and-query-preserving to the origin with `redirect: 'manual'`;
  `Cookie` and `Authorization` are stripped from requests and `Set-Cookie` from responses;
  `X-Content-Type-Options: nosniff` is added; origin unreachable → `502 backend_unavailable`.
- methods other than GET/HEAD/POST/OPTIONS → `405 method_not_allowed`.

Set the backend origin per environment (no secret — it is a public URL):

```jsonc
// wrangler.jsonc
"vars": { "API_ORIGIN": "https://api.example.org" }
```

or in the dashboard: *Workers & Pages → your worker → Settings → Variables*. Secrets used by the
backend (model API keys, storage credentials) belong to the backend's own environment (or
`wrangler secret put` if the backend is a Worker) — never to `VITE_*` variables, which are compiled
into public JavaScript.

## Option B: Cloudflare Pages (git integration)

1. *Workers & Pages → Create → Pages → Connect to Git*, select the repository.
2. Build settings: **Build command** `npm run build`, **Build output directory** `dist`,
   Node version ≥ 20 (set `NODE_VERSION=22` if needed).
3. Environment variables (Production and Preview): `VITE_DATA_MODE`, `VITE_API_BASE_URL`,
   optionally `VITE_API_TIMEOUT_MS`.
4. SPA routing: Pages serves `index.html` for unknown paths when the project has no `404.html`
   (the build does not produce one).
5. `/api`: Pages does not run `worker/index.ts`. Either set `VITE_API_BASE_URL` to the backend origin
   (the API must then send CORS headers for the portal origin, and the CSP `connect-src` must list that
   origin — see below), or port the gateway to a Pages Function (`functions/api/[[path]].ts` with the
   same logic).

## Frontend build-time variables

From [`.env.example`](../.env.example); read in `src/config/env.ts`:

| Variable | Values | Meaning |
| --- | --- | --- |
| `VITE_DATA_MODE` | `mock` (default) \| `api` | `mock`: built-in, clearly labeled demo records and the deterministic `demo-extractive` ask engine, no backend. `api`: use the REST contract in [API_CONTRACT.md](API_CONTRACT.md). |
| `VITE_API_BASE_URL` | empty or an origin | Empty = same-origin `/api` (the Worker gateway). |
| `VITE_API_TIMEOUT_MS` | integer, default `20000` | Client request timeout. |

Switching from demo to production is configuration only: build with `VITE_DATA_MODE=api`.

## Security headers (`public/_headers`)

`public/_headers` is copied into `dist/` and applied by Cloudflare to static assets (Workers Static
Assets and Pages both support it). It sets, for all paths:

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:;
  frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';
  upgrade-insecure-requests`
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`,
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
  `Permissions-Policy` disabling camera, microphone, geolocation, payment, USB, interest-cohort.

Notes:

- If `VITE_API_BASE_URL` points to another origin, add it to `connect-src` (and, if archived files
  are served from another origin, to the directives the PDF viewer needs), otherwise the browser
  blocks the requests.
- `_headers` does not apply to responses generated by Worker code (`/api/*`); the Worker/backend set
  their own headers (`no-store` for JSON gateway errors, `nosniff`).
- `public/robots.txt` allows the site and disallows `/api/`.

## Caching strategy

| Path | Policy | Why |
| --- | --- | --- |
| `/assets/*` | `public, max-age=31536000, immutable` | Vite fingerprints file names. |
| `/index.html` | `no-cache` | Always revalidate so new deploys take effect. |
| `/theme-init.js` | `public, max-age=300` | Small, not fingerprinted. |
| `/demo-files/*` | `public, max-age=3600`, `Content-Disposition: inline` | Demo PDFs for mock mode. |
| `/api/*` | set by the backend per [API_CONTRACT.md](API_CONTRACT.md#caching) | Search/list short TTLs; versioned files immutable; ask/reports `no-store`. |

Cloudflare's edge cache honours these headers. Purge is not needed for assets (new names each
build); `index.html` revalidates.

## Custom domain

*Workers & Pages → your project → Settings → Domains & Routes → Add → Custom domain* (the zone must
be on Cloudflare; DNS and the TLS certificate are created automatically). For Workers you can
alternatively add `"routes": [{ "pattern": "portal.example.org", "custom_domain": true }]` to
`wrangler.jsonc`. Choose a name that does not imply the site is an official city website — the
portal is independent. Keep HSTS (already in `_headers`) and enable "Always Use HTTPS".

## Checklist

- [ ] `npm run check` passes (typecheck, lint, tests, build).
- [ ] `VITE_DATA_MODE` set as intended; demo banner visible in `mock` mode.
- [ ] `API_ORIGIN` set (Workers) or `VITE_API_BASE_URL` + CSP `connect-src` updated (Pages).
- [ ] `/api/health` returns the expected status.
- [ ] Deep link refresh (e.g. `/documents/<id>`) serves the app, not a 404.
- [ ] Response headers include the CSP and security headers.
