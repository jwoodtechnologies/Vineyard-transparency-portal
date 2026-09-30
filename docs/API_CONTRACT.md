# API Contract

This is the REST contract between the frontend (`src/data/adapters/ProductionApiAdapter.ts`) and
the Phase 2 archive backend. All request/response bodies use the TypeScript types in
[`src/types/models.ts`](../src/types/models.ts); type names below refer to that file.

> All example payloads use obviously fictional placeholder values ("Exampleville", year 2099,
> ids like `doc_0123456789abcdef`). They are not Vineyard records.

## Conventions

| Topic | Rule |
| --- | --- |
| Base path | `/api` on the portal origin (proxied by the Cloudflare Worker to `API_ORIGIN`), or `${VITE_API_BASE_URL}/api` when the API is on another origin. |
| Format | JSON (`application/json; charset=utf-8`) for everything except `GET /api/documents/:id/file`. |
| Dates | `date` fields are calendar dates `YYYY-MM-DD` (America/Denver). `*At` fields are UTC ISO-8601 timestamps. |
| Array query params | Repeat the key: `?type=agenda&type=minutes`. |
| Auth | None. The portal has no accounts. Cookies and `Authorization` headers are ignored (the Worker strips them before proxying). |
| Untrusted text | Every string that originates from an archived document (titles, excerpts, page text) is untrusted and must be rendered as text, never HTML. |
| Demo data | Production responses omit `isDemo` or set it `false`. |

### Pagination

List endpoints return `Paginated<T>`:

```json
{ "items": [], "page": 1, "pageSize": 20, "total": 0, "totalIsEstimate": false }
```

- `page` is 1-based (default `1`). `pageSize` default `20`, maximum `100` (larger values are clamped).
- A page beyond the last returns `items: []` with the real `total` (not 404).
- `totalIsEstimate: true` means `total` is a lower bound (very large result sets).

### Errors

Every non-2xx JSON response uses one envelope:

```json
{ "error": { "kind": "rate_limited", "message": "Too many questions. Try again shortly.", "retryAfterSeconds": 30 } }
```

