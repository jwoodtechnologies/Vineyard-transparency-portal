# Cloudflare setup (production)

Everything runs on the **Cloudflare Free plan**. No paid plan, add-on or payment method is used.

## Resources (account `7e8349e41c1d414340974453ef6ac227`)

| Resource | Name | ID / detail |
| --- | --- | --- |
| Worker (SPA + API) | `vineyard-transparency-portal` | `https://vineyard-transparency-portal.citizenjwood.workers.dev` |
| D1 catalog | `vtp-catalog` | `8ae24e53-356b-4eda-8ca5-b232c563dc89` (binding `CATALOG_DB`) |
| D1 search shard 0 | `vtp-search-0` | `004f3149-ccba-46e3-b041-fbb2925ac00b` (binding `SEARCH_DB_0`) |
| R2 bucket | `vtp-public-records` | Standard storage class, public access disabled (binding `ARCHIVE`) |
| Workers AI | binding `AI` | Free allocation, model in `AI_MODEL` |
| Zone | `vineyardportal.org` | Free plan, nameservers `dane.ns.cloudflare.com`, `sandy.ns.cloudflare.com` |

The domain stays registered at Namecheap; only its nameservers point to Cloudflare.

## One application, one origin

`wrangler.jsonc` deploys a single Worker with static assets:

* `/api/*` runs `worker/index.ts` (`run_worker_first`).
* Everything else is served from `dist/`, with SPA fallback for client routes.
* `www.vineyardportal.org` is answered by the Worker with a **301** to `https://vineyardportal.org` (same path and query).

## Deployment

Workers Builds (Cloudflare's Git integration) builds `main` on every push:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` (uses `.env.production`, `VITE_DATA_MODE=api`) |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

Manual alternative from a workstation: `npm ci && npm run build && npx wrangler deploy`.

After the first deploy, apply the schema once (idempotent, safe to repeat): run the
**Ingest public records** workflow with command `migrate`, or `npm run db:migrate` locally.

## DNS

Records imported when the zone was added (all preserved):

| Type | Name | Content | Note |
| --- | --- | --- | --- |
| MX | `@` | `eforward1-5.registrar-servers.com` (10/10/10/15/20) | Namecheap email forwarding (no forwarders were defined) |
| TXT | `@` | `v=spf1 include:spf.efwd.registrar-servers.com ~all` | SPF for the forwarding service |
| A | `@` | `192.64.119.191` | Namecheap parking page, replaced by the Worker custom domain |
| CNAME | `www` | `parkingpage.namecheap.com` | Namecheap parking page, replaced by the Worker custom domain |

Namecheap email forwarding only works on Namecheap BasicDNS. No forwarders existed, so nothing was
lost; if email for this domain is wanted later, use Cloudflare Email Routing (free).

## Custom domains, TLS and headers

1. Worker > Settings > Domains & Routes > add custom domains `vineyardportal.org` and `www.vineyardportal.org`
   (Cloudflare creates the DNS records and certificates; the parking A/CNAME records are replaced).
2. SSL/TLS: Universal SSL (free). Edge Certificates > **Always Use HTTPS: on**.
3. HSTS stays **off** until HTTPS on the apex and www has been verified in production. Then enable it
   in SSL/TLS > Edge Certificates (start with `max-age=86400`, no preload) or re-add the header in
   `public/_headers`.

Security headers: static assets use `public/_headers` (CSP, frame-ancestors none, nosniff,
Referrer-Policy, Permissions-Policy, COOP). API responses set nosniff, Referrer-Policy,
`X-Frame-Options: DENY` and CORP in `worker/lib/http.ts`; archived HTML is never rendered on the
portal origin (served as an attachment with `CSP: sandbox`).

## Secrets

None are required. Ingestion authenticates with GitHub Actions OIDC tokens (see INGESTION.md).
Optional for local runs only: `npx wrangler secret put INGEST_TOKEN` (32+ random characters).
