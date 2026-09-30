# Sources

The live transparency portal page is the authority for discovery:
<https://www.vineyardutah.gov/transparency_portal/index.php>.

`data/sources.manifest.json` is the committed inventory (display text, href, resolved URL, domain,
category, file type, parent page, internal/external, crawlable, notes). It was built from the live
DOM of the page (`div#entry`, 21 links, plus footer and share links) on 2026-09-29 and is regenerated
by every crawl (`sources:discover`, uploaded as a workflow artifact).

## Source registry

Scope: agendas, minutes, meeting packets, PDFs and financial documents from Vineyard's own systems.

| id | System | Crawled | How |
| --- | --- | --- | --- |
| `vineyard-transparency-portal` | Transparency Portal page | yes | Link inventory (seed) |
| `vineyard-city-website` | vineyardutah.gov (whole site) | yes | `VineyardWebsiteAdapter`: every HTML page on the city site reachable from the portal and the site's top-level sections (depth 4, up to 900 pages per run), and every document they link (pdf/doc/docx/xls/xlsx/csv/txt/ppt). Calendars, forms, search and CMS/login paths are skipped. Relative links resolve from the page's `<base href>`. |
| `vineyard-civicclerk-meetings` | "Government Meetings & Decisions" (vineyardut.portal.civicclerk.com, a CivicPlus product) | yes | `CivicClerkAdapter`: public API `vineyardut.api.civicclerk.com/v1/Events`, full history via `@odata.nextLink`. Meetings, public bodies, Agenda / Agenda Packet / Minutes files, video links |
| `vineyard-municipal-code` | Code & Policies (vineyard.municipalcodeonline.com, CivicPlus codification) | no | The site serves its book content only to its own pages (a server-side same-site filter answers other requests with "Unauthorized Access"). The portal respects that and does not work around it. Its ordinances, resolutions and minutes are indexed where the city also publishes them (CivicClerk packets and vineyardutah.gov). |

Out of scope and retired from the registry: Transparent Utah and the ArcGIS map viewer. Social
share links, the Revize CMS login, Google Maps, ApplicantPro jobs, "Report a Concern" and calendar
pages are never fetched.

## Adapters

`ingest/adapters/base.py` defines `SourceAdapter`: `discover()`, `list_documents()`,
`fetch_metadata()`, `download()`, `normalize()`, `get_canonical_id()`. Identity keys are SHA-256 of
the canonical URL (Revize) or of `civicclerk:vineyardut:file:<fileId>` (CivicClerk).
