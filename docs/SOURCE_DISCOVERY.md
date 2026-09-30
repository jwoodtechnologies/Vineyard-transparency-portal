# Source Discovery

## Primary source seed

> **`https://www.vineyardutah.gov/transparency_portal/index.php`**

All automated discovery starts from this page (`primarySourceSeed` in
[`config/source-seeds.json`](../config/source-seeds.json); the frontend shows the same URL from
`src/config/env.ts`). From it, the crawler finds the public-record systems Vineyard links to and the
documents it links directly.

## Running discovery

```bash
npm run discover-sources
# options
npm run discover-sources -- --max-depth 2 --max-pages 300 --verbose
npm run discover-sources -- --dry-run          # print the summary, write nothing
npm run discover-sources -- --no-probe         # skip HEAD/GET probes of document links
npm run discover-sources -- --seed <url> --allow-host <host> --delay-ms 0 --out <file>   # local testing
```

Outputs:

- `data/discovered-sources.json` — `DiscoveryManifest` (`scripts/lib/types.ts`): `sources` grouped by
  system kind, `documents` (direct document links with link texts, pages found on, probe results),
  `mediaLinks`, `pages`, `redirects`, `errors`, `stats`, `summary`, `generatedAt`, `seed`.
- `data/discovered-sources.summary.txt` — the same summary printed to the terminal, e.g.:

```
Vineyard source discovery complete.

N source systems identified.
N direct document links identified.
N meeting/public-notice systems identified.
N financial-reporting systems identified.
N municipal-code system(s) identified.
```

followed by pages fetched, skip counts, every source system (with `NEEDS REVIEW` flags and the page
it was discovered from), documents by file kind and type hint, redirects and errors. **Every number is
computed from what was actually fetched and linked in that run.**

### Network access is required — and results are never fabricated

Discovery must run on a machine that can reach `www.vineyardutah.gov` and the other hosts in
`approvedDomains`. In the development environment where this tooling was written, outbound access to
those hosts was blocked by the sandbox's egress policy, so **no live discovery results exist in this
repository**, and none are committed. When the seed cannot be retrieved the CLI:

- prints the exact reason (DNS/connection error, timeout, HTTP status, robots.txt), and recognises
  proxy/firewall denials (e.g. a `403` with `x-deny-reason: host_not_allowed`) as
  `blocked_by_network_policy` so the city's site is not blamed;
- writes nothing and exits with code **2**;
- suggests checking network access. If your network requires an HTTP proxy, recent Node.js releases
  honour `HTTPS_PROXY` when `NODE_USE_ENV_PROXY=1` is set.

Before crawling government sites, replace the placeholder contact URL in
`crawlPolicy.userAgent` (`https://example.invalid/replace-with-project-contact-page`) with a real
project contact page; the CLI warns until you do.

## How links are discovered

`scripts/lib/html.ts` is a dependency-free, tolerant HTML scanner — not a single CSS selector — so
malformed CMS markup and redesigns degrade gracefully:

- quote-aware tag/attribute parsing; comments, `<script>`, `<style>`, `<template>` ignored;
- `<base href>` honoured; HTML entities decoded (named + numeric);
- URLs collected from `a[href]`, `area[href]`, `iframe/frame[src]`, `embed[src]`, `object[data]`,
  `source/video/audio[src]`, `link[rel=alternate|canonical]`, meta refresh, `data-href/-url/-file/
  -download/-src/-document` attributes and quoted URLs in `onclick` handlers;
- link text = visible text, else `title`/`aria-label`/`img alt`;
- `mailto:`, `tel:`, `javascript:` and other non-http schemes are recorded as unsupported, never fetched.

## Crawl scope

Breadth-first from the seed, with these rules (`scripts/lib/discover.ts`):

| Rule | Detail |
| --- | --- |
| Approved hosts only | Pages are fetched only on `approvedDomains` (or `--allow-host`). `crawl: full` → depth-limited child pages; `landing_only` → just the first page on that host (confirms the system is live; adapters crawl it later); `documents_only` → no pages. |
| Depth | `--max-depth` (default `crawlPolicy.defaultMaxDepth` = 2), further capped per domain. |
| Relevance | On `full` hosts, a child page is followed only if it is under the seed's folder (`/transparency_portal/`) or its URL/link text contains a public-records keyword (`crawlPolicy.relevantKeywords`: agenda, minutes, ordinance, budget, audit, notice, code, …). |
| Never | Denied domains (social, marketing, advertising, analytics, news — `deniedDomains`); media hosts (YouTube/Vimeo are **recorded** as possible meeting video, never crawled); `skipUrlPatterns` (login, search, calendar, RSS, forms, static assets). |
| Trap guards | `maxQueryVariantsPerPath` (5), `maxPagesPerRun` (300), `maxHtmlBytes` (5 MB, truncated). |
| Documents | Every document link on a crawled page is recorded (even on external hosts), then probed with `HEAD` — or a 1-byte ranged `GET` when `HEAD` is refused — to learn content type and length (`maxDocumentProbes`). Denied hosts are never probed. |
| Politeness | robots.txt (RFC 9309; Crawl-delay honoured, capped), `requestDelayMs` (1.5 s) per host, 20 s timeout, 2 retries with backoff, descriptive User-Agent. |

