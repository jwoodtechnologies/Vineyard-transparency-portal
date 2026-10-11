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

Run by hand (`workflow_dispatch`): `diagnostics.yml` (fixtures, logs, perf timings to the
`diagnostics` branch), `add-e2e.yml` (end to end check of the submit page: pending, approval, reports; removes its own test item),
`backfill.yml` (parallel indexing of the whole archive), and `ingest.yml` with any command
(`run`, `crawl`, `migrate`, `archive-plan`, `archive-apply`, and others).

## Limits

The daily AI cap (8,000 neurons), D1 write budget and R2 6 GB stop are enforced by the Worker. See
[FREE_TIER_LIMITS.md](FREE_TIER_LIMITS.md).
