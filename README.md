# Vineyard Transparency Portal

**Search the public record.** Ask a question about Vineyard, Utah and see the records behind the answer.

Live at https://vineyardportal.org. An independent public-records project, not an official website of
Vineyard City. Records shown here come from publicly available government sources.

**The archive is the authority. AI is the interface.** Every chat answer is built from retrieved
records and cites them; votes, budget figures, tax rates and meeting dates are written by code from
the records, not by the model. If AI is unavailable, search still works.

## What it does

- **Ask**: questions answered from the records, with citations, source cards that open pages inside the
  portal, and follow-ups that carry the conversation.
- **Records** (`/records`): topic tiles with counts and newest dates; clean titles with Draft or Adopted
  chips; numbered indexes of ordinances, resolutions and RDA resolutions by year; search from every
  page header with filter chips; RSS feeds (`/feeds/records.xml`, `/feeds/meetings.xml`).
- **Meetings** (`/meetings`): calendar from the city's agenda portal (CivicClerk), the state Public
  Notice Website and the city events calendar; agendas, packets, minutes and video.
- **Voting records** (`/votes`, `/planning`): every recorded motion with each member's vote, the
  recorded tally, absent and not-yet-seated marks, CSV download.
- **Budget** (`/budget`): fiscal 2027 adopted budget by fund and department, revenue, sales tax and
  every budgeted capital project with its funding vote and related records.
- **Construction** (under the map, `/map#projects`; `/construction` redirects there): every funded project as a card
  (amount, stage, Details for its votes and records) and the city construction page's table, read every five minutes and kept
  by version.
- **Map** (`/map`): city GIS layers, Utah County parcels (owner shown on the parcel card only for companies,
  churches, HOAs and government, never for individuals or a business-held home) and aerial imagery, UDOT projects.
- **Submit a public record** (`/add`): residents can submit a document, project, note or link. Nothing
  is public until the owner approves it in the panel; approved items are labeled "Resident submitted.
  Not a city record." and kept apart from official records. Adding records directly is staff only (panel).
- **Sources** (`/sources`): every outside system the portal reads, with last check and last new record.

## How it runs

| Part | Where | Notes |
| --- | --- | --- |
| Site and API | Cloudflare Worker `vineyard-transparency-portal` (`worker/`), static assets from `dist/` | Workers Paid plan shared with other projects; limits set to stay inside included usage |
| Catalog | D1 `vtp-catalog` (records, meetings, votes, sources, page copies) | |
| Search | D1 FTS5 shards `SEARCH_DB_0`, `SEARCH_DB_1` | |
| Archive | R2 `vtp-public-records`, hard stop at 6 GB | Priority types first (minutes, agendas, ordinances, resolutions, notices, budgets, audits) |
| Chat | Workers AI, metered to 9,000 neurons a day for residents and 1,000 for the chat suite | |
| Scheduled work | Worker cron every 5 minutes, plus GitHub Actions | See [docs/SCHEDULE.md](docs/SCHEDULE.md) |
| Ingest | Python in `ingest/`, run by `.github/workflows/ingest.yml` | Reaches sites that refuse Cloudflare (CivicClerk) |

Deploys: every push to `main` is built and deployed by Cloudflare Workers Builds.

## Staff panel

A private panel at an unlinked path. The owner signs in with email and password (passkeys optional).
The owner can invite uploaders with a one-time link; uploaders sign in with a passkey and can add and
edit their own records. The panel shows activity, resident submissions with remove and pause, and the
coverage report (missing numbers, meetings missing files, undated records, records with no text).
See [docs/PANEL.md](docs/PANEL.md).

## Development

```bash
npm install
npm run dev            # http://localhost:5173 (reads /api)
npm run check          # typecheck, lint, tests
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run typecheck` / `npm run lint` / `npm test` | Checks (Vitest) |
| `npm run cf:dev` / `npm run cf:deploy` | Run or deploy the Worker |
| `npm run ingest` / `npm run test:ingest` | Python ingest and its tests |

Diagnostics from GitHub's network (the city site refuses most automated clients) run through
`.github/workflows/diagnostics.yml`; output lands on the `diagnostics` branch.

## Project layout

```
src/console/          Route screens and their components (routes in src/app/router.tsx)
src/lib/              Record titles and topics, text, formatting, local storage
src/services/, src/data/adapters/   API client
worker/               Worker: API, search, chat (ai/), scheduled sync (sync/), admin and panel
ingest/               Python ingest (crawl, extract, index) and state sources
migrations/           D1 schema
scripts/              Performance and chat regression runners
docs/                 Architecture, API, data model, sources, schedule, limits, security
tests/                Vitest suites (Python tests in ingest/tests)
```

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Schedule](docs/SCHEDULE.md) · [Sources](docs/SOURCES.md) ·
[Ingestion](docs/INGESTION.md) · [API](docs/API.md) · [Data model](docs/DATA_MODEL.md) ·
[Search](docs/SEARCH.md) · [Chat](docs/AI_RAG.md) · [Usage limits](docs/FREE_TIER_LIMITS.md) ·
[Panel](docs/PANEL.md) · [Security](docs/SECURITY.md) · [Deployment](docs/CLOUDFLARE_DEPLOYMENT.md)