## URL normalization

`normalizeUrl()` (`scripts/lib/url.ts`) produces identity keys for de-duplication; requests still use
the resolved URL:

- lower-case scheme and host, trailing dot removed, credentials removed;
- default ports (`:80`, `:443`) removed; fragments removed;
- tracking parameters removed (`utm_*`, `fbclid`, `gclid`, `dclid`, `gbraid`, `wbraid`, `msclkid`,
  `mc_cid`, `mc_eid`, `_ga`, `_gl`, `igshid`, `yclid`, `_hsenc`, `_hsmi` — configurable);
- remaining query parameters sorted by name;
- duplicate slashes collapsed, dot segments resolved, unreserved percent-escapes decoded;
- trailing slash removed except for the root path (`/a/` ≡ `/a`).

## Redirects

Redirects are followed manually (max 10 hops) and every chain is recorded in `redirects`. A redirect
that leaves the approved hosts is **not followed** for crawling; it is recorded as
`redirect_to_unapproved_host` and the target is registered as a source system for review. Redirect
loops fail with `too_many_redirects`.

## Classification

`scripts/lib/classify.ts` — deterministic, every decision records a reason:

- **File kind** by content type (when probed) or extension (ingest later also checks magic bytes): PDF, spreadsheet
  (xls/xlsx/ods), Word (doc/docx/odt/rtf), CSV, text, presentation, image, archive, audio, video
  (`fileExtensions`). Document-library download paths without extensions
  (`/DocumentCenter/View/<n>`, `/Archive.aspx?ADID=<n>`, `/AgendaCenter/ViewFile/…`, Laserfiche
  `/WebLink/…`, `?download=`) are documents whose type is learned by probing.
- **System kind** (first match): configured seed with a path prefix → `sourceSystemPatterns`
  (Utah Public Notice Website `/pmn`, State Auditor, Transparent Utah/OpenGov/ClearGov, meeting
  portals — SuiteOne, Granicus, Legistar, CivicClerk, iQM2, BoardDocs, PrimeGov, NovusAgenda,
  Swagit, CivicPlus Agenda Center, municipal code hosts — Municode, American Legal, Code Publishing,
  eCode360, enCodePlus, Sterling; document libraries; ArcGIS; other `*.utah.gov` systems) →
  configured seed for the host → YouTube/Vimeo links with meeting wording (`meeting_media`).
  These host patterns are **classification patterns, not claims** about which vendors Vineyard uses.
- **Document type hint** from URL + link text, most specific first: agenda packet, minutes,
  transcript, recording, agenda, ordinance, resolution, public notice, staff report, audit, budget,
  financial report, agreements/contracts, procurement, proclamation, map, plan, study, municipal code.
- **Internal vs external** relative to the page the link was found on.

## Source systems and duplicates

Each system is keyed by configured seed id, or by kind + host (+ first path segment for document
libraries and CivicPlus agenda centers), so repeated links to the same system collapse into one
entry with `linkCount`, `documentLinkCount`, sample link texts and the first page it was
`discoveredFrom`. A configured seed that was not linked during the run is listed in
`configuredSeedsNotObserved` (it stays in the registry). Document links are de-duplicated by
normalized URL; every page each was found on is kept.

## Municipal code

The municipal code URL is deliberately **not hard-coded** (`vineyard-municipal-code` has
`baseUrl: ""`). It must be discovered from official Vineyard pages; the hints in
`discoveryHints.hostPatterns` (CivicPlus/Municode ecosystem and other code hosts) only help classify a
link when an official page contains one.

## Review process for new public-record systems

Discovered systems that do not match a configured seed are marked `reviewStatus: "needs_review"`.
`buildRegistry()` includes them with `crawlEnabled`, `archiveEnabled` and `documentDiscoveryEnabled`
all **false**, so nothing is harvested from them automatically. To approve one:

1. Open `data/discovered-sources.summary.txt`; for each `NEEDS REVIEW` system, confirm it is linked
   from an official Vineyard page (`discoveredFrom`), is operated by or for a public body, and
   publishes public records (not marketing, social media or news).
2. Check its terms of use and robots.txt; note any API or bulk download it offers.
3. Add a seed to `config/source-seeds.json` (`id`, `name`, `baseUrl`, `sourceType`, `authority`,
   `discoveredFrom`, `adapter`, flags, `notes`) and, if its pages should be crawled, an
   `approvedDomains` entry with the narrowest `crawl` mode and `pathPrefixes` that work.
   For the municipal code, fill in the existing `vineyard-municipal-code` entry.
4. Run `npm run source-health -- --sources <id>` and `npm run discover-documents -- --sources <id>`;
   verify the adapter's output against the live site and update the adapter's TODOs.
5. Commit the config change with a note of what was verified.

To reject a system, leave it out of the config (optionally add its host to `deniedDomains`).
