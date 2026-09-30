# Data Model

The canonical definitions live in [`src/types/models.ts`](../src/types/models.ts) and are shared by
the frontend, the API contract ([API_CONTRACT.md](API_CONTRACT.md)) and the ingestion scripts
(`scripts/lib/types.ts` re-exports them). This document explains the models, how they relate, and
the rules the data must follow.

## Principles

1. **Records, not opinions.** The archive stores public records and facts read from them. Anything
   derived by heuristics is labeled with how it was derived (`basis`, `ocr`, `currency: 'unknown'`).
2. **Provenance is mandatory.** Every document has at least one `DocumentSource` (where and when it
   was retrieved). `validate-archive` fails on documents without provenance.
3. **Nothing is overwritten.** New bytes at a known URL create a new `DocumentVersion`; old versions
   remain downloadable.
4. **Never infer identity.** `documentNumber`, vote tallies and dates are copied as printed, or left
   null.
5. **No private-person dossiers.** There is no `Person` entity. `DocumentEntity.type` is limited to
   `organization | project | place | street | program | government_body | topic`. People appear
   only inside document text and in their public role as recorded (e.g. a motion's `voteRecord`
   string). Topics, timelines and search facets must never be built around a private individual.
6. **Untrusted text.** All text from archived documents is untrusted data: rendered as text, never as
   HTML, never treated as instructions (see [SECURITY.md](SECURITY.md)).
7. **Demo data is labeled.** Built-in mock records set `isDemo: true` and must be presented as demo.

Conventions: `date` fields are `YYYY-MM-DD` calendar dates (America/Denver); `*At` fields are UTC
ISO-8601 timestamps.

## Entity overview

```
SourceRegistryEntry 1───* DocumentSource *───1 Document 1───* DocumentVersion
                                                  │ 1
                                                  ├───* DocumentChunk      (retrieval units)
                                                  ├───* DocumentPageText   (per-page text)
                                                  ├───* DocumentRelationship ──> Document | Meeting | AgendaItem | CodeNode
                                                  └───0..1 Meeting / AgendaItem / GovernmentBody
GovernmentBody 1───* Meeting 1───* AgendaItem 1───* Motion (evidence → Document page)
Topic 1───* TimelineEvent (evidence → Document page)
CodeNode (tree) ── history → ordinance Document
FinanceRecord (separate dataset) ── evidence? → Document
```

## Sources and provenance

### SourceRegistryEntry

A public-record **system** the archive monitors (seeded from `config/source-seeds.json`, extended by
`npm run discover-sources` after human review).

| Field | Notes |
| --- | --- |
| `id`, `name`, `baseUrl` | `baseUrl` is `""` until known (the municipal code entry is intentionally empty until discovered). |
| `sourceType` | `SourceType`: `city_website`, `transparency_portal`, `meeting_portal`, `public_notice_system`, `financial_transparency`, `state_auditor`, `municipal_code`, `document_library`, `gis_portal`, `other`. |
| `authority` | Publishing authority ("Vineyard City", "State of Utah", …). |
| `discoveredFrom` | Page the system was found on; `null` for manually configured seeds. |
| `crawlEnabled`, `archiveEnabled`, `documentDiscoveryEnabled` | Independent switches. Newly discovered systems start with all three `false` until reviewed. |
| `lastChecked`, `notes`, `description` | |
| `health` | `SourceHealth` from `npm run source-health`. |
| `documentCount` | Canonical documents whose primary source is this system. |

`config/source-seeds.json` adds tooling fields (`adapter`, `primary`, `pathPrefix`, `maxDepth`,
`discoveryHints`, `adapterOptions`) — see `SourceSeed` in `scripts/lib/types.ts`.

### SourceHealth

