"""End-to-end test of the real crawler + Worker against fixture copies of the live sources.

Runs the actual adapters, extraction, chunking, dedupe, versioning, archive upload and search,
against a local `wrangler dev` (local D1 + R2). Fixture HTML/JSON mirror the structure verified on
the live Vineyard pages on 2026-09-29; fixture document text is synthetic and clearly labeled.

  VTP_API_BASE=http://127.0.0.1:8787 VTP_INGEST_TOKEN=... python -m ingest.tests.e2e_local
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile

import requests
from requests.adapters import BaseAdapter
from requests.models import Response
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from ingest.api import PortalApi
from ingest.http import PoliteClient
from ingest.pipeline import crawl, ingest

VERSION = {"budget": 1}


def pdf(pages: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    for text in pages:
        y = 740
        for line in text.split("\n"):
            c.drawString(60, y, line)
            y -= 16
        c.showPage()
    c.save()
    return buf.getvalue()


def scanned_pdf() -> bytes:
    """An image-only PDF (no text layer) to exercise OCR detection."""
    from PIL import Image, ImageDraw

    img = Image.new("L", (1275, 1650), 255)
    d = ImageDraw.Draw(img)
    d.text((100, 100), "FIXTURE SCANNED RESOLUTION PAGE", fill=0)
    b = io.BytesIO()
    img.save(b, format="PDF", resolution=150)
    return b.getvalue()


AGENDA = pdf(
    [
        "FIXTURE - NOTICE OF A SPECIAL CITY COUNCIL MEETING\nSeptember 15, 2026, at 6:00 PM\n\n1. CALL TO ORDER\n2. PUBLIC COMMENTS\n3. BUSINESS ITEMS\n3.1 Discussion of the Holdaway Fields pickleball court lighting study\nThe council will consider the lighting study prepared by staff.",
        "4. CONSENT ITEMS\n4.1 Approval of the stormwater detention basin maintenance contract\n5. ADJOURNMENT\nThe agenda was posted September 14, 2026.",
    ]
)
PACKET = pdf(["FIXTURE AGENDA PACKET\nStaff report: pickleball court lighting study\nEstimated cost of lighting fixtures is described in Exhibit A.", "Exhibit A\nLuminaire schedule and photometric summary for the courts."])
MINUTES = pdf(["FIXTURE MINUTES - PLANNING COMMISSION\nJune 3, 2026\nCommissioners reviewed the geothermal feasibility memorandum.\nMotion to continue the item passed as recorded in the roll call."])


def budget_pdf() -> bytes:
    extra = "\nAmendment note: revised appropriation for the splash pad resurfacing." if VERSION["budget"] > 1 else ""
    return pdf([f"FIXTURE FY 27 BUDGET AMENDMENT #1\nGeneral Fund appropriations for parks maintenance.{extra}", "Capital projects fund: trail connector design."])


def transparency_html() -> str:
    links = [
        ("Government Meetings & Decisions", "https://vineyardut.portal.civicclerk.com/"),
        ("Redevelopment Agency (RDA)", "https://www.vineyardutah.gov/government/redevelopment_agency/index.php"),
        ("Code & Policies", "https://vineyard.municipalcodeonline.com/"),
        ("Budget", "https://www.vineyardutah.gov/government/budget.php"),
        ("Finance", "https://www.vineyardutah.gov/government/finance.php"),
        ("Calendar", "https://www.vineyardutah.gov/calendar.php?view=month&month=08&day=01&year=2026"),
        ("Vineyard City Maps", "https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb"),
        ("Apply for Jobs", "https://vineyardutah.applicantpro.com/jobs/"),
    ]
    items = "".join(f'<li><a href="{u}">{t}</a></li>' for t, u in links)
    return f"""<html><head><title>Welcome to Vineyard UT</title></head><body>
    <nav><a href="https://www.vineyardutah.gov/index.php">Home</a></nav>
    <main id="main"><div id="menu-content"><a href="https://www.vineyardutah.gov/services/index.php">Services</a></div><div id="entry"><h1>Transparency Portal</h1><ul>{items}</ul></div></main>
    <footer><a href="https://www.facebook.com/sharer/sharer.php?u=x">Facebook</a>
    <a href="https://cms3.revize.com/revize/security/index.jsp?webspace=vineyard">Login</a></footer></body></html>"""


def budget_html() -> str:
    t = "202608251021510" if VERSION["budget"] == 1 else "202609091629510"
    return f"""<html><head><title>Budget</title></head><body><div id="post"><h1>Budget</h1>
    <a href="https://transparent.utah.gov/">Transparent Utah</a>
    <h2>FY 2027 Documents</h2>
    <a href="/FY 27 Budget Amendment 1 08.25.2026.pdf?t={t}">FY 27 Budget Amendment #1</a>
    <h2>FY 2026 Documents</h2>
    <a href="/Finance/Finance/9.15.26 CC Agenda copy.pdf?t=1">9.15.26 CC Agenda (posted copy)</a>
    <a href="/Finance/Scanned Resolution 2026-12.pdf">Resolution 2026-12 (scanned)</a>
    </div></body></html>"""


EVENTS = {
    "value": [
        {
            "id": 1652, "eventName": "City Council Meeting", "agendaName": "Special City Council Meeting ", "categoryName": "City Council",
            "startDateTime": "2026-09-16T00:00:00Z", "isPublished": "Published", "isDeleted": False,
            "externalMediaUrl": "http://vineyardut.suiteonemedia.com/web/Player.aspx?id=1724&key=-1&mod=-1&mk=-1&nov=0", "youtubeVideoId": "",
            "eventLocation": {"address1": "125 South Main", "city": "Vineyard", "state": "Utah"},
            "publishedFiles": [
                {"fileId": 3340, "type": "Agenda", "name": "9.15.26 CC Agenda", "url": "stream/VINEYARDUT/1d04f550-6bfa-4109-bde7-e4e3bf5c7aaa.pdf", "publishOn": "2026-09-14T15:26:17.03Z"},
                {"fileId": 3347, "type": "Agenda Packet", "name": "9.15.26 CC Agenda Packet", "url": "stream/VINEYARDUT/8e30ed8a.pdf", "publishOn": "2026-09-15T15:44:33.987Z"},
            ],
        },
        {
            "id": 1560, "eventName": "Planning Commission", "agendaName": None, "categoryName": "Planning Commission",
            "startDateTime": "2026-06-04T01:00:00Z", "isPublished": "Published", "isDeleted": False, "externalMediaUrl": "", "youtubeVideoId": "",
            "eventLocation": {"address1": "City Council Chambers, 125 South Main Street", "city": "Vineyard", "state": "Utah"},
            "publishedFiles": [{"fileId": 2001, "type": "Minutes", "name": "6.3.26 PC Minutes", "url": "stream/VINEYARDUT/m.pdf", "publishOn": "2026-06-20T10:00:00Z"}],
        },
    ]
}


class FixtureAdapter(BaseAdapter):
    def send(self, request, **kwargs):
        url = request.url
        r = Response()
        r.url = url
        r.request = request
        r.status_code = 200
        body: bytes = b""
        ctype = "text/html; charset=utf-8"
        if url.endswith("/robots.txt"):
            body = b"User-agent: *\nDisallow: /revize/\n"
            ctype = "text/plain"
        elif "transparency_portal/index.php" in url:
            body = transparency_html().encode()
        elif "government/budget.php" in url:
            body = budget_html().encode()
        elif "government/finance.php" in url or "redevelopment_agency" in url:
            body = b"<html><body><div id='post'><h1>Page</h1><p>No documents.</p></div></body></html>"
        elif "api.civicclerk.com/v1/Events" in url:
            body = json.dumps(EVENTS if "skip=0" in url else {"value": []}).encode()
            ctype = "application/json"
        elif "GetMeetingFileStream(fileId=3340" in url or "9.15.26%20CC%20Agenda%20copy.pdf" in url:
            body, ctype = AGENDA, "application/pdf"  # same bytes at two URLs → duplicate detection
        elif "GetMeetingFileStream(fileId=3347" in url:
            body, ctype = PACKET, "application/pdf"
        elif "GetMeetingFileStream(fileId=2001" in url:
            body, ctype = MINUTES, "application/octet-stream"
        elif "Budget%20Amendment%201" in url:
            body, ctype = budget_pdf(), "application/pdf"
        elif "Scanned%20Resolution" in url:
            body, ctype = scanned_pdf(), "application/pdf"
        else:
            r.status_code = 404
        r.headers["Content-Type"] = ctype
        r.raw = io.BytesIO(body)
        r.encoding = "utf-8" if ctype.startswith(("text", "application/json")) else None
        return r

    def close(self):
        pass


def client() -> PoliteClient:
    c = PoliteClient()
    for prefix in ("https://www.vineyardutah.gov", "https://vineyardutah.gov", "https://vineyardut.api.civicclerk.com"):
        c.session.mount(prefix, FixtureAdapter())
    return c


def check(cond: bool, label: str) -> None:
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        check.failed = True  # type: ignore[attr-defined]


def main() -> int:
    os.environ.setdefault("VTP_MIN_INTERVAL_SECONDS", "0")
    import ingest.http as h

    h.MIN_INTERVAL = 0.0
    api = PortalApi()
    base = api.base
    api.post("/migrate", {})
    c = client()
    manifest = os.path.join(tempfile.mkdtemp(), "manifest.json")
    crawl(api, c, "run_test_1", manifest_path=manifest)
    m = json.load(open(manifest))
    check(m["linkCount"] >= 8, f"source inventory captured {m['linkCount']} links")
    check("vineyard-civicclerk-meetings" in m["sourceIds"] and "transparent-utah" in m["sourceIds"], "external systems discovered (CivicClerk, Transparent Utah via Budget page)")

    counts = ingest(api, c, "run_test_1", limit=25)
    check(counts.ingested >= 5, f"ingested {counts.ingested} new documents")
    check(counts.duplicates == 1, f"duplicate binary detected once (got {counts.duplicates})")

    pub = lambda p, **q: requests.get(f"{base}/api{p}", params=q, timeout=30)
    stats = pub("/stats").json()
    check(stats["documentsIndexed"] == 5 and stats["meetingsIndexed"] == 2, f"stats: {stats['documentsIndexed']} docs, {stats['meetingsIndexed']} meetings, ocr pending {stats['ocrPendingCount']}")
    check(stats["ocrPendingCount"] == 1, "scanned PDF flagged ocr_status=needed")

    s = pub("/search", q="pickleball lighting").json()
    titles = [i["document"]["title"] for i in s["items"]]
    check(bool(s["items"]) and s["items"][0]["excerpts"][0]["highlights"], f"search 'pickleball lighting' → {titles} page {s['items'][0]['excerpts'][0]['page'] if s['items'] else None}")
    agenda = next(i for i in s["items"] if i["document"]["documentType"] == "agenda")
    doc = pub(f"/documents/{agenda['document']['id']}").json()
    check(len(doc["sources"]) == 2, f"agenda has 2 provenance paths: {[x['sourceId'] for x in doc['sources']]}")
    check(doc["meetingId"] == "mtg_cc_1652" and doc["date"] == "2026-09-15", f"agenda linked to meeting {doc['meetingId']} dated {doc['date']}")
    check(doc["archiveUrl"] is not None, "agenda archived to R2")
    f = requests.get(f"{base}{doc['archiveUrl']}", timeout=30)
    check(f.status_code == 200 and f.content[:4] == b"%PDF" and f.headers["content-type"] == "application/pdf", "archived PDF served")
    rng = requests.get(f"{base}{doc['archiveUrl']}", headers={"Range": "bytes=0-99"}, timeout=30)
    check(rng.status_code == 206 and len(rng.content) == 100, f"byte range → {rng.status_code} {rng.headers.get('content-range')}")
    etag = f.headers.get("etag")
    nm = requests.get(f"{base}{doc['archiveUrl']}", headers={"If-None-Match": etag}, timeout=30)
    check(nm.status_code == 304, "ETag revalidation → 304")
    text = pub(f"/documents/{doc['id']}/text").json()
    check([p["page"] for p in text] == [1, 2], f"page text preserved: pages {[p['page'] for p in text]}")
    rel = pub(f"/documents/{doc['id']}/related").json()
    check(any(r["document"]["documentType"] == "agenda_packet" for r in rel), "related: packet for the same meeting")
    mt = pub("/meetings/mtg_cc_1652").json()
    check(mt["agendaDocumentId"] == doc["id"] and mt["packetDocumentId"] and mt["media"][0]["kind"] == "video", "meeting has agenda, packet and video link")

    phrase = pub("/search", q='"stormwater detention basin"', type="agenda").json()
    check(phrase["total"] == 1 and phrase["items"][0]["excerpts"][0]["page"] == 2, f"phrase + type filter → page {phrase['items'][0]['excerpts'][0]['page'] if phrase['items'] else None}")
    injection = pub("/search", q='title:" OR 1=1 -- ) NEAR( *').json()
    check(isinstance(injection["items"], list), "hostile query text is handled safely")

    ask = requests.post(f"{base}/api/ask", json={"question": "What was on the agenda about pickleball court lighting?"}, timeout=60).json()
    check(ask["retrievalStatus"] == "search_only" and ask["notice"].startswith("AI answers are temporarily unavailable") and ask["searchResults"], f"AI-disabled Ask → {ask['retrievalStatus']} with {len(ask.get('searchResults', []))} search results")

    # Versioning: the city replaces the budget amendment (new ?t= and new bytes).
    VERSION["budget"] = 2
    crawl(api, c, "run_test_2", only={"vineyard-city-website"})
    counts2 = ingest(api, c, "run_test_2", limit=25)
    check(counts2.by_status.get("new_version") == 1, f"changed file → new version ({counts2.by_status})")
    b = pub("/search", q="splash pad resurfacing").json()
    bd = pub(f"/documents/{b['items'][0]['document']['id']}").json() if b["items"] else {}
    check(bd.get("currentVersion") == 2 and len(bd.get("versions", [])) == 2 and bd["versions"][0]["checksum"] != bd["versions"][1]["checksum"], "version history kept with both hashes")
    old = requests.get(f"{base}/api/documents/{bd['id']}/file?version=1", timeout=30)
    check(old.status_code == 200 and old.headers.get("cache-control", "").endswith("immutable"), "old version still served from archive")

    counts3 = ingest(api, c, "run_test_3", limit=25)
    check(counts3.fetched == 0, "nothing left to fetch on an unchanged rerun (resumable queue)")
    health = pub("/health").json()
    check(health["status"] == "ok" and health["database"] == "healthy" and health["archive"] == "available", f"health: {health['status']} db={health['database']} archive={health['archive']} ai={health['aiMode']}")
    v = api.get("/verify")
    check(v["chunkCountsConsistent"], f"catalog/shard chunk counts consistent ({v['catalogChunkCount']} chunks)")
    q = api.get("/quota")
    print(f"D1 rows written today (local): {q['d1RowsWritten']} / budget {q['d1RowBudget']}; archive {q['archive']['storedBytes']} bytes")
    return 1 if getattr(check, "failed", False) else 0


if __name__ == "__main__":
    sys.exit(main())
