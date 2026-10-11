"""County and state sources about Vineyard, read once a day by the nightly GitHub crawl.

  * utah-county-tax-rates: Utah County Treasurer's approved tax rates by tax area and year. One
    record per tax year ("Utah County tax rates 2026, Vineyard tax areas", documentType tax_rate)
    holding every rate line of each Vineyard tax area, as published.
  * utah-county-parcels: the county parcel map service the portal map already draws (health only;
    it produces no records).
  * udot-projects: UDOT's public project list (UDOT Open Data "Projects as Lines" feature service),
    one record per project (PIN) in or touching Vineyard, plus UDOT news posts that mention Vineyard.

Every page is read through PoliteClient (robots.txt, crawl delay, descriptive user agent). A run
makes roughly 30 requests in all. Parsers are pure functions with saved fixtures in ingest/tests.
"""
from __future__ import annotations

import hashlib
import json
import html as htmllib
import re
from datetime import date, datetime, timezone
from urllib.parse import quote, urlencode

from .api import PortalApi
from .chunk import chunk_pages
from .extract import Page
from .http import HttpFailure, PoliteClient, RobotsDisallowed
from .urls import key_for

TAX_SOURCE = "utah-county-tax-rates"
PARCEL_SOURCE = "utah-county-parcels"
UDOT_SOURCE = "udot-projects"
AUDITOR_SOURCE = "utah-auditor-reports"

TAX_BASE = "https://www.utahcounty.gov/Dept/treas/production-single-forms/tax-rates/"
TAX_FORM = TAX_BASE + "TaxRates.asp"
COUNTY_PARCELS_LAYER = "https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer/2"
UDOT_LAYER = "https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/Projects_as_Lines/FeatureServer/0"
UDOT_HUB = "https://data-uplan.opendata.arcgis.com/"
UDOT_WP = "https://connect.udot.utah.gov/wp-json/wp/v2/search"
# Transparent Utah's report search (Office of the State Auditor, data under CC BY 4.0): every report a
# local government filed with the State Auditor, with a public link to the filed file.
TU_QUERY = "https://tu-query-handler-prod-778714388561.us-west3.run.app/"
TU_SEARCH_PAGE = "https://transparent.utah.gov/search-reports"

# Vineyard and the roads along its edges (Geneva Road, 800 North and 1600 North in Orem), [west, south, east, north].
UDOT_ENVELOPE = (-111.80, 40.26, -111.69, 40.345)
# Kept identical to UDOT_WHERE in worker/lib/mapLayers.ts (the map layer); a test compares them.
UDOT_KEYWORDS = ("VINEYARD", "GENEVA", "SR-114", "SR-176", "800 N", "1600 N", "SR-241", "FRONTRUNNER", "FRONT RUNNER", "COMMUTER RAIL", "DOUBLE TRACK")
UDOT_WHERE = "pin_stat_nm <> 'Abandoned' AND (" + " OR ".join(f"UPPER({f}) LIKE '%{k}%'" for k in UDOT_KEYWORDS for f in ("pin_desc", "proj_loc")) + ")"
UDOT_FIELDS = ("pin", "pin_desc", "pin_stat_nm", "proj_loc", "public_desc", "concept_desc", "planned_construction_year", "forecast_st_yr", "project_value", "sponsor_name", "pct_complete", "substantially_complete_date")