`status`: `active | degraded | unreachable | changed | authentication_required | blocked | unknown`,
plus `lastCheckedAt`, `lastSuccessfulCheckAt` (carried forward when a check fails) and `message`.
Mapping rules are in [SOURCE_ADAPTERS.md](SOURCE_ADAPTERS.md#health-states).

### DocumentSource

One retrieval of a document from one URL. A document found at several URLs (e.g. the city website
and the meeting portal) has several `DocumentSource` rows and **one** canonical `Document`.

| Field | Notes |
| --- | --- |
| `sourceId`, `name`, `baseUrl`, `sourceType`, `authority` | Denormalized from the registry entry at retrieval time. |
| `originalUrl` | Exact URL retrieved. |
| `retrievedAt` | First retrieval from this URL. |
| `lastVerifiedAt`, `originalAvailable`, `httpStatusAtLastCheck` | Updated by re-ingest / link checking; `originalAvailable: false` means the source removed it (the archive copy remains). |

## Documents

### Document

| Group | Fields |
| --- | --- |
| Identity | `id` (`doc_` + 16 hex of SHA-256 of the first normalized URL), `slug`, `title`, `description` |
| Classification | `documentType` (`DocumentType`), `categories` (`CategoryId[]`, derived deterministically from type), `tags`, `entities` (public-record subjects only) |
| Official identifiers | `documentNumber` — only when printed on the record's title/first page (e.g. `Ordinance 2026-07`), normalized to `<Type> <number>`; never inferred |
| Dates | `date` (record date: meeting date, adoption date, or first printed date), `year` |
| Context | `governmentBodyId/Name`, `meetingId`, `agendaItemId` |
| Provenance | `sourceId` (primary source), `originalUrl`, `archiveUrl` (`/api/documents/:id/file`) |
| File | `mimeType`, `fileName` (sanitized), `fileSize`, `pageCount`, `checksum` (SHA-256 of current version), `checksumAlgorithm: 'sha256'` |
| Text/OCR | `extractedTextAvailable`, `ocrRequired`, `ocrStatus` (`not_required | pending | complete | failed`), `ocrConfidence` (0–1 mean, OCR only) |
| Lifecycle | `archivedAt`, `createdAt`, `updatedAt`, `currentVersion` |
| Currency | `currency` (below) |

`DocumentSummary` is the list/search projection; `DocumentDetail` adds `governmentBody`, `meeting`,
`agendaItem`, `sources`, `versions`, `relationships`.

### Currency (`RecordCurrency`)

Whether a record reflects currently operative law or policy — critical for ordinances and the
municipal code.

| Value | Meaning |
| --- | --- |
| `current` | Verified as currently in effect (e.g. the code host states the version's effective date). |
| `amended` | In effect but modified by later records (linked via `AMENDED_BY`). |
| `superseded` | Replaced by a later record (linked via `SUPERSEDED_BY`). |
| `historical` | A point-in-time record or an archived prior version. |
| `unknown` | Not yet established. **Ingest always assigns `unknown`**; only relationship extraction or human review may change it. The UI and the answer model must not describe `unknown` text as current law. |

### DocumentVersion (versioning)

| Field | Notes |
| --- | --- |
| `versionNumber` | 1..n, gap-free (validated). `Document.currentVersion` = latest. |
| `checksum`, `fileSize`, `pageCount`, `retrievedAt`, `sourceUrl` | Per version. |
| `changeStatus` | `original` (v1), `replaced` (same URL, different bytes), `amended` (source marks it as an amended edition), `unchanged`, `removed_at_source` (URL now 404/410; archive copy kept). |
| `archiveUrl` | `/api/documents/:id/file?version=n` |
| `note` | Human-readable explanation. |

Archive records add `storageKey` (content-addressed: `documents/<aa>/<sha256>/<file>`) and
`mimeType` per version (`ArchivedVersion` in `scripts/lib/types.ts`). Because keys are derived from
the SHA-256, a new version can never overwrite a prior one. If a URL reverts to an older version's
bytes, that is recorded as a new `replaced` version pointing at the existing stored file.

### Duplicates

| Signal | Action |
| --- | --- |
| Same SHA-256 | Same record. The new URL is added as another `DocumentSource`. |
| Same normalized URL, different SHA-256 | New `DocumentVersion` of the same record. |
| Same `documentNumber` + `documentType`; same sanitized file name + size; same normalized title + date | **Probable duplicate**: stored as its own record with `duplicateOf = <canonical id>` and a `DUPLICATE_OF` relationship (basis `metadata_match`). Search collapses it into the canonical record; a human reviews. |

### DocumentChunk

Retrieval unit (~500–800 estimated tokens, ~80 tokens overlap), permanently linked to its document.

| Field | Notes |
| --- | --- |
| `id` | `<documentId>:c<4-digit index>` |
| `pageStart`, `pageEnd` | Pages the chunk spans (citations point here). |
| `sectionTitle` | Nearest preceding heading ("SECTION 2. DEFINITIONS", "4. Consent Agenda"). |
| `text`, `tokenEstimate` | Token estimate ≈ characters / 4. |
| `embeddingReference` | `"<provider>:<model>:<row>"` when a semantic index exists, else `null`. |
| `metadata` | `chunkIndex`, `overlapUnits`, `charCount`. |

### DocumentPageText

`{ page, text, ocr }` — per-page extracted text; `ocr: true` when the text came from OCR.

### DocumentRelationship

| Field | Notes |
| --- | --- |
| `relationshipType` | `ADOPTED_DURING`, `ATTACHED_TO`, `AMENDS`, `AMENDED_BY`, `SUPERSEDES`, `SUPERSEDED_BY`, `RELATED_TO`, `RECORD_OF`, `REFERENCES`, `EXHIBIT_OF`, `PART_OF`, `DUPLICATE_OF` |
| `toKind`, `toId`, `toTitle` | Target: `document`, `meeting`, `agenda_item`, `code_section`. |
| `basis` | `explicit_reference` (the text names the target, e.g. "amends Ordinance 2025-3"), `source_structure` (e.g. attachment on a meeting page), `metadata_match`, `manual`, `ai_suggested` (**must be labeled in the UI**). |
| `evidence` | `EvidenceRef` to the page/quote establishing it. |

Ingest records every other document number printed in a record (`referencedDocumentNumbers` in the
archive record) so relationship extraction can create `REFERENCES`/`AMENDS` links deterministically.

## Meetings

- **GovernmentBody** — council, commission, board, agency, committee, department. Counts and first/last record dates are computed.
- **Meeting** — `meetingType`, `date`, `startTime`, `location`, `status`, `agendaDocumentId`,
  `packetDocumentId`, `minutesDocumentId`, `minutesStatus` (`approved | draft | not_available`),
  `media` (`MeetingMedia`: video/audio/transcript links with `sourceId`), `agendaItems`, `sourceIds`.
  Meeting ids from source systems are **read from real links**, never generated or incremented.
- **AgendaItem** — `number`, `title`, `itemType`, `documentIds`, nested `children`,
  `packetPageStart/End` (where the item's materials sit in the packet), `motions`.
- **Motion** — `outcome` and `voteRecord` exactly as recorded in the minutes (`null` if not recorded;
  never inferred), with `evidence`.

## Evidence and citations

- **EvidenceRef** — `{ documentId, page, chunkId?, quote? }`: the exact place a claim comes from.
  Timeline events, motions and relationships carry evidence.
- **SourceExcerpt** — a passage with `highlights` (`[start, end)` offsets).
- **Citation** — numbered reference used by answers (`index` matches `[n]` in the answer), with the
  document's identifiers, meeting context, page, section, excerpt, `archiveUrl` and `originalUrl`.

## Search and ask

`SearchRequest`/`SearchFilters`/`SearchResponse` (with `facets`, `retrieval`, `interpretation`)
and `AskRequest`/`AskResponse` (`retrievalStatus`: `grounded | partial | no_results | ai_unavailable
| search_only`, structured `paragraphs` of `AnswerSegment { text, citations }`) are specified in
[API_CONTRACT.md](API_CONTRACT.md) and [RAG_DESIGN.md](RAG_DESIGN.md).

## Topics and timelines

`Topic` (project, program, street, place, organization, topic) and `TopicDetail.timeline`
(`TimelineEvent` with `datePrecision` day/month/year and **mandatory** `evidence`). Topics are
public-record subjects only.

## Municipal code

`CodeNode` tree (`title | chapter | section | subsection`) with `currency`, `effectiveDate`,
`history` (`CodeSectionHistoryEntry`: enacted/amended/repealed/renumbered with the ordinance number
and document id when printed), `sourceUrl`, `sourceId`. Text is shown only with its currency label.
The discovery tooling emits a `CodeOutlineEntry` (level, number, heading, url, `currency: 'unknown'`)
until the code source is configured and verified.

## Finance (separate from document search)

`FinanceRecord` rows (fiscal year, fund, department, category, vendor, amount, transaction type,
date, `sourceId`, `sourceUrl`, `retrievedAt`, optional `evidence` pointing to a corroborating
document) are a **structured dataset**, loaded from official bulk downloads (e.g. Transparent Utah)
in a future pipeline. They are not chunked into document search and are not produced by the current
adapters, which only discover report *files*. Amounts are stored exactly as published.

## Reporting and health

- **IssueReport** — `issueType`, `description`, `context` (document/answer/citation ids, page URL).
  No personal information fields exist.
- **HealthStatus** — `ok | degraded | backend_not_connected | offline`, with `search`/`ai` flags.
- **ArchiveStatistics** — computed counts; `isDemo` must be true for mock data.

## Archive record (on disk)

`npm run ingest` writes one JSON file per document at `data/archive/records/<id>.json`
(`ArchiveRecord` in `scripts/lib/types.ts`):

```
{ schemaVersion, document, versions[ArchivedVersion], sources[DocumentSource], normalizedUrls[],
  relationships[], pages[DocumentPageText], chunks[DocumentChunk], referencedDocumentNumbers[],
  duplicateOf, ingest{ pipelineVersion, processedAt, textExtractor, classifier, warnings[] } }
```

`data/archive/manifest.json` holds lightweight fingerprints (checksums, normalized URLs, number,
type, file name/size, title, date) for duplicate detection. `npm run reindex` loads records into
`data/index.sqlite` (tables `documents`, `document_sources`, `versions`, `pages`, `chunks`,
`chunks_fts`, `documents_fts`, `relationships`, `sources`, `meta`).

## Phase 2: production D1 schema

Catalog (`migrations/catalog/0001_catalog.sql`, database `vtp-catalog`):

| Table | Purpose |
| --- | --- |
| `sources` | Registry: id, name, base_url, source_type, authority, discovered_from, crawl/archive flags, last_checked_at, last_success_at, status |
| `documents` | id, slug, title, description, document_type, document_number, document_date, year, government_body_id/name, meeting_id, agenda_item_id, mime_type, original_filename, file_size, page_count, sha256, original_url, archive_key, archive_status, text_status, ocr_status, search_shard, chunk_count, created/updated/first_seen/last_seen/archived_at |
| `document_sources` | Every provenance path: document_id, source_id, source_url, canonical_key, parent_url, link_text, retrieved_at, last_verified_at, etag, last_modified, http_status, original_available |
| `document_versions` | id, document_id, version_number, sha256, previous_sha256, source_url, file_size, page_count, retrieved_at, archive_key, change_status |
| `meetings`, `agenda_items`, `government_bodies` | From CivicClerk (meetings, bodies); media are links only |
| `document_relationships` | MEETING_HAS_AGENDA / _MINUTES / _PACKET, AGENDA_ITEM_HAS_ATTACHMENT, RESOLUTION_CONSIDERED_AT, ORDINANCE_CONSIDERED_AT, DOCUMENT_RELATED_TO, DOCUMENT_SUPERSEDES, DOCUMENT_VERSION_OF (mapped to the frontend RelationshipType union by the API). Only created from source structure. |
| `crawl_runs`, `crawl_queue`, `ingestion_errors` | Resumable crawl state and error log |
| `archive_stats`, `quota_usage` | Stored R2 bytes; per-UTC-day D1 rows written, R2 bytes, AI requests |
| `issue_reports` | Reader reports (submitted fields only) |

Status vocabularies: `archive_status` = archived | not_archived | quota_deferred |
remote_only_large_file | failed; `text_status` = pending | extracted | empty | unsupported | failed;
`ocr_status` = not_required | needed | complete | failed (API maps `needed` → `pending`).

Search shard (`migrations/search/0001_search.sql`): `shard_documents`, `chunks` (id, document_id,
page_start, page_end, section_title, text, character_count, ocr, created_at) and the FTS5
external-content table `chunks_fts`. Binaries are never stored in D1.

Identity: `doc_` + first 16 hex of SHA-256(`vtp:` + canonical source key), assigned when a record is
first seen. Duplicate detection is by SHA-256 of the bytes: a known hash at a new URL adds a
`document_sources` row and no new binary.
