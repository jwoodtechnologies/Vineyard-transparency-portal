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
               ingest/ (Python: crawl → download → extract → index)
                                                                      ▲
                    PRIMARY SEED: https://www.vineyardutah.gov/transparency_portal/index.php
```

## Frontend layering

```
console/ & components/   React UI: never touches HTTP, databases, or storage vendors
        │
services/                AskService, SearchService, DocumentService, MeetingService,
        │                BrowseService, SourceService, StatisticsService, ReportService
        │                (tab-local response cache, AI circuit breaker)
        ▼
data/adapters/           DataAdapter interface
   └─ ProductionApiAdapter   REST contract, timeouts, typed errors
```

* **Adapters** (`src/data/adapters/DataAdapter.ts`) define every operation the UI needs. The only
  adapter is the production API (optional `VITE_API_BASE_URL`).
* **Errors** are normalized to `DataError` with a `kind` (`offline`, `backend_unavailable`,
  `not_found`, `ai_unavailable`, `rate_limited`, `search_unavailable`, `timeout`, …) so every screen
  renders a precise, calm error state instead of a broken page.
* **Services** add a small per-tab cache for idempotent reads and the AI circuit breaker (below).
* **Hooks**: `useResource(key, loader)` handles loading/error/stale-while-revalidate without
  out-of-order results; `useLibrary` exposes on-device saves/history; `useTheme` handles
  light/dark/system.

## Routes

Routes live in `src/app/router.tsx`; every screen is in `src/console/`.

| Route | Screen |
| --- | --- |
| `/` | Ask: grounded answers with citations |
| `/meetings`, `/calendar`, `/meetings/:meetingId` | Meetings calendar and one meeting |
| `/documents/:documentId` | Document viewer |
| `/services`, `/services/:id` | City services |
| `/budget`, `/map`, `/records` | Budget, map (with funded projects and city construction under it), records |
| `/construction` | Redirect to `/map?layers=projects#projects` |
| `/latest`, `/news` | Redirect to `/meetings` (the calendar) |
| `/votes`, `/boards`, `/people`, `/people/:slug` | Voting records, boards, people (`/planning` redirects to `/boards`) |
| `/search`, `/ask` | Redirect to `/` with the question |
| `*` | Redirect to `/` |

### Map tools

* **Measure** (`src/console/measure/`): Distance, Area, Circle and Parcel from the ruler button. Geodesic math in
  code (haversine and spherical polygon area on a sphere fitted to WGS84 at the shape). `?m=` links reopen a shape
  exactly. Elevation profiles come from `GET /api/map/elevation` (USGS 3DEP, at most 50 points, Vineyard only).
* **Street view** (`src/console/streetview/`): a long press, a right click or the Street view button and a tap
  drops a pin. The nearest Mapillary photo within 60 m opens turned to face the pin (MapillaryJS, its own chunk,
  loaded only then), with zoning districts and the parcel under the pin drawn on the ground and a camera cone on
  the map. Without a photo, or without a token (`GET /api/streetview/config`, from the Worker variable
  `MAPILLARY_TOKEN`), the map tilts to a 3D street level view with buildings and zoning. A build step
  (`mapillaryNoEval` in `vite.config.ts`) removes MapillaryJS's one use of `new Function`, so the CSP needs no
  `'unsafe-eval'`.

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

Nothing above is sent to a server. There are no accounts, cookies, or analytics.

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

## Phase 2: production backend on Cloudflare

```
Browser ─► vineyardportal.org ─► Cloudflare Worker "vineyard-transparency-portal"
                                   ├─ static SPA (dist/)                    [no Worker invocation]
                                   └─ /api/* (worker/index.ts)
                                        ├─ D1 vtp-catalog      metadata, provenance, versions, meetings, crawl state, quotas
                                        ├─ D1 vtp-search-N     FTS5 chunks (sharded, SearchRepository)
                                        ├─ R2 vtp-public-records  archived originals (content-addressed, 60 GB stop under a 60 GB ceiling)
                                        └─ Workers AI          grounded answers, optional (search-only fallback)
GitHub Actions / workstation ─► ingest/ (Python) ─► /api/admin/* (OIDC-authenticated writes)
```

The Phase 1 gateway (`API_ORIGIN` proxy) is replaced by the in-Worker API; the REST contract in
API_CONTRACT.md is unchanged, so the frontend reads it directly.
Production docs: [CLOUDFLARE.md](CLOUDFLARE.md), [INGESTION.md](INGESTION.md), [SOURCES.md](SOURCES.md),
[API.md](API.md), [SEARCH.md](SEARCH.md), [AI_RAG.md](AI_RAG.md), [FREE_TIER_LIMITS.md](FREE_TIER_LIMITS.md).