SOURCES = [
    {
        "id": TAX_SOURCE,
        "name": "Utah County tax rates",
        "baseUrl": TAX_FORM,
        "sourceType": "financial_transparency",
        "authority": "Utah County Treasurer",
        "crawlEnabled": True,
        "archiveEnabled": False,
        "documentDiscoveryEnabled": True,
        "description": "Approved property tax rates for each Vineyard tax area, by year, from the Utah County Treasurer.",
        "notes": "Read daily by the GitHub crawl: the two newest tax years for every Vineyard tax area, and one older year per day for tax areas 95 and 96.",
    },
    {
        "id": PARCEL_SOURCE,
        "name": "Utah County parcels",
        "baseUrl": "https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer",
        "sourceType": "gis_portal",
        "authority": "Utah County GIS",
        "crawlEnabled": True,
        "archiveEnabled": False,
        "documentDiscoveryEnabled": False,
        "description": "Current parcel outlines and parcel facts shown on the portal map. No owner names or mailing addresses.",
        "notes": "Drawn on the map from the county service; checked daily by the GitHub crawl.",
    },
    {
        "id": UDOT_SOURCE,
        "name": "UDOT projects",
        "baseUrl": UDOT_HUB,
        "sourceType": "other",
        "authority": "Utah Department of Transportation",
        "crawlEnabled": True,
        "archiveEnabled": False,
        "documentDiscoveryEnabled": True,
        "description": "State road and rail projects in or touching Vineyard: Vineyard Connector, Geneva Road, 800 North, 1600 North, FrontRunner. Also UDOT news posts that mention Vineyard.",
        "notes": "UDOT Open Data project list (Projects as Lines) and connect.udot.utah.gov news, read daily by the GitHub crawl.",
    },
    {
        "id": AUDITOR_SOURCE,
        "name": "State Auditor filed reports (Vineyard City)",
        "baseUrl": TU_SEARCH_PAGE,
        "sourceType": "state_auditor",
        "authority": "Utah Office of the State Auditor",
        "crawlEnabled": True,
        "archiveEnabled": True,
        "documentDiscoveryEnabled": True,
        "description": "Budgets, audited financial reports, management letters and other reports Vineyard City filed with the Utah State Auditor.",
        "notes": "Listed through Transparent Utah's report search (data under CC BY 4.0); files are read from their public links. Checked daily by the GitHub crawl.",
    },
]


def log(msg: str) -> None:
    print(msg, flush=True)


def _text(fragment: str) -> str:
    t = re.sub(r"<[^>]+>", " ", fragment or "")
    return re.sub(r"\s+", " ", htmllib.unescape(t)).strip()


# --------------------------------------------------------------------------------------- tax rates

def parse_tax_years(page: str) -> list[int]:
    """Years offered by the district search (newest first)."""
    m = re.search(r'<select[^>]*name="serialform-year"[^>]*>(.*?)</select>', page, re.S | re.I)
    years = [int(y) for y in re.findall(r'<option[^>]*value="(\d{4})"', m.group(1) if m else "")]
    return sorted(set(years), reverse=True)


def parse_vineyard_districts(page: str) -> list[tuple[int, str]]:
    """Tax areas (districts) whose name starts with VINEYARD, as listed in the district picker."""
    m = re.search(r'<select[^>]*name="serialform-district"[^>]*>(.*?)</select>', page, re.S | re.I)
    out: list[tuple[int, str]] = []
    for value, label in re.findall(r'<option[^>]*value="(\d+)"[^>]*>([^<]*)', m.group(1) if m else ""):
        name = re.sub(r"\s*-\s*TD\s*\d+\s*$", "", _text(label))
        if name.upper().startswith("VINEYARD"):
            out.append((int(value), name))
    return sorted(set(out))


def parse_tax_rates(page: str) -> dict | None:
    """The rate table of one district and year: {district, year, lines: [(unit, name, rate)], total}."""
    head = re.search(r"Tax Rate of District\s+(\d+)\s+for Tax Year\s+(\d{4})", page)
    if not head:
        return None
    body = page[head.end():]
    end = body.find("</table>")
    body = body[: end if end >= 0 else len(body)]
    lines: list[tuple[str, str, str]] = []
    total = None
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S | re.I):
        cells = [_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S | re.I)]
        if len(cells) != 3:
            continue
        if "total tax rate" in cells[1].lower():
            total = cells[2] or None
        elif re.fullmatch(r"\d*\.\d+", cells[2]) and cells[0]:
            lines.append((cells[0], cells[1], cells[2]))
    if not lines:
        return None
    return {"district": int(head.group(1)), "year": int(head.group(2)), "lines": lines, "total": total}


def tax_url(year: int, district: int) -> str:
    return f"{TAX_BASE}taxratesdistyrresults.asp?{urlencode({'serialform-year': year, 'serialform-district': district})}"


