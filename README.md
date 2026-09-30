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

**Phase 1 — frontend & platform architecture: complete.** The whole application runs today on a
clearly labeled demo dataset (`VITE_DATA_MODE=mock`). The production backend (Phase 2) plugs in
through the REST contract in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) by configuration alone.

The source-discovery crawler is implemented (`npm run discover-sources`) but has **not yet been run
against the live seed**. No discovery counts are published until it has been.

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
npm run dev            # http://localhost:5173 (demo data)
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` / `npm run lint` / `npm test` | Checks (Vitest) |
| `npm run check` | All of the above |
| `npm run generate-demo-files` | Regenerate the watermarked demo PDFs + checksum manifest |
| `npm run cf:dev` / `npm run cf:deploy` | Run / deploy on Cloudflare Workers ([guide](docs/CLOUDFLARE_DEPLOYMENT.md)) |

### Archive tooling (Phase 2 pipeline)

| Command | Purpose |
| --- | --- |
| `npm run discover-sources` | Crawl the primary seed and classify public-record systems and documents |
| `npm run discover-documents` | Run source adapters to list candidate documents |
| `npm run ingest` | Download → hash → dedupe → store → extract text → chunk |
| `npm run reindex` | Build the full-text (and optional semantic) index |
| `npm run validate-archive` | Verify checksums, chunk links, and provenance |
| `npm run source-health` | Check every registered source's health |

The primary discovery seed is
**https://www.vineyardutah.gov/transparency_portal/index.php** — see
[`docs/SOURCE_DISCOVERY.md`](docs/SOURCE_DISCOVERY.md) and [`config/source-seeds.json`](config/source-seeds.json).
These commands need outbound network access to the government hosts.

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_DATA_MODE` | `mock` | `mock` = bundled demo data; `api` = Phase 2 backend |
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
  data/adapters/           DataAdapter interface, MockDataAdapter, ProductionApiAdapter, errors
  data/mock/               Demo dataset, demo search engine, demo extractive Ask engine
  services/                AskService (circuit breaker), Search/Document/Meeting/Browse/Source/Statistics/Report
  pages/                   Route screens
  components/              UI: ask, documents (PDF/text viewers), search, meetings, timeline, archive, layout, ui
  lib/                     Safety, text/highlighting, local storage, URL state, formatting
worker/index.ts            Cloudflare Worker: SPA assets + /api gateway
scripts/                   Discovery, ingestion, indexing, validation, health, demo-file generation
config/                    source-seeds.json, RAG system prompt
docs/                      Architecture, API contract, data model, indexing, discovery, adapters, RAG, security, deployment
tests/                     Vitest suites
public/                    _headers (CSP, caching), demo-files/, theme-init.js, favicon
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
