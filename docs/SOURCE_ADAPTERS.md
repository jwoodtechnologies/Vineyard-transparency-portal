# Source Adapters

Adapters turn a public-record system into **candidate documents** (and, where the system has them,
meetings and code outlines) for ingest. They live in [`scripts/adapters/`](../scripts/adapters/) and
run via `npm run discover-documents`; their `health()` runs via `npm run source-health`.

## Interface

```ts
interface SourceAdapter {
  readonly id: AdapterId;               // 'generic-html' | 'suiteone' | 'utah-pmn' | 'transparent-utah' | 'state-auditor' | 'municipal-code'
  readonly description: string;
  readonly verification: 'verified' | 'unverified';
  canHandle(url: string): boolean;
  discoverDocuments(ctx: AdapterContext): Promise<AdapterDiscoveryResult>;
  discoverMeetings?(ctx: AdapterContext): Promise<CandidateMeeting[]>;
  health(ctx: AdapterContext, previous: SourceHealthRecord | null): Promise<SourceHealthRecord>;
}

interface AdapterContext {
  source: RegistrySource;      // seed from config (or a reviewed discovered system)
  config: SourceSeedsConfig;
  http: HttpClientLike;        // the shared polite client — adapters never call fetch directly
  log; maxPages; maxDepth; extraAllowedHosts; now;
}

interface AdapterDiscoveryResult {
  candidates: CandidateDocument[];   // url, normalizedUrl, title/linkText, documentTypeHint, fileKind,
                                     // sourceId, foundOn[], dateHint, documentNumberHint, meeting ref
  meetings: CandidateMeeting[];      // externalId (read from real links), title, date, bodyName, document/media URLs
  codeOutline: CodeOutlineEntry[];   // municipal code titles/chapters/sections, currency 'unknown'
  errors: DiscoveryError[];
  notes: string[];
  status: 'ok' | 'not_configured' | 'error';
}
```

Selection: the seed's `adapter` field, else the first adapter whose `canHandle(url)` is true
(specific adapters before `generic-html`). `discover-documents` also adds every direct document link
recorded by `discover-sources`, merges candidates by normalized URL (keeping all `foundOn` pages),
and writes `data/discovered-documents.json`. It skips sources that are disabled, awaiting review, or
have no `baseUrl`, and exits with code 2 (writing nothing) if every enabled source failed.

## Design rules