def six_places(rate: str) -> str:
    """0.0034600 -> 0.003460: the same number in the six places city records print (only zeros are dropped)."""
    m = re.fullmatch(r"(\d*\.\d{6})(0+)", rate)
    return m.group(1) if m else rate


def tax_record_text(year: int, tables: list[tuple[str, dict]], read_on: str) -> str:
    vine: dict[str, list[int]] = {}
    for _, t in tables:
        for unit, _name, rate in t["lines"]:
            if unit == "VINE":
                vine.setdefault(rate, []).append(t["district"])
    out = [f"Utah County tax rates {year}, Vineyard tax areas", f"Approved property tax rates for tax year {year}, by tax area, as published by the Utah County Treasurer."]
    for rate, areas in vine.items():
        out.append(f"Vineyard City rate (tax unit VINE), tax area{'s' if len(areas) > 1 else ''} {', '.join(str(a) for a in areas)}: {six_places(rate)}")
    out.append("")
    for name, t in tables:
        out.append(f"Tax area {t['district']}, {name}")
        for unit, unit_name, rate in t["lines"]:
            out.append(f"{unit} {unit_name}: {rate}")
        if t.get("total"):
            out.append(f"Total tax rate: {t['total']}")
        out.append("")
    out.append(f"Source: Utah County Treasurer, tax rates by district and year ({TAX_FORM}), read {read_on}.")
    return "\n".join(out).strip()


def build_tax_records(client: PoliteClient, today: date | None = None) -> list[dict]:
    today = today or date.today()
    form, _ = client.get_text(TAX_FORM)
    years = parse_tax_years(form)
    if not years:
        raise HttpFailure(None, "Tax rate page lists no years")
    districts = parse_vineyard_districts(form) or [(95, "VINEYARD CITY"), (96, "VINEYARD CITY / WITH WATER")]
    recent = years[:2]
    older = years[2:]
    pages: dict[tuple[int, int], str] = {}
    # Results pages carry the newest district list (new improvement districts appear there first).
    first = districts[0][0]
    pages[(recent[0], first)], _ = client.get_text(tax_url(recent[0], first))
    names = dict(districts)
    for did, name in parse_vineyard_districts(pages[(recent[0], first)]):
        names.setdefault(did, name)
    plan: list[tuple[int, list[int]]] = [(y, sorted(names)) for y in recent]
    if older:
        plan.append((older[today.toordinal() % len(older)], [d for d in (95, 96) if d in names] or sorted(names)[:2]))
    records: list[dict] = []
    for year, ids in plan:
        tables: list[tuple[str, dict]] = []
        for did in ids:
            page = pages.get((year, did))
            if page is None:
                page, _ = client.get_text(tax_url(year, did))
            t = parse_tax_rates(page)
            if t and t["year"] == year and t["district"] == did:
                tables.append((names[did], t))
        if not tables:
            continue
        records.append({
            "key": f"{TAX_SOURCE}:{year}",
            "title": f"Utah County tax rates {year}, Vineyard tax areas",
            "docType": "tax_rate",
            "year": year,
            "url": tax_url(year, tables[0][1]["district"]),
            "parent": TAX_FORM,
            "body": "Utah County Treasurer",
            "text": tax_record_text(year, tables, today.isoformat()),
        })
    return records


# -------------------------------------------------------------------------------------------- UDOT

def udot_query_url(offset: int = 0) -> str:
    w, s, e, n = UDOT_ENVELOPE
    p = {
        "where": UDOT_WHERE,
        "geometry": f"{w},{s},{e},{n}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": ",".join(UDOT_FIELDS),
        "returnGeometry": "false",
        "orderByFields": "pin",
        "resultOffset": str(offset),
        "resultRecordCount": "1000",
        "f": "json",
    }
    return f"{UDOT_LAYER}/query?{urlencode(p, quote_via=quote)}"


def udot_project_url(pin: int) -> str:
    p = {"where": f"pin={int(pin)}", "outFields": ",".join(UDOT_FIELDS), "returnGeometry": "false", "f": "html"}
    return f"{UDOT_LAYER}/query?{urlencode(p, quote_via=quote)}"


