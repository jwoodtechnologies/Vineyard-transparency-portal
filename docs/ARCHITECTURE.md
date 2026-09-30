# Architecture

> **The archive is the authority. AI is the interface.**
> If every AI system disappeared tomorrow, search, browsing, documents, meetings, and sources keep working.

This document describes the frontend and platform architecture (Phase 1) and how it connects to the
Phase 2 backend. Related documents:

| Topic | Document |
| --- | --- |
| REST contract the backend implements | [API_CONTRACT.md](API_CONTRACT.md) |
| Domain models | [DATA_MODEL.md](DATA_MODEL.md) |
| Ingestion / indexing pipeline | [INDEXING_ARCHITECTURE.md](INDEXING_ARCHITECTURE.md) |
| Source discovery crawler | [SOURCE_DISCOVERY.md](SOURCE_DISCOVERY.md) |
| Source-specific adapters | [SOURCE_ADAPTERS.md](SOURCE_ADAPTERS.md) |
| Retrieval-augmented answers | [RAG_DESIGN.md](RAG_DESIGN.md) |
| Security & privacy | [SECURITY.md](SECURITY.md) |
| Hosting | [CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md) |

## System overview

```
                  ┌──────────────────────────── Cloudflare ────────────────────────────┐
 Browser ───────► │ Static assets (dist/)  ── SPA: React + TypeScript + Tailwind        │
                  │ Worker (worker/index.ts) ── /api/* gateway ──► API_ORIGIN (Phase 2) │
                  └─────────────────────────────────────────────────────────────────────┘
                                                                      │
                     Phase 2 backend (any host: Oracle VM, Workers, container…)
                     ┌───────────────────────────────────────────────────────────┐
                     │ REST API (docs/API_CONTRACT.md)                            │
                     │ Full-text index (SQLite FTS5 / PostgreSQL)  ◄─┐            │
                     │ Semantic index (self-hosted embeddings)      ◄─┤ reindex    │
                     │ RAG service (optional, circuit-broken)         │            │
                     │ StorageProvider (filesystem / S3-compatible)  ◄─┤ ingest    │
                     └────────────────────────────────────────────────┴───────────┘
                                                                      ▲
               scripts/ (discover-sources → discover-documents → ingest → reindex → validate)
                                                                      ▲
                    PRIMARY SEED: https://www.vineyardutah.gov/transparency_portal/index.php
```

## Frontend layering

```
pages/ & components/     React UI — never touches HTTP, databases, or storage vendors
        │
services/                AskService, SearchService, DocumentService, MeetingService,
        │                BrowseService, SourceService, StatisticsService, ReportService
        │                (tab-local response cache, AI circuit breaker)
        ▼
data/adapters/           DataAdapter interface
   ├─ MockDataAdapter        VITE_DATA_MODE=mock — clearly labeled demo data, in memory
   └─ ProductionApiAdapter   VITE_DATA_MODE=api  — REST contract, timeouts, typed errors
```

* **Adapters** (`src/data/adapters/DataAdapter.ts`) define every operation the UI needs. Switching
  from demo data to production is configuration only (`VITE_DATA_MODE=api`, optional
  `VITE_API_BASE_URL`). The mock adapter and its dataset are code-split and never loaded in `api`
  mode.
* **Errors** are normalized to `DataError` with a `kind` (`offline`, `backend_unavailable`,
  `not_found`, `ai_unavailable`, `rate_limited`, `search_unavailable`, `timeout`, …) so every screen
  renders a precise, calm error state instead of a broken page.
* **Services** add a small per-tab cache for idempotent reads and the AI circuit breaker (below).
* **Hooks**: `useResource(key, loader)` handles loading/error/stale-while-revalidate without
  out-of-order results; `useLibrary` exposes on-device saves/history; `useTheme` handles
  light/dark/system.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Home — the Ask box, example questions, collections, recent meetings, archive status |
| `/ask?q=` | Threaded question → grounded answer, inline citations, source panel, follow-ups |
| `/search?q=&type=&category=&year=&body=&source=&from=&to=&meeting=&match=&title=&sort=&page=` | Traditional search; every state is a shareable URL |
| `/documents` | All documents, by collection |
| `/documents/:documentId?page=&q=` | Document viewer (PDF + extracted text), provenance, versions, relationships |
| `/browse` | By year, type, public body, subject, meeting, source, topic, code |
| `/meetings`, `/meetings/:meetingId` | Meeting model: agenda, packet, minutes, media, agenda items, motions |
| `/bodies/:bodyId` | Public body (bodies come from data, not a hard-coded list) |
| `/topics/:topicId` | Evidence-linked timeline ("what happened with X?") |
| `/code` | Municipal code with current / superseded labeling and history |
| `/sources`, `/sources/:sourceId` | Source manifest & provenance |
| `/saved` | Saved on this device + local history + history toggle |
| `/status` | Service health, archive statistics, source health, demo scenarios |
| `/about` | Independence, discovery, archiving, AI, citations, privacy |
| `*` | 404 |