- **No brittle selectors.** Adapters work from the complete link list produced by the tolerant HTML
  scanner plus URL/link-text heuristics (e.g. "a same-host link whose URL or text mentions a meeting
  and which carries an id or a date"). A redesign that keeps meaningful link text keeps working; one
  that doesn't is reported by `health()` as `changed` rather than silently returning nothing.
- **Prefer official data endpoints.** Where a system offers JSON/RSS/bulk downloads, adapters should
  use them instead of HTML (several TODOs below).
- **Never guess identifiers.** Meeting/notice ids are read from links actually present
  (`externalIdFromUrl`: `id`, `eventId`, `meetingId`, … query params or numeric path segments).
  No sequential id enumeration.
- **Bounded.** `maxPages` per source per run (default 100), `maxDepth`, shared rate limits and robots.txt.
- **Honest status.** `verification: 'unverified'` until someone checks the adapter against the live
  system and updates this document.
- **Failures are local.** One bad page records an error and the adapter continues.

## Verification status

The development environment could not reach any of the government hosts (egress blocked), so **no
adapter has been verified against a live Vineyard system**. What *is* verified: the shared crawling,
link extraction, classification, robots handling and ingest pipeline, by unit and end-to-end tests
over fictional fixture sites (`tests/`).

| Adapter | Source | Verified | Assumed / TODO |
| --- | --- | --- | --- |
| `generic-html` | Vineyard transparency portal, city website, CivicPlus document libraries | Crawl + classification logic (tests) | Live page structure; relevance keywords may need tuning after the first real run |
| `suiteone` | `https://vineyardut.suiteonemedia.com/` | — | Server-rendered vs JS/API; meeting id parameter; agenda/packet/minutes labels; archive navigation; body name location |
| `utah-pmn` | `https://www.utah.gov/pmn/` | — | URL shapes for entity/body/notice pages; notice ids; Vineyard entity naming; RSS/API availability |
| `transparent-utah` | `https://transparent.utah.gov/` | — | Entity search; official bulk CSV for FinanceRecord pipeline |
| `state-auditor` | `https://reporting.auditor.utah.gov/` | — | How entity reports are listed; stable per-entity URLs/search API |
| `municipal-code` | not configured (must be discovered) | — | Provider, JS rendering, official export/API, version/effective-date statements |

## Adapters

### GenericHtmlAdapter (`generic-html`)

Runs the discovery crawler (`discover()`) from the source's `baseUrl` with the source's depth, no
probes, and converts every document link into a candidate (link text → title/date/number hints).
Works today for any server-rendered site. Health: generic check.

### SuiteOneAdapter (`suiteone`)

For the SuiteOne Media meeting portal. Strategy:

1. landing page → **listing links** on the same host whose text looks like archive/past/more/next/a
   year (followed up to `maxDepth`);
2. **meeting links**: same host, URL (`meeting|event|agenda|calendar|session`) or text (`meeting|council|
   commission|board|committee|session|hearing|agenda`) matches, *and* the link carries an id or a date;
3. each meeting page → `CandidateMeeting` (title from first heading, date from link text/headings,
   body name from headings ending in Council/Commission/Board/Committee/Agency/Authority, `externalId`
   from the URL) and its document links (agenda, packet, minutes, transcript, attachments) as
   candidates tied to that meeting; audio/video links become `mediaUrls`.

Health additionally expects meeting/agenda links on the landing page (`changed` if absent; `degraded`
if the page has no links at all, which suggests JavaScript rendering — then find the JSON endpoint).

### UtahPmnAdapter (`utah-pmn`)

Statewide notice system scoped by `adapterOptions.entityName` ("Vineyard"): landing page → links
mentioning the entity (or, if none, one level of browse/entity/public-body pages) → notice links
(text/URL mentions notice/meeting/hearing or carries a date) → notice pages. Each notice page is
itself a candidate (`fileKind: "html"`, `documentType: "public_notice"`; ingest stores its text, and
the API must never re-serve archived HTML as HTML), and attachments become separate candidates.

### TransparentUtahAdapter (`transparent-utah`) and StateAuditorAdapter (`state-auditor`)

Share `FinancialPortalAdapter`: collect report files (PDF/CSV/XLSX) on the landing page that mention
the entity, and follow same-host pages whose link text mentions it (depth-limited). Default type
hints: `financial_report` / `audit`. They never produce `FinanceRecord` rows — structured finance data
is a separate future pipeline over the official bulk downloads, kept out of document search.

### MunicipalCodeAdapter (`municipal-code`)

Returns `not_configured` until the code's `baseUrl` is discovered and reviewed. Then it builds an
outline from same-host links whose text reads like `Title 15`, `Chapter 15.04`, `Article 3`,
`Section 15.04.010` / `§ 15.04.010`, following titles/chapters up to `maxDepth`. Every entry is
emitted with `currency: "unknown"`: text may be marked `current` only when the host states the
version's effective/codification date; dated snapshots are `historical`; replaced sections are
`superseded`, linked to amending ordinances when the ordinance number is printed. Many code hosts are
JavaScript applications — use the provider's official export/API (subject to its terms) if the HTML
has no outline links.

## Health states

`checkSourceHealth()` (`scripts/lib/health.ts`), used by all adapters:

| Status | When |
| --- | --- |
| `active` | 2xx HTML with links on the expected host (and expected structure, if the adapter defines it) |
| `degraded` | 429, 5xx, too many redirects, or a page without links (probably JavaScript-rendered) |
| `unreachable` | DNS/connection failure or timeout |
| `changed` | 404/410 at the base URL, redirect to another host, expected links missing, or the same-host link-structure fingerprint differs from the previous check |
| `authentication_required` | 401 / 407 |
| `blocked` | 403/451, robots.txt disallows the base URL, or a local network-policy denial (message says "Local network policy") |
| `unknown` | No `baseUrl` configured yet |

`lastSuccessfulCheckAt` is carried over from the previous `data/source-health.json` when a check
fails. `npm run source-health -- --strict` exits 1 if any source is not `active` (for monitoring).

## Adding an adapter

1. Implement `SourceAdapter` in `scripts/adapters/<Name>Adapter.ts` using `common.ts` helpers
   (`fetchHtmlPage`, `classify`, `toCandidate`, `mergeCandidates`, `externalIdFromUrl`).
2. Register it in `scripts/adapters/index.ts` (before `GenericHtmlAdapter`) and add its id to
   `AdapterId` and the config validator.
3. Write tests against a fictional fixture (`tests/helpers/fixtures.ts` shows the fake-fetch pattern).
4. Verify against the live system, then set `verification = 'verified'` and update the table above.