def _money(v) -> str | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return f"${x:,.0f}" if x > 0 else None


def _year(v) -> str | None:
    try:
        y = int(v)
    except (TypeError, ValueError):
        return None
    return str(y) if 1950 < y < 2100 else None


def _date(v) -> str | None:
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000, tz=timezone.utc).date().isoformat()
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(v))
    return m.group(1) if m else None


def udot_projects(features: list[dict]) -> list[dict]:
    """One entry per project (PIN); a project drawn as several lines is one project."""
    by_pin: dict[int, dict] = {}
    for f in features:
        a = f.get("attributes") or f.get("properties") or {}
        try:
            pin = int(a.get("pin"))
        except (TypeError, ValueError):
            continue
        if str(a.get("pin_stat_nm") or "").strip().lower() == "abandoned":
            continue
        by_pin.setdefault(pin, a)
    return [dict(by_pin[p], pin=p) for p in sorted(by_pin)]


def udot_record_text(a: dict, read_on: str) -> str:
    name = _text(str(a.get("pin_desc") or "")).lstrip("*").strip() or f"Project {a['pin']}"
    lines = [f"UDOT project {a['pin']}: {name}"]
    facts = [
        ("Status", _text(str(a.get("pin_stat_nm") or ""))),
        ("Location", _text(str(a.get("proj_loc") or ""))),
        ("Type", _text(str(a.get("concept_desc") or ""))),
        ("Description", _text(str(a.get("public_desc") or ""))),
        ("Planned construction year", _year(a.get("planned_construction_year"))),
        ("Forecast start year", _year(a.get("forecast_st_yr"))),
        ("Project value", _money(a.get("project_value"))),
        ("Percent complete", f"{a['pct_complete']}%" if isinstance(a.get("pct_complete"), (int, float)) else None),
        ("Substantially complete", _date(a.get("substantially_complete_date"))),
        ("Sponsor", _text(str(a.get("sponsor_name") or "")).title() or None),
    ]
    lines += [f"{k}: {v}" for k, v in facts if v]
    lines.append(f"Source: UDOT Open Data, UDOT Projects (Projects as Lines), PIN {a['pin']}, read {read_on}.")
    return "\n".join(lines)


def udot_title(a: dict) -> str:
    name = _text(str(a.get("pin_desc") or "")).lstrip("*").strip() or f"Project {a['pin']}"
    return f"UDOT project: {name} (PIN {a['pin']})"


def build_udot_records(client: PoliteClient, today: date | None = None) -> list[dict]:
    today = today or date.today()
    feats: list[dict] = []
    for page in range(3):
        data = client.get_json(udot_query_url(page * 1000))
        if not isinstance(data, dict) or data.get("error"):
            raise HttpFailure(None, f"UDOT project query failed: {str(data)[:200]}")
        got = data.get("features") or []
        feats += got
        if not data.get("exceededTransferLimit") or len(got) < 1000:
            break
    out = []
    for a in udot_projects(feats):
        out.append({
            "key": f"{UDOT_SOURCE}:pin:{a['pin']}",
            "title": udot_title(a),
            "docType": "project",
            "year": None,
            "url": udot_project_url(a["pin"]),
            "parent": UDOT_HUB,
            "body": "Utah Department of Transportation",
            "text": udot_record_text(a, today.isoformat()),
        })
    return out


def udot_news_items(results: list[dict]) -> list[dict]:
    """News posts from UDOT's site search that name Vineyard in the title (pages are site sections, not records)."""
    out = []
    for r in results or []:
        url = str(r.get("url") or "")
        title = _text(str(r.get("title") or ""))
        if r.get("subtype") != "post" or not url.startswith("https://connect.udot.utah.gov/") or not re.search(r"\bvineyard\b", title, re.I):
            continue
        m = re.search(r"/(\d{4})/(\d{2})/(\d{2})/", url)
        out.append({"url": url, "title": title, "date": f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None})
    return out


# ------------------------------------------------------------------------------ State Auditor