All non-API paths fall back to `index.html` on Cloudflare (`not_found_handling:
"single-page-application"`), so every URL above is a stable, shareable link.

## Ask flow

```
question ─► AskService.ask ─► adapter.ask (POST /api/ask)
                 │                   │
                 │     ai_unavailable / rate_limited (429/503)
                 │                   ▼
                 └── open circuit breaker (Retry-After or 5 min, sessionStorage)
                          └─► SearchService fallback ─► AskResponse{ retrievalStatus: 'ai_unavailable',
                                                                       searchResults, notice }
```

* Answers are **structured** (`paragraphs → segments → citation indexes`), not HTML or markdown, so
  rendering is injection-safe and every statement carries its citation markers.
* Retrieval status is always shown: `grounded`, `partial`, `no_results`, `ai_unavailable`,
  `search_only`.
* In demo mode the `demo-extractive` engine (`src/data/mock/askEngine.ts`) answers **only by
  quoting** retrieved demo passages. It returns the exact refusal sentence when the records do not
  support an answer, and downgrades to `partial` when any question term is absent from the archive.
  Tests (`tests/mock-engines.test.ts`) assert that every citation excerpt literally occurs on the
  cited page.

## Document viewer

* PDF rendering uses pdf.js (legacy build for broad browser support) in a lazily loaded chunk:
  canvas page + selectable text layer, search-term highlighting, page jump via `?page=N`, zoom,
  keyboard navigation.
* The **Extracted text** tab is always available, shows OCR confidence, and highlights `?q=` terms.
  If the archived file fails to load, the viewer falls back to extracted text and offers the original
  source.
* The sidebar shows metadata (including full SHA-256), provenance (archived copy vs. original
  source, availability at last verification), versions (never silently overwritten), and typed
  relationships (`ADOPTED_DURING`, `AMENDS`, `SUPERSEDED_BY`, `PART_OF`, …) with their basis.

## Local-only state

| What | Where |
| --- | --- |
| Saved documents / searches / questions | IndexedDB (`vineyard-transparency-portal`), localStorage fallback |
| Recent questions & searches (toggleable) | IndexedDB, max 50 entries |
| Theme preference | `localStorage['vtp:theme']` (applied pre-paint by `public/theme-init.js`) |
| AI circuit breaker | `sessionStorage['vtp:ai-breaker-until']` |
| Demo scenario (mock mode only) | `localStorage['vtp:demo-scenario']` |

Nothing above is sent to a server. There are no accounts, cookies, or analytics.

## Demo data rules

The mock dataset (`src/data/mock/`) exists so every screen can be exercised before the production
archive is connected. It never fabricates real Vineyard actions:

* Titles carry DEMO / SAMPLE / EXAMPLE; numbers carry a `DEMO-` prefix; public bodies are named
  "Demo …"; vendors, streets, parks and projects are fictional; amounts are labeled placeholders.
* Original URLs point to `example.org`, never a government domain (asserted by tests).
* Sample questions that mention real topics (e.g. "300 West", "Holdaway") intentionally have no demo
  records, so demo mode demonstrates the honest "could not verify" path.
* Demo PDFs in `public/demo-files/` are generated by `npm run generate-demo-files`; every page is
  stamped "DEMO DOCUMENT – NOT A GOVERNMENT RECORD". Their real SHA-256 checksums are recorded in
  `src/data/mock/demo-files-manifest.json`.
* A slim, persistent strip labels the whole site as demo data; stats are labeled "Demo figures".

## Performance

* Route-level code splitting; the PDF engine (and its worker) load only on document pages.
* Search, facets and pagination are server-side in `api` mode; the browser never downloads the
  archive. Result lists keep the previous page visible while the next loads (no blocking spinners);
  skeletons are used for first loads.
* Hashed assets are cached immutably at the edge (`public/_headers`); `index.html` is revalidated.

## Accessibility

Semantic landmarks, skip link, visible focus rings, native `<dialog>` for modals/sheets (focus
containment, Escape), WAI-ARIA tabs with arrow-key navigation, labeled form controls, `aria-live`
status for result counts, toasts and loading, reduced-motion support, and contrast-checked light/dark
tokens. Everything is keyboard-operable; the mobile filter UI is a bottom sheet.
