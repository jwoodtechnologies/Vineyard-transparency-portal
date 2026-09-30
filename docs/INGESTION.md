# Ingestion pipeline

```
DISCOVER SOURCES   python -m ingest sources:discover   live transparency page → data/sources.manifest.json
DISCOVER RECORDS   python -m ingest crawl              adapters → D1 crawl_queue (new/changed URLs only)
CHECK CATALOG      (server)                            known URL? known hash? ETag/Last-Modified?
DOWNLOAD           python -m ingest ingest             polite client, conditional GET, streaming SHA-256
HASH / DEDUPE      (server)                            same bytes elsewhere → extra provenance row only
ARCHIVE            PUT /api/admin/archive/<sha256>     R2, content-addressed, hard stop enforced
EXTRACT            pdftotext / python-docx / openpyxl  page boundaries kept; scans flagged for OCR
PARSE METADATA     ingest/classify.py                  unknown stays NULL
CHUNK              ingest/chunk.py                     never crosses a page
WRITE METADATA     POST /api/admin/documents
WRITE FTS          POST /api/admin/documents/:id/chunks  one D1 transaction per batch
VERIFY             python -m ingest verify             consistency + live test searches
```

Heavy work (downloads, PDF parsing, OCR) runs in GitHub Actions or on a workstation, never in the Worker.

## Commands

| npm | Python | Purpose |
| --- | --- | --- |
| `npm run sources:discover` | `python -m ingest sources:discover` | Inventory every link on the live portal page (and one level of linked department pages); sync the source registry |
| `npm run crawl` | `python -m ingest crawl` | Queue document URLs from every enabled source |
| `npm run ingest -- --limit 25` | `python -m ingest ingest --limit 25` | Process queued documents |
| `npm run ingest:resume` | `python -m ingest ingest:resume` | Same as ingest; the queue is the resume point |
| `npm run ingest:retry` | `python -m ingest retry-errors` | Put failed items back to pending |
| `npm run index` | `python -m ingest index` | FTS5 `optimize` (merge index segments) after big batches |
| `npm run verify` | `python -m ingest verify` | Catalog/shard consistency and test searches on real indexed words |
| `npm run stats` | `python -m ingest stats` | Archive stats, today's D1/R2 usage, queue counts |
| `npm run db:migrate` | `python -m ingest migrate` | Apply the D1 schema (idempotent) |

`run` = crawl + ingest in one go (what the daily schedule uses).

## Running it

**GitHub Actions** (recommended): Actions > *Ingest public records* > Run workflow. Choose the
command and a limit. Start with `run` and limit `25`, check `verify`, then raise the limit. The
workflow authenticates with a short-lived OIDC token for audience `vineyardportal.org`; the Worker
only accepts tokens from this repository's `main` branch.

**Local**: `pip install -r requirements-ingest.txt`, install `poppler-utils` (and optionally
`tesseract-ocr`), set `VTP_INGEST_TOKEN` to the Worker secret, then `npm run crawl && npm run ingest`.

## Resumability

State lives in D1: `crawl_queue` (one row per document URL, status `pending | done | unchanged |
error | skipped | deferred`, attempts, next attempt, ETag, Last-Modified, hash), `crawl_runs`
(counters, last processed URL, status `completed | budget_reached | failed | interrupted`) and
`ingestion_errors` (URL, source, time, HTTP status, error type, retry count). Any stop (network,
runtime limit, 429, D1 budget, manual cancel) leaves unprocessed rows `pending`; the next run picks
them up. Errors back off exponentially (2^attempts hours, max 72 h, max 5 attempts; `retry-errors`
resets them).

## Politeness and boundaries

* User agent `VineyardTransparencyPortal/1.0 (+https://vineyardportal.org/about)`.
* robots.txt honored per origin (including Crawl-delay); 429/5xx honored with `Retry-After` and
  exponential backoff; about 1 request per second per domain, at most 2 in flight.
* Only allowlisted hosts are followed: the city website's record-listing sections and the CivicClerk
  API. Social media, CMS login, calendar/forms, jobs and unrelated sites are never fetched.
* Nothing behind a login, CAPTCHA or access control is ever accessed.

## Change detection

* Revize document links carry `?t=<timestamp>`; the timestamp is dropped from the identity key but a
  new value re-queues the URL.
* Known URLs are fetched with `If-None-Match` / `If-Modified-Since`; 304 costs one queue update.
* A known URL that returns different bytes creates **a new version** (old hash and archive key kept).
* A 404/410 marks the provenance row `original_available = 0`; the catalog record and any archived
  copy are kept and the UI shows "Archived copy / original source unavailable".

## What gets archived

PDF, DOC/DOCX, XLS/XLSX, CSV, TXT, PPT/PPTX up to 25 MB (`ARCHIVE_MAX_OBJECT_BYTES`). Larger files are
still downloaded, hashed and text-indexed, but stored as `remote_only_large_file`. Video and audio are
never downloaded; meetings keep links to their video pages.

## OCR

A PDF where more than half the pages have under 40 characters of text is `ocr_status = needed`
(counted in `/api/stats`). `--ocr` runs Tesseract on those pages (up to 30 per document); OCR text is
stored with `ocr = 1` per chunk and shown as OCR-derived.
