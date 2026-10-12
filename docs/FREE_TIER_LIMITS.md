# Plan limits and safeguards

The account is on Workers Paid ($5/month, shared with the owner's other projects). The project must
cause zero overage: every guard keeps usage inside the plan's included amounts and fails closed. The one
approved exception is R2 storage for the public record files (approved by Jacob on 2026-10-12, at most about
$0.75 a month; see "R2 storage past the free tier"). Workers usage remains zero overage.

| Included (Workers Paid, per account) | Project setting |
| --- | --- |
| Workers AI: 10,000 Neurons/day | Two buckets per UTC day (worker/ai/meter.ts): `AI_NEURONS_PUBLIC_PER_DAY=9000` for residents and `AI_NEURONS_TESTS_PER_DAY=1000` for the chat suite (requests with `x-vtp-suite: 1`). The public cap is clamped to 10,000 minus the tests cap, so the total never passes 10,000. Every model call is estimated before it runs and reserved with one conditional write. At the public cap Ask answers from the records until 00:00 UTC (6 PM Mountain in summer, 5 PM in winter); at the tests cap only suite answers lose the model. Usage by spender: `/api/health` `aiNeurons` and the owner panel |
| D1 rows written: 50 million/month | `MAX_D1_INGEST_ROWS_PER_DAY=1000000` |
| D1 storage: 5 GB | `SEARCH_SHARD_MAX_BYTES=2000000000` per shard (2 shards) |
| Workers CPU: 30 million ms/month | `limits.cpu_ms=120000` per invocation; five-minute ticks stop new work after 3.5 minutes |
| R2: 10 GB-month storage (every bucket on the account together) | **Paid storage approved.** Jacob approved storing every public record file in R2 past the free 10 GB on 2026-10-12 (see "R2 storage past the free tier" below). `ARCHIVE_STORAGE_HARD_STOP_BYTES=60000000000` (60 GB), never above `ARCHIVE_STORAGE_CEILING_BYTES=60000000000`: worst case about $0.75 a month for this bucket. Archive policy (worker/lib/archivePolicy.ts): minutes, agendas, ordinances, resolutions, notices, budgets and audits first, newest first; other files stop `ARCHIVE_PRIORITY_RESERVE_BYTES=500000000` below the stop so new priority records always find room. Each `run` queues files not stored yet in that order (`POST /api/admin/archive/fill`, up to 1,000 a run). `archive-size` prints what is left and what storing all of it costs |
| R2 Class A operations: 1 million/month | One write per file up to 25 MiB; a larger file takes one per 20 MiB part plus two (create, complete). Storing every remaining file takes about 4,000 writes, well under 1 million |

## R2 storage past the free tier

On 2026-10-12 Jacob approved keeping every public record file in the portal's own bucket (`vtp-public-records`),
past the free 10 GB-month and including the files over 25 MB. This is the only paid usage the project causes:
Workers requests, Workers CPU, D1 and Workers AI stay inside the plan's included amounts, with zero overage.

* What was left then (`archive-size`): 599 files (1.50 GB) under the old 7.5 GB stop, 1,978 files (3.15 GB) past
  it, and 318 files (26.24 GB) over 25 MB. Storing all of it puts about 38.6 GB on the account (with the other
  buckets' ~1.7 GB): about 28.6 GB beyond the free 10 GB, about $0.43 a month at $0.015 per GB-month.
* The stop is `ARCHIVE_STORAGE_HARD_STOP_BYTES=60000000000` (60 GB), enough for all of it plus years of new
  records. It can never pass `ARCHIVE_STORAGE_CEILING_BYTES=60000000000`, and the code caps that ceiling at
  100 GB whatever it is set to. Worst case for this bucket: (60 - 10) GB x $0.015 = **about $0.75 a month**.
  Raising the stop alone does nothing; going past 60 GB needs the ceiling raised too, a deliberate change.
* Every upload is checked against the stop before it is written (`storeArchive`, and the multipart routes when an
  upload is created and again before it completes). Past the stop a record is `quota_deferred`: its metadata,
  provenance and text are kept and it links to the city's copy.
* Files over 25 MiB (`ARCHIVE_MAX_OBJECT_BYTES`) go up in 20 MiB parts (R2 multipart, `/api/admin/archive/multipart/`,
  same GitHub OIDC authentication as every admin route), since a Worker request body is limited. Files over
  500 MB (`ARCHIVE_MAX_LARGE_OBJECT_BYTES`) are not stored; they are linked and logged. Text is not extracted
  from files over 150 MB (the file itself is stored and served).
* `/api/documents/:id/file` streams the stored object from R2 and answers `Range` requests with only those bytes,
  so a 500 MB packet is never held in memory and the viewer can open it page by page.

### How long the backlog takes

About 2,300 files (about 29 GB) were past the old stop or over 25 MB. Each nightly `run` puts up to 1,000 of them
back on the queue (priority records first, newest first) and stores them inside its 5-hour ingest window; the
ten-minute runs and the Worker's own five-minute sync drain the same queue in between. At roughly 5 to 10 seconds
per file plus about a minute per GB of transfer, the nightly run alone finishes in **about 3 nights**. To go faster,
run Actions, Ingest public records, command `archive-fill` (hours 4): each run queues the next 1,000 files and
stores them for up to 4 hours, and can be run again as soon as it ends. Two or three of them finish the backlog in
about a day. R2 Class A writes for all of it: about 4,000 (free: 1 million a month).

The table below is the original free-plan design, kept for reference.

| Service | Free allowance (Workers Free) | Project safeguard |
| --- | --- | --- |
| Workers requests | 100,000/day | Static assets do not invoke the Worker (`run_worker_first: /api/*`). Ingestion uses ~3-4 requests per document. |
| Workers CPU | 10 ms/request | Worker does no parsing of documents; JSON bodies ≤ 2 MB; uploads are streamed to R2. |
| D1 rows written | 100,000/day | `MAX_D1_INGEST_ROWS_PER_DAY=75000`, counted from D1's own `rows_written` for every ingestion statement (`quota_usage`). At the limit the API returns 429 `quota_exhausted`, the run saves progress and reports "Daily free-tier ingestion budget reached. Resume next UTC quota period." |
| D1 rows read | 5,000,000/day | FTS5 index lookups, candidate cap of 400 chunks per shard, counts only when needed. |
| D1 storage | 500 MB/database, 5 GB/account, 10 databases | Catalog and search shards separated; add shards before 400 MB (SEARCH.md). 2 of 10 databases used by this project (1 pre-existing). |
| R2 storage | 10 GB-month | Now `ARCHIVE_STORAGE_HARD_STOP_BYTES=60000000000` with the ceiling `ARCHIVE_STORAGE_CEILING_BYTES=60000000000` (paid storage approved by Jacob on 2026-10-12; was 6 GB, then 7.5 GB inside the free 10 GB). Projected size is checked before every upload; over the limit the document is `quota_deferred` (metadata, provenance and text are kept). The threshold is never raised automatically. |
| R2 operations | 1M Class A, 10M Class B / month | One PUT per unique binary (content-addressed, duplicates never re-uploaded). |
| Max archived object | project rule | 500 MB (`ARCHIVE_MAX_LARGE_OBJECT_BYTES`); files over 25 MiB (`ARCHIVE_MAX_OBJECT_BYTES`) go up in 20 MiB parts; larger than 500 MB they are `remote_only_large_file`. Video/audio never downloaded. |
| Workers AI | 10,000 neurons/day | `AI_MAX_REQUESTS_PER_DAY=120` (about 70 neurons per answer with `llama-3.1-8b-instruct-fp8`: 13,778 input and 26,128 output neurons per million tokens); errors open a breaker; search-only fallback. |
| GitHub Actions | 2,000 min/month (private repo) | One daily incremental run (usually minutes); manual backfills sized with `limit`/`hours`; `concurrency` prevents overlap. |

## Throughput expectation

With the D1 budget, typical agendas/minutes (a few pages) cost 30 to 80 rows each and large packets
several hundred. Expect roughly 500 to 1,500 documents per day of backfill; 20,000 documents take
a few weeks of daily runs. Incremental days afterwards cost very little.

## Daily check

`npm run stats` (or the workflow with `stats`) shows today's rows written against the budget and
stored archive bytes against the hard stop.

`archive-size` (Actions, Ingest public records, command `archive-size`; reads only) prints every file not stored
on the portal yet: counts and bytes by type (unknown sizes estimated from the average known size of the same
type, and labelled as estimates), what fits under the stop, and the monthly cost of storing all of it beyond the
free 10 GB at $0.015 per GB-month. One upload is one Class A write; the free allowance is 1 million a month.
