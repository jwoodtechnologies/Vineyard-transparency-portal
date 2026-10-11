# Vineyard Transparency Portal

**Search the public record.** Ask a question about Vineyard, Utah and see the records behind the answer.

The Vineyard Transparency Portal is an independently operated public-records archive, search engine,
and research interface. Its philosophy is simple: *don't send people on a treasure hunt for public
records — give them the record.*

> Vineyard Transparency Portal is an independent public-records project and is not an official
> website of Vineyard City. Records displayed here originate from publicly available government
> sources.

**The archive is the authority. AI is the interface.** Every AI answer is grounded in retrieved
records and cites them. If AI is unavailable, the archive still works as a full search engine.

---

## Status

The application reads the archive API served by the Cloudflare Worker in `worker/`, through the
REST contract in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md). Records are collected by the Python
ingest in `ingest/` ([`docs/INGESTION.md`](docs/INGESTION.md)).

## Features

- **Ask**: natural-language questions → grounded answers with inline citations, a source panel
  (excerpt, page, meeting, agenda item, archived copy, original source), related records, and
  follow-ups. Clear retrieval status: grounded, partial, not verified, AI unavailable.
- **Search**: keyword, exact phrase, document number, title-only, and filters (type, collection,
  year, date range, public body, source, meeting). Every result explains why it matched and on which
  page. Shareable URLs such as `/search?q=parking&type=resolution&year=2026`.
- **Documents**: permanent URLs, a PDF viewer with page jumps and highlighting, extracted text with
  OCR labeling, full provenance (archived copy vs. original source, SHA-256, retrieval dates),
  versions, and typed relationships.
- **Meetings**: agenda, packet (with per-item page ranges), minutes (approved/draft), media,
  transcripts, agenda items, and motions linked to the minutes that record them.
- **Browse**: by year, type, public body, subject, meeting, source; evidence-linked **timelines**; a
  **municipal code** view that never presents superseded language as current.
- **Sources**: the source manifest, with the primary seed and health states.
- **Saved on this device**: documents, searches, and questions, plus local history that can be
  cleared or disabled. No accounts, no login, no tracking.
- Light/dark/system themes, mobile-first layouts, keyboard and screen-reader support.

## Quick start

```bash
npm install
npm run dev            # http://localhost:5173 (reads /api)
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` / `npm run lint` / `npm test` | Checks (Vitest) |
| `npm run check` | All of the above |
| `npm run cf:dev` / `npm run cf:deploy` | Run / deploy on Cloudflare Workers ([guide](docs/CLOUDFLARE_DEPLOYMENT.md)) |

### Archive tooling (Python ingest)

| Command | Purpose |
| --- | --- |
| `npm run ingest` | Run the Python ingest (`python3 -m ingest ingest`) |
| `npm run test:ingest` | Python ingest tests |

The primary discovery seed is
**https://www.vineyardutah.gov/transparency_portal/index.php**. See
[`docs/INGESTION.md`](docs/INGESTION.md). These commands need outbound network access to the
government hosts.

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_BASE_URL` | *(empty)* | API origin; empty = same-origin `/api` via the Cloudflare Worker |
| `VITE_API_TIMEOUT_MS` | `20000` | Request timeout |

On Cloudflare, the Worker's `API_ORIGIN` variable points `/api/*` at the backend. See
[`docs/CLOUDFLARE_DEPLOYMENT.md`](docs/CLOUDFLARE_DEPLOYMENT.md). Vercel is not used.

## Tech stack

React 19, TypeScript, Vite, Tailwind CSS v4, React Router, pdf.js, lucide icons, and self-hosted
fonts (Inter, Source Serif 4, IBM Plex Mono). Hosting is Cloudflare Workers static assets plus a thin
API gateway Worker. Every dependency is free and open source, and no paid SaaS is required.

## Project layout

```
src/
  types/models.ts          Domain models (Document, DocumentChunk, Meeting, Citation, AskResponse…)
  data/adapters/           DataAdapter interface, ProductionApiAdapter, errors
  services/                AskService (circuit breaker), Search/Document/Meeting/Browse/Source/Statistics/Report
  console/                 Route screens and their components (routes in app/router.tsx)
  components/              Shared UI: PDF viewer, buttons, skeletons
  lib/                     Safety, text/highlighting, local storage, URL state, formatting
worker/index.ts            Cloudflare Worker: SPA assets + /api gateway
ingest/                    Python ingest (crawl, download, extract, index)
config/                    RAG system prompt
docs/                      Architecture, API contract, data model, indexing, discovery, adapters, RAG, security, deployment
tests/                     Vitest suites
public/                    _headers (CSP, caching), theme-init.js, favicon
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API contract](docs/API_CONTRACT.md)
- [Data model](docs/DATA_MODEL.md)
- [Indexing architecture](docs/INDEXING_ARCHITECTURE.md)
- [Source discovery](docs/SOURCE_DISCOVERY.md)
- [Source adapters](docs/SOURCE_ADAPTERS.md)
- [RAG design](docs/RAG_DESIGN.md)
- [Security & privacy](docs/SECURITY.md)
- [Cloudflare deployment](docs/CLOUDFLARE_DEPLOYMENT.md)

## Mock data

Demo records exist only to exercise the interface. They are always labeled DEMO, SAMPLE, or
EXAMPLE. They use fictional vendors, streets, and projects, plus placeholder amounts. Their "original
source" links point to `example.org`. None of them is a record of any real government action.

## Contributing & reporting issues

Every document and answer has a **Report an issue** action. For code, run `npm run check` before
opening a pull request.

## Production (Phase 2)

* Live site: https://vineyardportal.org (Worker `vineyard-transparency-portal` on Cloudflare Free).
* Backend: `worker/` (API, D1 FTS5 search, R2 archive, Workers AI) and `migrations/`.
* Ingestion: `ingest/` (Python), run by `.github/workflows/ingest.yml` (manual + daily).
* Docs: docs/CLOUDFLARE.md, docs/INGESTION.md, docs/SOURCES.md, docs/API.md, docs/SEARCH.md,
  docs/AI_RAG.md, docs/FREE_TIER_LIMITS.md.

Vineyard Transparency Portal is an independent public-records project and is not an official
website of Vineyard City. Records displayed here originate from publicly available government sources.
