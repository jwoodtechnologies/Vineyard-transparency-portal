# Indexing Architecture

How public records move from government websites into a searchable, citable archive. The design is
**deterministic first**: every step that can be done with rules (hashing, dedupe, dates, document
numbers, chunking, full-text ranking) is done with rules, and AI is an optional, clearly labeled
layer on top. The portal must work with zero paid services.

## Pipeline

```
SOURCE DISCOVERY ─► DOCUMENT DISCOVERY ─► DOWNLOAD ─► HASH ─► DUPLICATE DETECTION ─► STORAGE
      ─► TEXT EXTRACTION ─► OCR IF NECESSARY ─► METADATA EXTRACTION ─► CLASSIFICATION ─► CHUNKING
      ─► FULL TEXT INDEX ─► SEMANTIC INDEX ─► RELATIONSHIP EXTRACTION ─► VALIDATION ─► PUBLISH
```

| Stage | Implementation | Status |
| --- | --- | --- |
| Source discovery | `npm run discover-sources` → `scripts/lib/discover.ts` | Implemented; tested against a fictional fixture site. Must be run where the network allows (see [SOURCE_DISCOVERY.md](SOURCE_DISCOVERY.md)). |
| Document discovery | `npm run discover-documents` → `scripts/adapters/*` | Implemented; adapters for SuiteOne, PMN, Transparent Utah, State Auditor and municipal code are **unverified** against the live sites ([SOURCE_ADAPTERS.md](SOURCE_ADAPTERS.md)). |
| Download | `scripts/lib/ingest.ts` via `scripts/lib/http.ts` | Implemented |
| Hash | SHA-256 (`scripts/lib/hash.ts`) | Implemented |
| Duplicate detection | `scripts/lib/dedupe.ts` | Implemented |
| Storage | `StorageProvider` (`scripts/lib/storage/`) | Local filesystem implemented; S3-compatible documented stub |
| Text extraction | pdf.js (`scripts/lib/pdf.ts`); UTF-8 for CSV/TXT; HTML→text for notice pages | Implemented. DOCX/XLSX/PPTX: archived for download, text extraction not yet implemented. |
| OCR if necessary | `OcrProvider` (`scripts/lib/ocr.ts`) | Detection implemented (flags `ocrRequired`); OCR itself is a future step (no-op provider) |
| Metadata extraction | `scripts/lib/metadata.ts` | Implemented (titles, dates, document numbers, type) |
| Classification | deterministic rules + `DocumentClassifier` (`scripts/lib/classifier.ts`) | Rules implemented; AI classifier is a no-op by default |
| Chunking | `scripts/lib/chunk.ts` | Implemented |
| Full-text index | `npm run reindex` → SQLite FTS5 (`scripts/lib/indexer.ts`) | Implemented (JSON fallback when `node:sqlite` is missing) |
| Semantic index | `EmbeddingProvider` (`scripts/lib/embeddings.ts`) | Interface only; disabled by default |
| Relationship extraction | `referencedDocumentNumbers` captured at ingest; `DUPLICATE_OF` links created | Partial: explicit-reference/structure links are future work |
| Validation | `npm run validate-archive` → `scripts/lib/validate.ts` | Implemented |
| Publish | Phase 2 API serves `data/index.sqlite` + stored files per [API_CONTRACT.md](API_CONTRACT.md) | Backend not in this repo yet |

Typical run:

```bash
npm run discover-sources      # where the network allows access to the government hosts
npm run discover-documents
npm run ingest -- --limit 50  # start small; re-runs are idempotent
npm run reindex
npm run validate-archive
npm run source-health
```

## Stage details

### Download

- Shared polite client: descriptive User-Agent, robots.txt (RFC 9309), per-host delay
  (`crawlPolicy.requestDelayMs`, Crawl-delay honoured up to `maxCrawlDelayMs`), per-attempt timeout,
  retries with exponential backoff and `Retry-After`, manual redirects (max 10 hops, chain recorded).
- Only approved hosts (or hosts explicitly flagged by discovery as directly linked from an approved
  page) are downloaded; denied domains never are. `--include-unapproved-hosts` exists for reviewed
  exceptions.
