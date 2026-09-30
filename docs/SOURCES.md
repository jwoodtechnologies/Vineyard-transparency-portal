# Sources

The live transparency portal page is the authority for discovery:
<https://www.vineyardutah.gov/transparency_portal/index.php>.

`data/sources.manifest.json` is the committed inventory (display text, href, resolved URL, domain,
category, file type, parent page, internal/external, crawlable, notes). It was built from the live
DOM of the page (`div#entry`, 21 links, plus footer and share links) on 2026-09-29 and is regenerated
by every crawl (`sources:discover`, uploaded as a workflow artifact).

## Source registry

| id | System | Crawled | How |
| --- | --- | --- | --- |
| `vineyard-transparency-portal` | Transparency Portal page | yes | Link inventory (seed) |
| `vineyard-city-website` | vineyardutah.gov department pages | yes | `VineyardWebsiteAdapter`: record-listing pages linked from the portal (Budget, Finance, Recorder, RDA, Water Quality Reports, City Council, Elections, Public Works, Building, Construction Projects, Records Request, Mayor's Office, Newsletters) and one level below; document links (pdf/doc/docx/xls/xlsx/csv/txt/ppt) |
| `vineyard-civicclerk-meetings` | "Government Meetings & Decisions" (vineyardut.portal.civicclerk.com) | yes | `CivicClerkAdapter`: public API `vineyardut.api.civicclerk.com/v1/Events` (verified live). Meetings, public bodies, published Agenda / Agenda Packet / Minutes files, video links (SuiteOne Media / YouTube) |
| `vineyard-municipal-code` | Code & Policies (vineyard.municipalcodeonline.com) | not yet | Client-rendered app; linked for reference |
| `transparent-utah` | Transparent Utah (linked from Budget and Finance) | not yet | Interactive state data app |
| `vineyard-gis` | Vineyard City Maps (ArcGIS) | no | Interactive map |

Not crawled by design: social share links, the Revize CMS login, Google Maps, Revize vendor link,
ApplicantPro jobs, "Report a Concern" and Calendar pages.

The Phase 1 seed file `config/source-seeds.json` also lists the Utah Public Notice Website and
the State Auditor. They are **not linked** from the live transparency page, so they are not part of
the initial crawl. Add an adapter and a registry entry to include them later.

## Adapters

`ingest/adapters/base.py` defines `SourceAdapter`: `discover()`, `list_documents()`,
`fetch_metadata()`, `download()`, `normalize()`, `get_canonical_id()`. Identity keys are SHA-256 of
the canonical URL (Revize) or of `civicclerk:vineyardut:file:<fileId>` (CivicClerk).
