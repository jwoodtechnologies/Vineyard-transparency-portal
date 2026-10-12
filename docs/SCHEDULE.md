# Scheduled jobs

Every job that runs on its own, what it reads, how often, and where its last result shows.

Where results show:
- **Health**: `/api/health`, field `checks` (one entry per job: last success, last error, summary).
- **Sources**: the public `/sources` page and `/api/sources` (last checked, last new record per source).
- **Actions**: the GitHub Actions run log for the workflow.
- **Panel**: the owner panel (Coverage tab, resident submissions log).

## Cloudflare Worker cron (`*/5 * * * *`, `worker/cron.ts`, `worker/sync/run.ts`)

Each five-minute tick has a 3.5 minute budget and runs these in order. The tick at minutes 0 to 4 of
each hour is the hourly tick.

| Job (health id) | Reads | How often | Result |
| --- | --- | --- | --- |
| `civicclerk-dispatch` | Starts the GitHub CivicClerk check | Every 10 minutes, only if the optional `GITHUB_DISPATCH_TOKEN` secret is set | Health |
| `city-pages` | City transparency, construction, RDA, public notices and news pages (versioned copies; linked files queued) | Every 5 minutes | Health; `/construction` "As of" |
| `utah-pmn` | Utah Public Notice Website, entity Vineyard (meetings and notices; attachments queued) | Every 15 minutes | Health, Sources |
| `city-calendar` | City events calendar (next 120 days, one versioned record) | Every 30 minutes | Health |
| `queue` | Fetches, extracts, indexes and archives queued files (up to 6 per tick) | Every 5 minutes | Health |
| `city-crawl` | City website pages, 3 per tick; a full pass counts as a crawl | Every 5 minutes | Health; `lastCrawl` in `/api/health` |
| `votes` | Reads new minutes into voting records | Every 5 minutes (more each hour) | Health; `/votes` |
| `portal-uploads` | Large staff and resident PDFs waiting for full text | Every 5 minutes | Health; Panel |
| `pages` | Rebuilds stored copies of the voting and construction pages after data changes | When data changed | Health |
| `coverage` | Recomputes the coverage report | Once a day (hourly tick) | Panel Coverage tab |
| `civicclerk` | CivicClerk agenda portal API (refuses Cloudflare with 403; kept to notice if that changes) | Hourly | Health |
| `sheriff` | Utah County Sheriff's Office press releases | Hourly | Health, Sources |

## GitHub Actions

| Workflow | What it reads | When | Result |
| --- | --- | --- | --- |
| `ingest.yml` (`run`) | Every source: CivicClerk meetings and files, municipal code, city site documents, Utah County tax rates, Utah County parcels (health), UDOT projects, State Auditor filings | Daily 09:17 UTC | Actions, Sources, Health `lastCrawl` |
| `ingest.yml` (quick) | CivicClerk meetings from the last 30 days and new files, then the file queue | Scheduled every 10 minutes; GitHub runs it every few hours in practice | Actions |
| `ingest.yml` (`gis`) | City GIS records (roads, capital projects, zoning, parks, schools) | Mondays 10:37 UTC | Actions, Sources |
| `ingest.yml` (`backup`) | Catalog backup to R2 | Sundays 11:07 UTC | Actions |
| `ci.yml` | Typecheck, lint, tests, build, Python tests | Every push | Actions |
| `chat-suite.yml` (push) | POST /api/ask on the live site: the 132 cases answered by code, with no model call and no follow-up rewrite | Every push to main, after the deploy is live | Actions; `suite/<run id>/` on the `diagnostics` branch |
| `chat-suite.yml` (daily) | POST /api/ask: every deterministic case plus one of 7 groups of model cases (all 50 once a week) | Daily 22:53 UTC (4:53 PM Mountain in summer, 3:53 PM in winter) | Actions; `diagnostics` branch; Watchdog issue when it fails |
| `doc-check.yml` | Document viewer on phone and desktop for a sample of records | Daily 10:23 UTC | Actions; Watchdog issue when it fails |
| `watchdog.yml` | GET /api/health/jobs and the newest chat suite, document check and ingest runs | Hourly at minute 41, and after each chat suite or document check run | GitHub issues labeled `watchdog` |

Run by hand (`workflow_dispatch`): `diagnostics.yml` (fixtures, logs, perf timings, parcel owner filter counts (task `owner-filter`) to the
`diagnostics` branch), `add-e2e.yml` (end to end check of the submit page: pending, approval, reports; removes its own test item),
`backfill.yml` (parallel indexing of the whole archive), and `ingest.yml` with any command
(`run`, `crawl`, `migrate`, `archive-plan`, `archive-apply`, `archive-size`, `archive-fill`, and others).

## Workers AI budget and the chat suite

Workers AI Neurons are counted per UTC day by spender (`worker/ai/meter.ts`). Residents (`public`) get
9,000 a day; the chat suite (`tests`, requests with the header `x-vtp-suite: 1`) gets 1,000. Together
they never pass the 10,000 included. The day resets at 00:00 UTC: 6 PM Mountain in summer (MDT), 5 PM
in winter (MST).

| Run | Neurons | Bucket |
| --- | --- | --- |
| Chat suite after a push | 0 (code answers only) | tests |
| Chat suite daily, 22:53 UTC | about 590 to 670, at worst 870 to 990 | tests |
| Chat suite by hand, `full=true` | same as daily, from what is left of the day's bucket | tests |

The runner reads `aiNeurons.tests` from `/api/health` and refuses to start (exit 2) when what is left of
the bucket cannot cover the run at worst case cost. When the bucket is spent, suite answers go without
the model and residents are unaffected. The daily run stays late in the UTC day because the Worker's
per-day answer counters (larger model answers, `AI_MAX_REQUESTS_PER_DAY`) are not split by spender. No
other workflow calls `/api/ask` (diagnostics, doc-check, watchdog and add-e2e read other endpoints).

Today's Neurons by spender, each cap and the reset time show in `/api/health` (`aiNeurons`) and on the
owner panel's Activity tab.

## Limits

The daily AI caps (9,000 public, 1,000 tests), D1 write budget and R2 60 GB stop (never past the 60 GB ceiling;
paid R2 storage approved by Jacob on 2026-10-12) are enforced by the Worker. `archive-fill` queues the next 1,000
files not stored yet and stores them for the hours given; run it again to finish the backlog sooner. See [FREE_TIER_LIMITS.md](FREE_TIER_LIMITS.md).