- Hard size limit (`crawlPolicy.maxDocumentBytes`, default 200 MB): a declared `Content-Length`
  above the limit is refused before reading; streaming bodies are aborted at the limit.
- Content checks: the declared type, the extension and the magic bytes must agree on an archivable
  kind (`fileExtensions[*].archivable`). A "PDF" whose bytes do not start with `%PDF-` is rejected.
  An HTML response to a document link (viewer, login or error page) is skipped. Archives (ZIP),
  images, audio and video are not downloaded.

### Hash and duplicate detection

SHA-256 of the exact bytes. Against `data/archive/manifest.json`:

1. same hash → existing record, new `DocumentSource` (or re-verification of the same URL);
2. same normalized URL, new hash → **new version** (`changeStatus: "replaced"`);
3. same document number + type / file name + size / title + date → **probable duplicate**, stored
   separately with `duplicateOf` and a `DUPLICATE_OF` relationship for review; search collapses it.

URL normalization (lower-case host, no fragment, tracking params removed, sorted query, default port
removed, trailing slash rule) is described in [SOURCE_DISCOVERY.md](SOURCE_DISCOVERY.md#url-normalization).

### Storage

`StorageProvider` (`put/get/stat/list/describe`) with content-addressed keys
`documents/<first 2 hex>/<sha256>/<sanitized file name>`:

- idempotent writes; a key can never be overwritten with different bytes (so versions are immutable);
- keys are validated (no `..`, absolute paths, backslashes or control characters) and the local
  provider additionally checks the resolved path stays under its root;
- `LocalFilesystemStorage` writes `data/archive/files/` atomically (temp file + rename);
- `S3CompatibleStorage` documents the move to Cloudflare R2 / Backblaze B2 / MinIO / S3 (SigV4 via
  `fetch` + `node:crypto`, or an S3 client), using the same keys so stores can be synced.

### Versioning

Versions are append-only. The record's text, chunks and metadata follow the current version; older
versions stay downloadable at `/api/documents/:id/file?version=n`. A URL that later returns 404/410
should be marked `originalAvailable: false` / `removed_at_source` by a link-check job — the archive
copy is kept.

### Text extraction and OCR

- PDFs: `pdfjs-dist` legacy build in Node, bytes in memory (no network), XFA disabled, no font-face
  injection, per-page text with line/paragraph reconstruction from text-item positions.
- A document is flagged `ocrRequired` (status `pending`) when ≥30% of pages have fewer than 40
  non-whitespace characters or the average is under 100 characters/page.
- OCR plan: implement `OcrProvider` with Tesseract (self-hosted; render pages via pdf.js +
  `@napi-rs/canvas` or `pdftoppm`) or OCRmyPDF, set `DocumentPageText.ocr = true` and
  `Document.ocrConfidence`, then re-chunk and reindex. OCR text is labeled in the UI.

### Metadata extraction (deterministic)

- **Title**: explicit link/adapter title → PDF metadata title (ignoring "Untitled", "Microsoft Word –
  …") → first substantial line of page 1 → file name.
- **Type**: adapter hint → title keywords → first-page keywords → `other`.
- **Document number**: `Ordinance|Resolution|Ord.|Res.` + optional `No./Number/#` + `YY-N` or
  `YYYY-N[A]`, normalized to `Ordinance 2026-07`, assigned only if printed in the title/first page
  and matching the type. All other numbers become `referencedDocumentNumbers`.
- **Date**: meeting date (adapter) → date in link text → first date on page 1. Month-name, ISO and
  U.S. `M/D/YYYY` formats; impossible dates rejected.
- **Currency**: always `unknown` at ingest.

### Classification

Deterministic `categoriesForType()` maps types to browse collections. An optional
`DocumentClassifier` (no-op by default) may suggest a type only when rules produced `other`, and
tags; it never overrides printed identifiers, and its suggestions are recorded in
`ingest.warnings`.

### Chunking

Page-aware, heading-aware chunks: target ~650 tokens, hard max 800, ~80-token overlap, split at
paragraph → sentence → word boundaries (never mid-word), headings detected per line
("SECTION 2.", "Chapter 15.04", "§ 15.04.010", "4. Consent Agenda", short ALL-CAPS lines). Each chunk
records `pageStart/pageEnd` so citations point to pages.

### Full-text index (SQLite FTS5)

`data/index.sqlite` is rebuilt from records into a temp file and atomically renamed:

- `documents`, `document_sources`, `versions`, `pages`, `chunks`, `relationships`, `sources`, `meta`
- `chunks_fts(text, section_title, title, document_number)` and
  `documents_fts(title, document_number, description)`, tokenizer
  `porter unicode61 remove_diacritics 2` (stemming: "dates" matches "date").
- Ranking: `bm25(chunks_fts, 1.0, 2.0, 4.0, 8.0)` — document-number and title matches outrank body
  matches; `snippet()` provides highlighted excerpts.
- User input is converted to a safe MATCH expression (every token double-quoted) so FTS syntax typed
  by users cannot inject operators; `match=any|all|phrase` map to OR / implicit AND / phrase.
- Verified here: Node 22.22's built-in `node:sqlite` includes FTS5.

**Scale (20k+ documents).** 20,000 documents × ~15 pages × ~2 chunks/page ≈ 600k chunks — comfortably
within SQLite FTS5 (single file, a few GB with text, millisecond queries). The per-record JSON
archive and manifest scale to that size; ingest is resumable because every step is idempotent.
Beyond that, or with concurrent writers, move the same schema to **PostgreSQL** (`tsvector` +
GIN indexes with `ts_rank_cd`, `pg_trgm` for fuzzy titles) and keep `StorageProvider` on object
storage. The API contract does not change.

### Semantic index (optional, self-hosted)

`EmbeddingProvider` (`id`, `model`, `dimensions`, `embed(texts)`) is disabled by default
(`EMBEDDING_PROVIDER` unset). Self-hostable options:

- a small sentence-transformers-class embedding model (MiniLM / bge-small / e5-small / nomic-embed
  class) served locally by text-embeddings-inference, Ollama, or llama.cpp's server;
- vectors in **sqlite-vec** (same `index.sqlite`), **pgvector** (with PostgreSQL), or **LanceDB**;
- `DocumentChunk.embeddingReference` stores `<provider>:<model>:<row>`; re-embed when the model changes.

### Hybrid retrieval

Queries run against the full-text index (always), the semantic index (if configured), and metadata
(document number / date / type detection). Result lists are merged with **reciprocal rank fusion**
(`score = Σ 1/(60 + rank)`, implemented as `reciprocalRankFusion()` in `scripts/lib/indexer.ts`),
which needs no score calibration between retrievers. Exact document-number matches are pinned first.
Probable duplicates are collapsed to their canonical record.

### Relationship extraction

Deterministic first: explicit references in text (`referencedDocumentNumbers` → `REFERENCES`,
"amends Ordinance …" → `AMENDS`/`AMENDED_BY`), source structure (attachments on a meeting page →
`ATTACHED_TO`, agenda/minutes of the same meeting → `RECORD_OF`), metadata matches
(`DUPLICATE_OF`). AI-suggested links are stored with `basis: "ai_suggested"` and labeled.

### Validation

`npm run validate-archive` re-hashes every stored version, checks file existence/size, version
sequences, chunk→document links and page ranges, duplicate canonical content, `duplicateOf` targets,
provenance completeness, OCR state consistency, manifest freshness and orphan files. Non-zero exit on
errors, so it can gate publishing in CI.

### Publish

The Phase 2 API reads `data/index.sqlite` (read-only) and the storage provider, and implements
[API_CONTRACT.md](API_CONTRACT.md). The frontend is a static SPA on Cloudflare
([CLOUDFLARE_DEPLOYMENT.md](CLOUDFLARE_DEPLOYMENT.md)) that proxies `/api/*` to the backend.

## Operations

- Schedule: `discover-documents` + `ingest` + `reindex` + `validate-archive` nightly;
  `discover-sources` weekly (new systems need review); `source-health` hourly or daily.
- Every stage is re-runnable; nothing is deleted automatically.
- Outputs under `data/archive/`, `data/*.sqlite` are git-ignored; publish them to storage, not git.