| `kind` | HTTP status | Meaning / client behaviour |
| --- | --- | --- |
| `not_found` | 404 | Unknown id. UI shows a "not in the archive" state. |
| `rate_limited` | 429 + `Retry-After` | Per-client limit reached (mainly `/api/ask`). `retryAfterSeconds` mirrors `Retry-After`. The frontend AskService opens its AI circuit breaker for that long and falls back to search. |
| `ai_unavailable` | 503 + `Retry-After` | The answer model is down / quota exhausted **and** the backend chose not to return a search fallback itself (see [Ask](#post-apiask)). The frontend opens its breaker and calls `/api/search`. |
| `backend_unavailable` | 503 (502 when the origin is unreachable) | Returned by the Cloudflare Worker when `API_ORIGIN` is not configured (503) or the origin cannot be reached (502). |
| `search_unavailable` | 503 | The full-text index is unavailable (e.g. being rebuilt). |
| `offline` | — | Client-side only (network failure). Listed so clients share one vocabulary; servers never send it. |
| `server` | 500 | Unexpected error. Message must not leak internals. |

Additional kinds a client may see: `method_not_allowed` (405, sent by the Worker for methods other
than GET/HEAD/POST/OPTIONS), and client-generated `timeout`, `aborted`, `bad_response`
(see `src/data/adapters/errors.ts`). Malformed input (e.g. an empty `question`, an invalid date)
returns **400** with kind `bad_request` and a descriptive message; clients that do not recognise a
kind treat it as a generic request error.

### Caching

| Endpoint group | `Cache-Control` |
| --- | --- |
| `/api/search`, `/api/documents` (list), `/api/meetings` (list) | `public, max-age=60, stale-while-revalidate=300` |
| Detail endpoints (`/api/documents/:id`, `/text`, `/related`, `/api/meetings/:id`, bodies, categories, topics, code, sources) | `public, max-age=300, stale-while-revalidate=3600` + `ETag` |
| `/api/stats`, `/api/browse/facets`, `/api/suggestions` | `public, max-age=300` |
| `/api/documents/:id/file?version=n` | `public, max-age=31536000, immutable` (versions are content-addressed and never change) |
| `/api/documents/:id/file` (current version) | `public, max-age=3600` + `ETag: "<sha256>"` |
| `POST /api/ask`, `POST /api/reports`, `/api/health` | `no-store` |

Responses carrying user questions (`/api/ask`) are never cached by shared caches and the question
text is not logged (see [SECURITY.md](SECURITY.md)).

### CORS

Same-origin by default (the Worker proxies `/api/*`). If the API is served from another origin, it
must return `Access-Control-Allow-Origin` set to the portal origin only, never `*` with credentials,
and must not require credentials (`fetch(..., { credentials: 'omit' })`).

---

## Endpoints

| Method & path | Request | Response |
| --- | --- | --- |
| `POST /api/ask` | `AskRequest` | `AskResponse` |
| `GET /api/search` | query params | `SearchResponse` |
| `GET /api/documents` | filters, sort, page | `Paginated<DocumentSummary>` |
| `GET /api/documents?ids=` | `ids` (repeat, ≤100) | `Paginated<DocumentSummary>` |
| `GET /api/documents/:id` | — | `DocumentDetail` |
| `GET /api/documents/:id/file` | `version?` | file bytes |
| `GET /api/documents/:id/text` | — | `DocumentPageText[]` |
| `GET /api/documents/:id/related` | — | `RelatedDocument[]` |
| `GET /api/meetings` | `body, year, sort, page, pageSize` | `Paginated<MeetingSummary>` |
| `GET /api/meetings/:id` | — | `Meeting` |
| `GET /api/bodies` | — | `GovernmentBody[]` |
| `GET /api/bodies/:id` | — | `GovernmentBody` |
| `GET /api/categories` | — | `Category[]` |
| `GET /api/browse/facets` | — | `BrowseFacets` |
| `GET /api/sources` | — | `SourceRegistryEntry[]` |
| `GET /api/sources/:id` | — | `SourceRegistryEntry` |
| `GET /api/stats` | — | `ArchiveStatistics` |
| `GET /api/suggestions` | — | `SuggestedQuery[]` |
| `GET /api/topics` | — | `Topic[]` |
| `GET /api/topics/:id` | — | `TopicDetail` |
| `GET /api/code` | — | `CodeNode[]` |
| `POST /api/reports` | `IssueReport` | `IssueReportReceipt` (201) |
| `GET /api/health` | — | `HealthStatus` (subset) |

### POST /api/ask

Retrieval-augmented answer over the archive. Design: [RAG_DESIGN.md](RAG_DESIGN.md).

Request (`AskRequest`):

```json
{
  "question": "When did the Exampleville council adopt the sample sign standards?",
  "filters": { "documentTypes": ["ordinance", "minutes"], "dateFrom": "2099-01-01" },
  "conversation": [
    { "role": "user", "content": "What ordinances were adopted in January 2099?" },
    { "role": "assistant", "content": "Ordinance 2099-01 was adopted ... [1]" }
  ]
}
```

- `question`: 1–1000 characters (400 otherwise).
- `conversation`: at most the last 6 turns; used only to resolve follow-ups for this request and never stored.

Response (`AskResponse`, `retrievalStatus: "grounded"`):

```json
{
  "id": "ask_7f3a9c01",
  "question": "When did the Exampleville council adopt the sample sign standards?",
  "retrievalStatus": "grounded",
  "answer": "The council adopted Ordinance 2099-01 on January 5, 2099 [1]. The minutes record a 5-0 vote [2].",
  "paragraphs": [
    {
      "segments": [
        { "text": "The council adopted Ordinance 2099-01 on January 5, 2099.", "citations": [1] },
        { "text": "The minutes record a 5-0 vote.", "citations": [2] }
      ]
    }
  ],
  "citations": [
    {
      "index": 1,
      "documentId": "doc_0123456789abcdef",
      "documentTitle": "Ordinance 2099-01 (Example Sign Standards)",
      "documentType": "ordinance",
      "documentNumber": "Ordinance 2099-01",
      "date": "2099-01-05",
      "governmentBodyName": "Example Town Council",
      "meetingId": "mtg_00000000000000aa",
      "meetingTitle": "Example Town Council Regular Meeting",
      "agendaItem": "5.2",
      "page": 1,
      "sectionTitle": "ORDINANCE NO. 2099-01",
      "excerpt": {
        "documentId": "doc_0123456789abcdef",
        "chunkId": "doc_0123456789abcdef:c0000",
        "page": 1,
        "sectionTitle": "ORDINANCE NO. 2099-01",
        "text": "ORDINANCE NO. 2099-01 ... Adopted January 5, 2099",
        "highlights": [[0, 21]]
      },
      "archiveUrl": "/api/documents/doc_0123456789abcdef/file",
      "originalUrl": "https://records.example.org/files/ordinance-2099-01.pdf"
    }
  ],
  "relatedDocuments": [],
  "suggestedFollowUps": ["What did the staff report say about the sign standards?"],
  "notice": null,
  "generatedAt": "2099-02-01T12:00:00.000Z",
  "engine": "example-model-name"
}
```

(The second citation is omitted above for brevity.)

**Contract rules**

1. **Every factual claim cites.** Each `AnswerSegment` that states a fact has a non-empty
   `citations` array; every index resolves to an entry in `citations`; every citation's
   `excerpt.chunkId` is a chunk the server actually retrieved for this request. Segments without
   citations are only allowed for the refusal sentence, a statement of what could not be verified,
   or a lead-in that introduces a list whose items are each cited (e.g. "The indexed records include
   3 matching ordinances:").
2. `answer` is the plain-text equivalent of `paragraphs` with `[n]` markers. Clients render
   `paragraphs`; neither field contains HTML or markdown.
3. `retrievalStatus` semantics:

   | Status | Meaning | Required fields |
   | --- | --- | --- |
   | `grounded` | Every factual segment is supported by cited passages. | `citations` non-empty |
   | `partial` | Some of the question is answered with citations; the rest could not be verified. The unverified part is stated in the answer. | `citations`, `searchResults` |
   | `no_results` | Nothing relevant was retrieved. `answer` is exactly: *"I could not verify that from the records currently indexed in the Vineyard Transparency Portal."* | `citations: []`; `searchResults` optional (near matches) |
   | `ai_unavailable` | The answer model failed or its quota is exhausted; the server fell back to search. | `searchResults` (required), `notice` |
   | `search_only` | This deployment has no answer model configured (search-only mode). | `searchResults` (required), `notice` |

4. **AI unavailable.** When the model is unavailable but search works, respond **200** with
   `retrievalStatus: "ai_unavailable"`, a `notice`, and `searchResults` from the same query.
   When the backend's own circuit breaker is open it MAY instead respond **503**
   `{ "error": { "kind": "ai_unavailable", "retryAfterSeconds": 300 } }` with `Retry-After`; the
   frontend then stops calling `/api/ask` for that period (its AskService circuit breaker,
   default 300 s when no value is given) and queries `/api/search` itself.
5. Rate limiting: `/api/ask` is limited per client (for example a token bucket of 10 requests/minute
   per IP, enforced at the edge or in the backend). Over the limit: **429** `rate_limited` +
   `Retry-After`.

Example (`ai_unavailable`, 200):

```json
{
  "id": "ask_7f3a9c02",
  "question": "What did the example council decide about sidewalks?",
  "retrievalStatus": "ai_unavailable",
  "answer": "AI answers are temporarily unavailable. Search results from the public-record archive are shown below.",
  "paragraphs": [],
  "citations": [],
  "relatedDocuments": [],
  "suggestedFollowUps": [],
  "searchResults": [ { "document": { "id": "doc_0123456789abcdef", "title": "Example Minutes" }, "score": 7.1, "excerpts": [], "matches": [], "meetingTitle": null } ],
  "notice": "AI answers are temporarily unavailable. Search results from the public-record archive are shown below.",
  "generatedAt": "2099-02-01T12:00:00.000Z",
  "engine": "search-fallback"
}
```

(`searchResults[].document` is abbreviated; real responses contain full `DocumentSummary` objects.)

### GET /api/search

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `q` | string | — | Search text. Quoted phrases are honoured. Document numbers such as `Ordinance 2099-01` are detected and boosted (see `interpretation`). |
| `type` | `DocumentType` (repeat) | all | |
| `category` | `CategoryId` (repeat) | all | |
| `year` | integer (repeat) | all | |
| `from`, `to` | `YYYY-MM-DD` | — | Inclusive date range on `Document.date`. |
| `body` | government body id (repeat) | all | |
| `source` | source id (repeat) | all | |
| `meeting` | meeting id | — | |
| `currency` | `RecordCurrency` (repeat) | all | |
| `match` | `all` \| `any` \| `phrase` | `all` | How query terms combine. |
| `title` | `1` | off | Match titles/document numbers only. |
| `sort` | `relevance` \| `date_desc` \| `date_asc` \| `title` | `relevance` | |
| `page`, `pageSize` | integers | 1, 20 | `pageSize` ≤ 100 |

Example: `GET /api/search?q=sign+standards&type=ordinance&year=2099&match=all&sort=relevance&page=1&pageSize=20`

```json
{
  "items": [
    {
      "document": {
        "id": "doc_0123456789abcdef",
        "slug": "ordinance-2099-01-example-sign-standards-012345",
        "title": "Ordinance 2099-01 (Example Sign Standards)",
        "documentType": "ordinance",
        "documentNumber": "Ordinance 2099-01",
        "date": "2099-01-05",
        "year": 2099,
        "governmentBodyId": "example-town-council",
        "governmentBodyName": "Example Town Council",
        "meetingId": null,
        "sourceId": "example-source",
        "pageCount": 2,
        "mimeType": "application/pdf",
        "fileSize": 1094,
        "categories": ["ordinances"],
        "currency": "unknown",
        "description": null
      },
      "score": 12.4,
      "excerpts": [
        {
          "documentId": "doc_0123456789abcdef",
          "chunkId": "doc_0123456789abcdef:c0000",
          "page": 1,
          "sectionTitle": "ORDINANCE NO. 2099-01",
          "text": "AN ORDINANCE ADOPTING SAMPLE SIGN STANDARDS",
          "highlights": [[29, 33], [34, 43]]
        }
      ],
      "matches": [{ "field": "full_text", "terms": ["sign", "standards"], "page": 1 }],
      "meetingTitle": null
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "query": "sign standards",
  "facets": { "documentTypes": [{ "value": "ordinance", "label": "Ordinance", "count": 1 }], "years": [], "governmentBodies": [], "sources": [], "categories": [] },
  "tookMs": 12,
  "retrieval": ["full_text"],
  "interpretation": { "phrases": [], "terms": ["sign", "standards"], "documentNumber": null, "detectedYear": null, "detectedDocumentType": null }
}
```

- `highlights` are `[start, end)` character offsets into `excerpt.text`.
- `retrieval` lists which retrievers contributed (`full_text`, `semantic`, `metadata`); results from
  several retrievers are fused with reciprocal rank fusion ([INDEXING_ARCHITECTURE.md](INDEXING_ARCHITECTURE.md)).
- Non-canonical probable duplicates (`duplicateOf` set) are collapsed into their canonical record.
- Empty `q` with filters is allowed (behaves like a filtered list sorted by `sort`, default `date_desc`).

### GET /api/documents

Same filter params as search (`type, category, year, from, to, body, source, meeting, currency`),
plus `sort` (`date_desc` default, `date_asc`, `title`), `page`, `pageSize`.

**By ids:** `GET /api/documents?ids=doc_a&ids=doc_b` (≤100 ids) returns `Paginated<DocumentSummary>`
with items in the requested order; unknown ids are omitted (no 404). Used for saved items.

### GET /api/documents/:id

Returns `DocumentDetail`: the `Document` plus `governmentBody`, `meeting` (summary), `agendaItem`,
`sources` (every `DocumentSource` — a document found at several URLs lists them all),
`versions` (every `DocumentVersion`, oldest first) and `relationships`.

```json
{
  "id": "doc_0123456789abcdef",
  "title": "Ordinance 2099-01 (Example Sign Standards)",
  "documentType": "ordinance",
  "documentNumber": "Ordinance 2099-01",
  "date": "2099-01-05",
  "checksum": "9f2c…(64 hex)",
  "checksumAlgorithm": "sha256",
  "currentVersion": 2,
  "currency": "unknown",
  "ocrRequired": false,
  "ocrStatus": "not_required",
  "archiveUrl": "/api/documents/doc_0123456789abcdef/file",
  "originalUrl": "https://records.example.org/files/ordinance-2099-01.pdf",
  "sources": [
    {
      "id": "src_1a2b3c4d5e6f7a8b",
      "sourceId": "example-source",
      "name": "Example Records Portal",
      "baseUrl": "https://records.example.org/",
      "sourceType": "document_library",
      "authority": "Example Town",
      "originalUrl": "https://records.example.org/files/ordinance-2099-01.pdf",
      "retrievedAt": "2099-02-01T12:00:00.000Z",
      "lastVerifiedAt": "2099-02-08T12:00:00.000Z",
      "originalAvailable": true,
      "httpStatusAtLastCheck": 200
    }
  ],
  "versions": [
    { "id": "doc_0123456789abcdef:v1", "documentId": "doc_0123456789abcdef", "versionNumber": 1, "changeStatus": "original", "checksum": "…", "retrievedAt": "2099-02-01T12:00:00.000Z", "sourceUrl": "https://records.example.org/files/ordinance-2099-01.pdf", "fileSize": 1032, "pageCount": 2, "archiveUrl": "/api/documents/doc_0123456789abcdef/file?version=1" },
    { "id": "doc_0123456789abcdef:v2", "documentId": "doc_0123456789abcdef", "versionNumber": 2, "changeStatus": "replaced", "checksum": "…", "retrievedAt": "2099-02-08T12:00:00.000Z", "sourceUrl": "https://records.example.org/files/ordinance-2099-01.pdf", "fileSize": 1094, "pageCount": 2, "archiveUrl": "/api/documents/doc_0123456789abcdef/file?version=2", "note": "Content at the source URL changed." }
  ],
  "relationships": [],
  "governmentBody": null,
  "meeting": null,
  "agendaItem": null
}
```

(Abbreviated: real responses include every `Document` field.)

### GET /api/documents/:id/file

Streams the archived bytes of the current version, or of `?version=n`.

- `Content-Type`: the record's `mimeType`; `Content-Disposition: inline; filename="<sanitized fileName>"`;
  `X-Content-Type-Options: nosniff`; `Accept-Ranges: bytes` (pdf.js range requests); `ETag: "<sha256>"`.
- Archived **HTML** records (e.g. public-notice pages) are never served as `text/html` from the portal
  origin: serve the extracted text as `text/plain; charset=utf-8`, or the raw bytes with
  `Content-Disposition: attachment` and `Content-Security-Policy: sandbox`.
- 404 `not_found` for an unknown id or version.

### GET /api/documents/:id/text

`DocumentPageText[]` — extracted text per page, `ocr: true` for OCR-derived pages:

```json
[{ "page": 1, "text": "ORDINANCE NO. 2099-01\nAN ORDINANCE ADOPTING SAMPLE SIGN STANDARDS", "ocr": false }]
```

Returns `[]` when no text is available (`extractedTextAvailable: false`, e.g. OCR pending).

### GET /api/documents/:id/related

`RelatedDocument[]`, explicit relationships first, then `SIMILAR` (content similarity). `reason`
is a short human-readable explanation. AI-suggested links carry basis `ai_suggested` in
`DocumentDetail.relationships` and must be labeled as such in the UI.

```json
[{ "document": { "id": "doc_00000000000000bb", "title": "Example Minutes, January 5, 2099" }, "relationshipType": "ADOPTED_DURING", "reason": "Minutes of the meeting where this ordinance was adopted." }]
```

### GET /api/meetings, GET /api/meetings/:id

List params: `body` (government body id), `year`, `sort` (`date_desc` default | `date_asc`), `page`,
`pageSize`. Returns `Paginated<MeetingSummary>` (`agendaItemCount`, `hasVideo`, `hasAudio`,
`hasTranscript`). Detail returns `Meeting` with `agendaItems` (nested `children`, `motions` with
`voteRecord` exactly as recorded — never inferred) and `media`.

### GET /api/bodies, GET /api/bodies/:id

`GovernmentBody[]` / `GovernmentBody` (councils, commissions, boards, agencies, committees).

### GET /api/categories

`Category[]` — browse collections with `documentTypes` roll-up and `documentCount`.

### GET /api/browse/facets

`BrowseFacets` — `years`, `documentTypes`, `governmentBodies`, `categories`, `sources`, `subjects`
buckets (`{ value, label, count }`) over the canonical archive.

### GET /api/sources, GET /api/sources/:id

`SourceRegistryEntry[]` with `health` (`SourceHealth`: `active | degraded | unreachable | changed |
authentication_required | blocked | unknown`, `lastCheckedAt`, `lastSuccessfulCheckAt`) and
`documentCount`. Built from `config/source-seeds.json` + `data/source-health.json`
(`npm run source-health`).

```json
[{
  "id": "example-source",
  "name": "Example Records Portal",
  "baseUrl": "https://records.example.org/",
  "sourceType": "document_library",
  "authority": "Example Town",
  "discoveredFrom": null,
  "crawlEnabled": true,
  "archiveEnabled": true,
  "documentDiscoveryEnabled": true,
  "lastChecked": "2099-02-08T12:00:00.000Z",
  "notes": "",
  "health": { "status": "active", "lastCheckedAt": "2099-02-08T12:00:00.000Z", "lastSuccessfulCheckAt": "2099-02-08T12:00:00.000Z" },
  "documentCount": 1
}]
```

### GET /api/stats

`ArchiveStatistics`: `documentsIndexed`, `pagesIndexed`, `meetingsIndexed`, `earliestRecordDate`,
`latestRecordDate`, `archiveLastUpdatedAt`, `sourcesMonitored`, `sourcesHealthy`, `ocrPendingCount`,
`isDemo: false`. All numbers are computed from the index, never estimated.

### GET /api/suggestions

`SuggestedQuery[]` — curated starter questions/searches (`mode: "ask" | "search"`, optional `filters`).
Suggestions must be answerable from indexed records.

### GET /api/topics, GET /api/topics/:id

`Topic[]` / `TopicDetail` (`timeline: TimelineEvent[]`, `documentIds`). Every `TimelineEvent` has at
least one `EvidenceRef`. Topics are public-record subjects (projects, programs, streets, places,
organizations) — never private individuals.

### GET /api/code

`CodeNode[]` — municipal code tree (title → chapter → section → subsection). Every node carries
`currency`; text of a node whose currency is `unknown` must be labeled as such. `history` links
amendments to ordinances when the ordinance number is printed in the code's history note.

### POST /api/reports

Request (`IssueReport`) — no personal information is collected:

```json
{
  "issueType": "incorrect_citation",
  "description": "Citation [2] points to page 3 but the quoted text is on page 4.",
  "context": { "documentId": "doc_0123456789abcdef", "askResponseId": "ask_7f3a9c01", "citationIndex": 2, "pageUrl": "https://portal.example.org/ask" }
}
```

- `description` ≤ 2000 characters. The server stores only these fields (no IP address, no user agent).
- Response **201** `IssueReportReceipt`: `{ "id": "rpt_00000001", "receivedAt": "2099-02-01T12:00:00.000Z", "status": "received" }`.
- Rate limited per client (429 `rate_limited`).

### GET /api/health

```json
{ "status": "ok", "search": true, "ai": false, "checkedAt": "2099-02-01T12:00:00.000Z", "message": "Answer model not configured (search-only)." }
```

`status`: `ok | degraded | backend_not_connected | offline`. When the Worker has no `API_ORIGIN`, it
answers itself with `{ "status": "backend_not_connected", "gateway": "cloudflare-worker", "checkedAt": "…" }`
(HTTP 200) so the UI can distinguish "backend not deployed yet" from "network down". The frontend
fills `mode: "api"` itself.
