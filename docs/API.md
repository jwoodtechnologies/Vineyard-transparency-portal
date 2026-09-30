# API (production)

The full request/response contract is [API_CONTRACT.md](API_CONTRACT.md); types are
`src/types/models.ts`. This page lists what the Worker implements and the production specifics.

| Route | Notes |
| --- | --- |
| `GET /api/health` | `status`, `search`, `ai`, plus `database`, `archive`, `aiMode`, `searchShards`, `indexedDocuments`, `lastCrawl`. No secrets. |
| `GET /api/stats` | Computed from D1: documents, pages, meetings, earliest/latest record, sources, OCR pending, archived, quota-deferred, last successful crawl. |
| `GET /api/sources[/:id]` | Registry with health and document counts. |
| `GET /api/documents` | Filters `type, category, year, from, to, body, source, meeting, currency`; `sort`; `page`, `pageSize` ≤ 100; `ids=` (≤ 100). |
| `GET /api/documents/:id` | Document + every provenance path, versions, relationships, body, meeting, agenda item. `ETag`. |
| `GET /api/documents/:id/file[?version=n]` | Archived bytes from R2: correct `Content-Type`, `Content-Disposition` (sanitized filename), `ETag: "<sha256>"`, `Accept-Ranges`, `206` ranges, `304`. Not archived: `302` to the original government URL. HTML is never served inline. |
| `GET /api/documents/:id/text` | Page texts, OCR flag per page. |
| `GET /api/documents/:id/related` | Relationships from source structure plus documents published for the same meeting. |
| `GET /api/search` | See [SEARCH.md](SEARCH.md). |
| `POST /api/ask` | See [AI_RAG.md](AI_RAG.md). |
| `GET /api/meetings[/:id]` | CivicClerk meetings with agenda/packet/minutes document ids and media links. |
| `GET /api/bodies[/:id]`, `/api/categories`, `/api/browse/facets`, `/api/suggestions` | From indexed data only. |
| `GET /api/topics`, `/api/code` | Empty until curated / crawled (never invented). |
| `POST /api/reports` | Stores only the submitted fields. |

Errors always use `{ "error": { "kind", "message", "retryAfterSeconds?" } }`.

## Ingestion (write) API

`/api/admin/*` requires `Authorization: Bearer <GitHub OIDC token | INGEST_TOKEN>` and is used only by
`ingest/`. Endpoints: `migrate`, `quota`, `verify`, `sources`, `sources/status`, `bodies`,
`meetings`, `queue` (GET/POST), `queue/status`, `queue/retry-errors`, `documents`,
`documents/:id` (status patch), `documents/:id/chunks`, `document-sources/availability`,
`archive/:sha256` (PUT), `runs[/:id]`, `errors`, `optimize`. Every write goes through the daily D1
budget gate (429 `quota_exhausted`).