AUDIT_TYPES = re.compile(r"audit|management letter|gas report|agreed upon procedures", re.I)
REPORT_TYPES = re.compile(r"financial (report|statements|certification)|fin stmts|impact fee report|cra report|bond financial", re.I)


def auditor_search_url(page: int) -> str:
    param = {"keyword": "Vineyard", "entity_ids": [], "government_types": [], "report_types": [], "years": [], "sort_by": "report_year", "sort_dir": "desc", "page": page, "page_size": 50}
    return f"{TU_QUERY}?function=searchReports&parameter={quote(json.dumps(param, separators=(',', ':')))}"


def auditor_doc_type(report_type: str) -> str:
    if "budget" in report_type.lower():
        return "budget"
    if AUDIT_TYPES.search(report_type):
        return "audit"
    if REPORT_TYPES.search(report_type):
        return "financial_report"
    return "other"


def auditor_items(results: list[dict]) -> list[dict]:
    """Vineyard City's filed reports with a public file link: queue entries (url, title, metadata)."""
    out = []
    for r in results or []:
        if str(r.get("entity_name") or "").strip().lower() != "vineyard city":
            continue
        url = str(r.get("public_url") or "")
        if not url.startswith("https://storage.googleapis.com/"):
            continue
        kind = _text(str(r.get("report_type_standardized") or "")) or "Report"
        year = r.get("report_year") if isinstance(r.get("report_year"), int) else None
        uploaded = str(r.get("upload_date") or "")
        filed = uploaded if re.fullmatch(r"\d{4}-\d{2}-\d{2}", uploaded) else None
        title = f"{kind} {year}, Vineyard City (filed with the State Auditor)" if year else f"{kind}, Vineyard City (filed with the State Auditor)"
        meta = {"title": title, "documentType": auditor_doc_type(kind), "documentDate": filed, "governmentBodyName": "Vineyard City", "linkText": f"{kind} {year or ''}".strip()}
        if year and not filed:
            meta["year"] = year
        out.append({"url": url, "title": title, "metadata": meta})
    return out


def list_auditor_reports(client: PoliteClient) -> list[dict]:
    items: list[dict] = []
    for page in range(1, 5):
        data = client.get_json(auditor_search_url(page))
        results = data.get("results") if isinstance(data, dict) else None
        if not isinstance(results, list):
            raise HttpFailure(None, "Report search returned no list")
        items += auditor_items(results)
        total = data.get("total_count") or 0
        if not results or page * 50 >= int(total):
            break
    return items


# -------------------------------------------------------------------------------------------- run

