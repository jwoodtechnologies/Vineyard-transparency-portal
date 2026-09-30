# Free-tier limits and safeguards

The project must cost $0. Nothing here enables billing; every guard fails closed.

| Service | Free allowance (Workers Free) | Project safeguard |
| --- | --- | --- |
| Workers requests | 100,000/day | Static assets do not invoke the Worker (`run_worker_first: /api/*`). Ingestion uses ~3-4 requests per document. |
| Workers CPU | 10 ms/request | Worker does no parsing of documents; JSON bodies ≤ 2 MB; uploads are streamed to R2. |
| D1 rows written | 100,000/day | `MAX_D1_INGEST_ROWS_PER_DAY=75000`, counted from D1's own `rows_written` for every ingestion statement (`quota_usage`). At the limit the API returns 429 `quota_exhausted`, the run saves progress and reports "Daily free-tier ingestion budget reached. Resume next UTC quota period." |
| D1 rows read | 5,000,000/day | FTS5 index lookups, candidate cap of 400 chunks per shard, counts only when needed. |
| D1 storage | 500 MB/database, 5 GB/account, 10 databases | Catalog and search shards separated; add shards before 400 MB (SEARCH.md). 2 of 10 databases used by this project (1 pre-existing). |
| R2 storage | 10 GB-month | `ARCHIVE_STORAGE_HARD_STOP_BYTES=6000000000`. The account's other buckets already use ~1.7 GB, so the suggested 8 GB would leave under 0.4 GB headroom; 6 GB leaves ~2.3 GB. Projected size is checked before every upload; over the limit the document is `quota_deferred` (metadata, provenance and text are kept). The threshold is never raised automatically. |
| R2 operations | 1M Class A, 10M Class B / month | One PUT per unique binary (content-addressed, duplicates never re-uploaded). |
| Max archived object | project rule | 25 MB (`ARCHIVE_MAX_OBJECT_BYTES`); larger files are `remote_only_large_file`. Video/audio never downloaded. |
| Workers AI | 10,000 neurons/day | `AI_MAX_REQUESTS_PER_DAY=120` (about 70 neurons per answer with `llama-3.1-8b-instruct-fp8`: 13,778 input and 26,128 output neurons per million tokens); errors open a breaker; search-only fallback. |
| GitHub Actions | 2,000 min/month (private repo) | One daily incremental run (usually minutes); manual backfills sized with `limit`/`hours`; `concurrency` prevents overlap. |

## Throughput expectation

With the D1 budget, typical agendas/minutes (a few pages) cost 30 to 80 rows each and large packets
several hundred. Expect roughly 500 to 1,500 documents per day of backfill; 20,000 documents take
a few weeks of daily runs. Incremental days afterwards cost very little.

## Daily check

`npm run stats` (or the workflow with `stats`) shows today's rows written against the budget and
stored archive bytes against the hard stop.