def post_text_record(api: PortalApi, source_id: str, r: dict) -> bool:
    """Writes one plain-text record; returns True when it was new or changed."""
    sha = hashlib.sha256(r["text"].encode()).hexdigest()
    slug = re.sub(r"[^a-z0-9]+", "-", r["title"].lower()).strip("-")[:80] or "record"
    res = api.post(
        "/documents",
        {
            "document": {
                "title": r["title"][:300],
                "documentType": r["docType"],
                "documentDate": r.get("date"),
                "year": r.get("year"),
                "currency": "current",
                "governmentBodyName": r.get("body"),
                "mimeType": "text/plain",
                "fileName": f"{slug}.txt",
                "fileSize": len(r["text"].encode()),
                "pageCount": None,
                "sha256": sha,
                "textStatus": "extracted",
                "ocrStatus": "not_required",
                "archiveStatus": "not_archived",
            },
            "source": {"canonicalKey": key_for(r["key"]), "sourceId": source_id, "url": r["url"], "parentUrl": r.get("parent"), "linkText": r["title"][:300], "retrievedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "httpStatus": 200},
            "relationships": [],
        },
    )
    if res.get("needsChunks") and res.get("documentId"):
        chunks = chunk_pages([Page(number=None, text=r["text"])])
        api.post(f"/documents/{res['documentId']}/chunks", {"chunks": [{"id": f"{res['documentId']}:c{c.index:05d}", "pageStart": None, "pageEnd": None, "sectionTitle": r["title"][:200], "text": c.text, "ocr": False} for c in chunks], "append": False, "offset": 0})
        return True
    return False


def _status(source_id: str, e: Exception | None, note: str | None = None) -> dict:
    if e is None:
        return {"id": source_id, "status": "active", "message": note}
    return {"id": source_id, "status": "blocked" if isinstance(e, RobotsDisallowed) else "unreachable", "message": str(e)[:300]}


def run(api: PortalApi, client: PoliteClient, enqueue, only: set[str] | None = None) -> list[dict]:
    """Reads each source once; returns source statuses for /sources/status. Never raises for a source failure."""
    statuses: list[dict] = []
    want = lambda sid: not only or sid in only  # noqa: E731

    if want(TAX_SOURCE):
        try:
            recs = build_tax_records(client)
            changed = sum(post_text_record(api, TAX_SOURCE, r) for r in recs)
            log(f"Utah County tax rates: {len(recs)} year records, {changed} new or changed")
            statuses.append(_status(TAX_SOURCE, None) if recs else {"id": TAX_SOURCE, "status": "changed", "message": "No rate tables found on the page."})
        except (HttpFailure, RobotsDisallowed, ValueError) as e:
            log(f"Utah County tax rates failed: {e}")
            statuses.append(_status(TAX_SOURCE, e))

    if want(PARCEL_SOURCE):
        try:
            meta = client.get_json(f"{COUNTY_PARCELS_LAYER}?f=json")
            ok = isinstance(meta, dict) and not meta.get("error") and meta.get("type") == "Feature Layer"
            statuses.append(_status(PARCEL_SOURCE, None) if ok else {"id": PARCEL_SOURCE, "status": "changed", "message": "Parcel layer description changed."})
        except (HttpFailure, RobotsDisallowed, ValueError) as e:
            statuses.append(_status(PARCEL_SOURCE, e))

    if want(UDOT_SOURCE):
        try:
            recs = build_udot_records(client)
            changed = sum(post_text_record(api, UDOT_SOURCE, r) for r in recs)
            news: list[dict] = []
            try:
                news = udot_news_items(client.get_json(f"{UDOT_WP}?search=vineyard&per_page=50"))
            except (HttpFailure, RobotsDisallowed, ValueError) as e:
                log(f"UDOT news search failed: {e}")
            from .adapters.base import QueueItem
            from .urls import url_key

            enqueue(
                QueueItem(source_id=UDOT_SOURCE, url=n["url"], key=url_key(n["url"]), parent_url="https://connect.udot.utah.gov/", priority=70, metadata={"kind": "web_page", "title": n["title"][:300], "documentType": "project", "documentDate": n["date"], "requireMention": "vineyard", "governmentBodyName": "Utah Department of Transportation"})
                for n in news
            )
            log(f"UDOT: {len(recs)} project records ({changed} new or changed), {len(news)} news posts queued")
            statuses.append(_status(UDOT_SOURCE, None) if recs else {"id": UDOT_SOURCE, "status": "changed", "message": "No projects returned for Vineyard."})
        except (HttpFailure, RobotsDisallowed, ValueError) as e:
            log(f"UDOT projects failed: {e}")
            statuses.append(_status(UDOT_SOURCE, e))

    if want(AUDITOR_SOURCE):
        try:
            from .adapters.base import QueueItem
            from .urls import url_key

            reports = list_auditor_reports(client)
            enqueue(QueueItem(source_id=AUDITOR_SOURCE, url=r["url"], key=url_key(r["url"]), parent_url=TU_SEARCH_PAGE, priority=50, metadata=r["metadata"]) for r in reports)
            log(f"State Auditor filed reports: {len(reports)} queued or refreshed")
            statuses.append(_status(AUDITOR_SOURCE, None) if reports else {"id": AUDITOR_SOURCE, "status": "changed", "message": "No Vineyard City reports returned."})
        except (HttpFailure, RobotsDisallowed, ValueError) as e:
            log(f"State Auditor reports failed: {e}")
            statuses.append(_status(AUDITOR_SOURCE, e))
    return statuses
