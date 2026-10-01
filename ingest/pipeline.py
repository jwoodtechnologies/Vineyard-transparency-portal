"""crawl → queue → download → hash → dedupe → archive → extract → chunk → index. Resumable."""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .adapters import CivicClerkAdapter, MunicipalCodeAdapter, SheriffAdapter, VineyardWebsiteAdapter
from .adapters.base import QueueItem
from .adapters.municode import HEADERS as MCO_HEADERS
from .extract import Extraction, Page
from .urls import key_for
from .api import BudgetReached, PortalApi
from .chunk import chunk_pages
from .classify import categories_for, classify_type, clean_title, parse_date, parse_document_number
from .discover import discover, main_content_seeds
from .extract import extract, extract_html, sniff
from .http import HttpFailure, PoliteClient, RobotsDisallowed
from .sources import RETIRED_SOURCES, SOURCES
from .storage import LocalFilesystemStorage, StorageProvider, WorkerArchiveStorage
from .urls import DOCUMENT_EXTENSIONS, MEDIA_EXTENSIONS, extension, filename

MAX_ARCHIVE_BYTES = int(os.environ.get("ARCHIVE_MAX_OBJECT_BYTES", str(25 * 1024 * 1024)))
MAX_DOWNLOAD_BYTES = int(os.environ.get("VTP_MAX_DOWNLOAD_BYTES", str(300 * 1024 * 1024)))
CHUNK_BATCH = 250
CHUNK_BATCH_CHARS = 350_000


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


@dataclass
class RunCounts:
    discovered: int = 0
    fetched: int = 0
    ingested: int = 0
    unchanged: int = 0
    duplicates: int = 0
    errors: int = 0
    bytes_archived: int = 0
    archived: int = 0
    quota_deferred: int = 0
    chunks: int = 0
    by_status: dict = field(default_factory=dict)

    def api(self) -> dict:
        return {k: getattr(self, k) for k in ("discovered", "fetched", "ingested", "unchanged", "duplicates", "errors", "bytes_archived")}


def new_run_id() -> str:
    gh = os.environ.get("GITHUB_RUN_ID")
    return f"run_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}" + (f"_gh{gh}" if gh else "")


# --------------------------------------------------------------------------------------------- crawl

def sync_sources(api: PortalApi) -> None:
    api.post("/sources", {"sources": SOURCES, "retire": RETIRED_SOURCES})


def crawl(api: PortalApi, client: PoliteClient, run_id: str, only: set[str] | None = None, manifest_path: str | None = None, civicclerk_since: str | None = None) -> RunCounts:
    counts = RunCounts()
    sync_sources(api)
    statuses = []

    log("Discovering sources from the live transparency portal…")
    manifest = discover(client, follow_depth=1)
    if manifest_path:
        os.makedirs(os.path.dirname(manifest_path) or ".", exist_ok=True)
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)
    log(f"Transparency portal: {manifest['linkCount']} links inventoried across {len(manifest['pagesInspected'])} pages; categories {manifest['countsByCategory']}")
    statuses.append({"id": "vineyard-transparency-portal", "status": "active"})

    def enqueue(items):
        batch = []
        for it in items:
            batch.append(it.to_api(run_id))
            if len(batch) >= 400:
                api.post("/queue", {"items": batch})
                counts.discovered += len(batch)
                batch = []
        if batch:
            api.post("/queue", {"items": batch})
            counts.discovered += len(batch)

    if not only or "vineyard-civicclerk-meetings" in only:
        cc = CivicClerkAdapter(client, since=civicclerk_since)
        try:
            enqueue(cc.list_documents())
            if cc.bodies:
                api.post("/bodies", {"bodies": list(cc.bodies.values())})
            for i in range(0, len(cc.meetings), 100):
                api.post("/meetings", {"meetings": cc.meetings[i : i + 100]})
            log(f"CivicClerk: {len(cc.meetings)} meetings, {len(cc.bodies)} public bodies")
            statuses.append({"id": "vineyard-civicclerk-meetings", "status": "active"})
        except (HttpFailure, RobotsDisallowed) as e:
            statuses.append({"id": "vineyard-civicclerk-meetings", "status": "blocked" if isinstance(e, RobotsDisallowed) else "unreachable", "message": str(e)[:300]})
            log(f"CivicClerk failed: {e}")

    if not only or "vineyard-city-website" in only:
        # Whole-site crawl: the portal's links plus the site's top-level sections.
        seeds = sorted(set(main_content_seeds(manifest)) | {f"https://www.vineyardutah.gov/{p}" for p in ("index.php", "government/index.php", "community_/index.php", "services/index.php")})
        web = VineyardWebsiteAdapter(client, seeds=seeds, max_depth=4, max_pages=900)
        enqueue(web.list_documents())
        if web.bodies:
            api.post("/bodies", {"bodies": list(web.bodies.values())})
        log(f"City website: {len(web.pages_read)} pages read from {len(seeds)} seeds, {len(web.page_errors)} page errors")
        statuses.append({"id": "vineyard-city-website", "status": "active" if web.pages_read else "unreachable", "message": "; ".join(e["url"] for e in web.page_errors[:5]) or None})

    if not only or "vineyard-municipal-code" in only:
        try:
            mco = MunicipalCodeAdapter(client)
            enqueue(mco.list_documents())
            log(f"Municipal code site: entries per book {mco.counts}")
            statuses.append({"id": "vineyard-municipal-code", "status": "active" if mco.counts else "unreachable"})
        except (HttpFailure, RobotsDisallowed) as e:
            statuses.append({"id": "vineyard-municipal-code", "status": "blocked" if isinstance(e, RobotsDisallowed) else "unreachable", "message": str(e)[:300]})
            log(f"Municipal code site failed: {e}")

    if not only or "vineyard-city-website" in only:
        # Who's who as of today: mayor, council, staff, boards (replaces yesterday's lists).
        try:
            from . import people

            people.run(api, client)
        except (HttpFailure, RobotsDisallowed, KeyError, ValueError) as e:
            log(f"Staff and officials refresh failed: {e}")

    if not only or "ucso-press-releases" in only:
        try:
            enqueue(SheriffAdapter(client).list_documents())
            statuses.append({"id": "ucso-press-releases", "status": "active"})
        except (HttpFailure, RobotsDisallowed) as e:
            statuses.append({"id": "ucso-press-releases", "status": "blocked" if isinstance(e, RobotsDisallowed) else "unreachable", "message": str(e)[:300]})
            log(f"Sheriff's Office feed failed: {e}")

    api.post("/sources/status", {"statuses": statuses})
    log(f"Queued/refreshed {counts.discovered} document URLs")
    return counts


# -------------------------------------------------------------------------------------------- ingest

def _file_name(meta: dict, url: str, ext: str, title: str) -> str:
    hint = meta.get("fileName") or meta.get("fileNameHint") or filename(url)
    if not hint or re.fullmatch(r"[0-9a-f-]{30,}\.\w+", hint, re.I) or "GetMeetingFileStream" in hint:
        base = re.sub(r"[^A-Za-z0-9._ ()-]+", "_", title).strip("_ ")[:120] or "record"
        return f"{base}.{ext or 'bin'}"
    return hint


def _mime(dl, ext: str, path: str) -> str:
    kind = sniff(path) if path else None
    if kind == "pdf":
        return "application/pdf"
    if dl.content_type and dl.content_type not in ("application/octet-stream", "binary/octet-stream", "application/force-download"):
        return dl.content_type
    return DOCUMENT_EXTENSIONS.get(ext, "application/octet-stream")


def process(api: PortalApi, client: PoliteClient, storage: StorageProvider | None, item: dict, run_id: str, counts: RunCounts, ocr: bool) -> None:
    meta = json.loads(item.get("metadata_json") or "{}")
    url = item["url"]
    ext = (meta.get("extension") or extension(url) or extension(meta.get("fileNameHint") or "")).lower()
    key = item["url_key"]

    if meta.get("kind") == "mco_content":
        process_mco(api, client, item, run_id, counts, meta)
        return

    if ext in MEDIA_EXTENSIONS:
        api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": "media files are linked, not archived", "runId": run_id}]})
        return

    dl = client.download(url, etag=item.get("known_etag"), last_modified=item.get("known_last_modified"), max_bytes=MAX_DOWNLOAD_BYTES)
    counts.fetched += 1
    if dl.not_modified:
        counts.unchanged += 1
        api.post("/queue/status", {"updates": [{"urlKey": key, "status": "unchanged", "countAttempt": False, "runId": run_id}]})
        return

    try:
        if not ext:
            ext = {"application/pdf": "pdf"}.get(dl.content_type, "") or ("pdf" if dl.path and sniff(dl.path) == "pdf" else "")
        mime = _mime(dl, ext, dl.path or "")
        if mime.startswith(("video/", "audio/")):
            api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": f"media ({mime}) linked only", "runId": run_id}]})
            return
        page_kind = meta.get("kind")
        html_heading = None
        if mime.startswith("text/html") or page_kind in ("web_page", "press_release"):
            if page_kind not in ("web_page", "press_release") or not dl.path:
                api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": "HTML page, not a document", "runId": run_id}]})
                return
            extraction, html_heading = extract_html(dl.path, page_kind)
            text_all = " ".join(p.text for p in extraction.pages)
            if meta.get("requireMention") and not re.search(rf"\b{re.escape(meta['requireMention'])}\b", text_all, re.I):
                api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": f"does not mention {meta['requireMention']}", "runId": run_id}]})
                return
            if len(text_all) < 80:
                api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": "page has no readable content", "runId": run_id}]})
                return
            # Hash the readable text, not the raw HTML, so menus or widgets changing do not re-index a page.
            dl.sha256 = hashlib.sha256(text_all.encode()).hexdigest()
            mime, ext = "text/html", "html"
        else:
            extraction = extract(dl.path, ext, mime, ocr=ocr) if dl.path else None
            if extraction and meta.get("prefaceText"):
                # The code site's written summary of this record, kept with the record itself.
                first = extraction.pages[0].number if extraction.pages else 1
                extraction.pages.insert(0, Page(number=first, text=meta["prefaceText"], section="Summary (Vineyard municipal code site)"))
                if extraction.status in ("empty", "failed"):
                    extraction.status = "extracted"
        title = clean_title(meta.get("title") or html_heading or meta.get("linkText") or meta.get("pageTitle"), meta.get("fileName") or filename(url))
        doc_type = meta.get("documentType") or classify_type(title, meta.get("fileName"), meta.get("sectionHeading"), meta.get("pageTitle"))
        doc_date = meta.get("documentDate") or parse_date(title, meta.get("fileName"), meta.get("linkText"))
        document = {
            "title": title,
            "documentType": doc_type,
            "documentNumber": meta.get("documentNumber") or parse_document_number(title, meta.get("fileName")),
            "documentDate": doc_date,
            "year": int(doc_date[:4]) if doc_date else None,
            "governmentBodyId": meta.get("governmentBodyId"),
            "governmentBodyName": meta.get("governmentBodyName"),
            "meetingId": meta.get("meetingId"),
            "categories": categories_for(doc_type),
            "mimeType": mime,
            "fileName": _file_name(meta, dl.final_url, ext, title),
            "fileSize": dl.size,
            "pageCount": extraction.page_count if extraction else None,
            "sha256": dl.sha256,
            "textStatus": extraction.status if extraction else "pending",
            "ocrStatus": extraction.ocr_status if extraction else "not_required",
            "archiveStatus": "remote_only_large_file" if (dl.truncated or dl.size > MAX_ARCHIVE_BYTES) else "not_archived",
            "description": meta.get("sectionHeading") if meta.get("sectionHeading") and meta.get("sectionHeading") != title else None,
            # One record per meeting: a second copy of the same minutes from another source attaches to the first.
            "dedupeMeeting": bool(meta.get("dedupeMeeting")),
            "currency": meta.get("currency"),
        }
        relationships = []
        if meta.get("relationship") and meta.get("meetingId"):
            relationships.append({"type": meta["relationship"], "toKind": "meeting", "toId": meta["meetingId"], "toTitle": meta.get("meetingTitle") or "", "basis": "source_structure"})
        res = api.post(
            "/documents",
            {
                "document": document,
                "source": {"canonicalKey": key, "sourceId": item["source_id"], "url": url, "parentUrl": item.get("parent_url"), "linkText": meta.get("linkText"), "retrievedAt": datetime.now(timezone.utc).isoformat(), "etag": dl.etag, "lastModified": dl.last_modified, "httpStatus": dl.status},
                "relationships": relationships,
                "meetingRole": meta.get("meetingRole"),
            },
        )
        doc_id = res["documentId"]
        status = res["status"]
        counts.by_status[status] = counts.by_status.get(status, 0) + 1
        if status == "duplicate":
            counts.duplicates += 1
        elif status == "unchanged":
            counts.unchanged += 1
        else:
            counts.ingested += 1

        if res.get("needsArchive") and storage and dl.path and dl.sha256 and page_kind not in ("web_page", "press_release"):
            if dl.size > MAX_ARCHIVE_BYTES:
                api.post(f"/documents/{doc_id}", {"archiveStatus": "remote_only_large_file"})
            else:
                a = storage.store(dl.sha256, dl.path, dl.size, mime, ext or "bin")
                if a.get("status") == "archived":
                    counts.archived += 1
                    counts.bytes_archived += int(a.get("size") or 0)
                elif a.get("status") == "quota_deferred":
                    counts.quota_deferred += 1

        if res.get("needsChunks") and extraction:
            chunks = chunk_pages(extraction.pages)
            if chunks:
                offset = 0
                while offset < len(chunks):
                    batch, chars = [], 0
                    while offset + len(batch) < len(chunks) and len(batch) < CHUNK_BATCH and chars < CHUNK_BATCH_CHARS:
                        c = chunks[offset + len(batch)]
                        batch.append({"id": f"{doc_id}:c{c.index:05d}", "pageStart": c.page_start, "pageEnd": c.page_end, "sectionTitle": c.section_title, "text": c.text, "ocr": c.ocr})
                        chars += len(c.text)
                    api.post(f"/documents/{doc_id}/chunks", {"chunks": batch, "append": offset > 0, "offset": offset, "ocrStatus": extraction.ocr_status})
                    offset += len(batch)
                counts.chunks += len(chunks)
            else:
                api.post(f"/documents/{doc_id}", {"textStatus": extraction.status if extraction.status != "extracted" else "empty", "ocrStatus": extraction.ocr_status})

        api.post("/queue/status", {"updates": [{"urlKey": key, "status": "done", "documentId": doc_id, "etag": dl.etag, "lastModified": dl.last_modified, "sha256": dl.sha256, "runId": run_id}]})
        log(f"  {status:<11} {doc_id} {title[:70]!r} ({dl.size/1024:.0f} KB, {extraction.page_count if extraction else '?'} pages, text={document['textStatus']}, ocr={document['ocrStatus']})")
    finally:
        if dl.path and os.path.exists(dl.path):
            os.unlink(dl.path)


def _mco_text(html: str) -> tuple[str, list[tuple[str, str]]]:
    """Readable text of a code site entry, and the record files it links."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "html.parser")
    for el in soup.select(".phx-name, script, style"):
        el.decompose()
    files: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if re.search(r"\.(pdf|docx?|xlsx?)(\?|$)", href, re.I) and href.startswith("http"):
            files.append((href, a.get_text(" ", strip=True)))
    text = re.sub(r"[ \t\r\f\v]+", " ", soup.get_text("\n"))
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return text, files


def process_mco(api: PortalApi, client: PoliteClient, item: dict, run_id: str, counts: RunCounts, meta: dict) -> None:
    """A municipal code site entry: queue its record file(s), or index its own text when it has none."""
    key = item["url_key"]
    r = client.request("GET", item["url"], headers=MCO_HEADERS, timeout=60)
    counts.fetched += 1
    if r.status_code >= 400:
        raise HttpFailure(r.status_code, f"GET {item['url']} -> {r.status_code}")
    data = r.json()
    text, files = _mco_text(str(data.get("Text") or ""))
    kind = meta.get("entryKind")
    base = {k: v for k, v in meta.items() if k not in ("kind", "path")}

    if files and kind in ("minutes", "resolution", "ordinance"):
        queued = []
        for i, (href, link_text) in enumerate(dict.fromkeys(files)):
            url = requests_quote(href)
            m = dict(base, prefaceText=text[:6000] if i == 0 else None, linkText=link_text or None, fileNameHint=href.rsplit("/", 1)[-1])
            if kind == "minutes" and re.search(r"\bagenda\b", link_text or "", re.I):
                m["documentType"] = "agenda_packet" if re.search(r"packet", link_text, re.I) else "agenda"
                m["title"] = base["title"].replace("meeting minutes", "meeting agenda packet" if m["documentType"] == "agenda_packet" else "meeting agenda")
            elif len(files) > 1 and i > 0:
                m["title"] = f"{base['title']} ({link_text})" if link_text else f"{base['title']} (file {i + 1})"
            queued.append(QueueItem(source_id=item["source_id"], url=url, key=key_for(f"mco:file:{href}"), parent_url=item["url"], priority=int(item.get("priority") or 90), metadata=m).to_api(run_id))
        api.post("/queue", {"items": queued})
        counts.discovered += len(queued)
        api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": f"listing: {len(queued)} record file(s) queued", "runId": run_id}]})
        return

    if len(text) < 40:
        api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": "entry has no readable content", "runId": run_id}]})
        return
    sha = hashlib.sha256(text.encode()).hexdigest()
    extraction = Extraction(pages=[Page(number=None, text=text, section=meta.get("entryName"))], page_count=None)
    doc_date = meta.get("documentDate")
    title = clean_title(meta.get("title"), None)
    document = {
        "title": title,
        "documentType": meta.get("documentType") or "other",
        "documentNumber": meta.get("documentNumber"),
        "documentDate": doc_date,
        "year": int(doc_date[:4]) if doc_date else None,
        "governmentBodyId": meta.get("governmentBodyId"),
        "governmentBodyName": meta.get("governmentBodyName"),
        "categories": categories_for(meta.get("documentType") or "other"),
        "mimeType": "text/html",
        "fileName": re.sub(r"[^A-Za-z0-9._ ()-]+", "_", title)[:120] + ".html",
        "fileSize": len(text.encode()),
        "pageCount": None,
        "sha256": sha,
        "textStatus": "extracted",
        "ocrStatus": "not_required",
        "archiveStatus": "not_archived",
        "dedupeMeeting": bool(meta.get("dedupeMeeting")),
        "currency": meta.get("currency"),
    }
    res = api.post("/documents", {"document": document, "source": {"canonicalKey": key, "sourceId": item["source_id"], "url": item["url"].replace("/book/content?", "/book?"), "parentUrl": item.get("parent_url"), "linkText": meta.get("entryName"), "retrievedAt": datetime.now(timezone.utc).isoformat(), "httpStatus": r.status_code}, "relationships": []})
    doc_id, status = res["documentId"], res["status"]
    counts.by_status[status] = counts.by_status.get(status, 0) + 1
    if status == "duplicate":
        counts.duplicates += 1
    elif status == "unchanged":
        counts.unchanged += 1
    else:
        counts.ingested += 1
    if res.get("needsChunks"):
        chunks = chunk_pages(extraction.pages)
        for off in range(0, len(chunks), CHUNK_BATCH):
            batch = [{"id": f"{doc_id}:c{c.index:05d}", "pageStart": c.page_start, "pageEnd": c.page_end, "sectionTitle": c.section_title, "text": c.text, "ocr": False} for c in chunks[off : off + CHUNK_BATCH]]
            api.post(f"/documents/{doc_id}/chunks", {"chunks": batch, "append": off > 0, "offset": off, "ocrStatus": "not_required"})
        counts.chunks += len(chunks)
    api.post("/queue/status", {"updates": [{"urlKey": key, "status": "done", "documentId": doc_id, "sha256": sha, "runId": run_id}]})
    log(f"  {status:<11} {doc_id} {title[:70]!r} (code site entry, {len(text)} chars)")


def requests_quote(url: str) -> str:
    from requests.utils import requote_uri

    return requote_uri(url)


def ingest(api: PortalApi, client: PoliteClient, run_id: str, limit: int, archive: bool = True, ocr: bool = False, time_budget_s: int = 5 * 3600, statuses=("pending",)) -> RunCounts:
    counts = RunCounts()
    storage: StorageProvider | None = None
    if archive:
        local_dir = os.environ.get("VTP_LOCAL_ARCHIVE_DIR")
        storage = LocalFilesystemStorage(local_dir) if local_dir else WorkerArchiveStorage(api)
    started = time.time()
    processed = 0
    errors: list[dict] = []
    for status in statuses:
        while processed < limit and time.time() - started < time_budget_s:
            page = api.get("/queue", status=status, limit=min(50, limit - processed))
            items = page.get("items") or []
            if not items:
                break
            for item in items:
                if processed >= limit or time.time() - started > time_budget_s:
                    break
                processed += 1
                try:
                    process(api, client, storage, item, run_id, counts, ocr)
                except BudgetReached:
                    raise
                except (HttpFailure, RobotsDisallowed, Exception) as e:  # noqa: BLE001 - one bad record must not stop the run
                    counts.errors += 1
                    http_status = getattr(e, "status", None)
                    attempts = int(item.get("attempts") or 0) + 1
                    robots = isinstance(e, RobotsDisallowed)
                    nxt = (datetime.now(timezone.utc) + timedelta(hours=min(72, 2 ** attempts))).isoformat()
                    upd = {"urlKey": item["url_key"], "status": "skipped" if robots else "error", "error": f"{type(e).__name__}: {e}"[:480], "nextAttemptAt": nxt, "runId": run_id}
                    errors.append({"runId": run_id, "sourceId": item.get("source_id"), "url": item["url"], "httpStatus": http_status, "errorType": "robots_disallowed" if robots else type(e).__name__, "message": str(e)[:900], "retryCount": attempts})
                    log(f"  ERROR {item['url'][:100]}: {e}")
                    try:
                        api.post("/queue/status", {"updates": [upd]})
                        if http_status in (404, 410):
                            api.post("/document-sources/availability", {"items": [{"canonicalKey": item["url_key"], "available": False, "httpStatus": http_status}]})
                        if len(errors) >= 20:
                            api.post("/errors", {"errors": errors})
                            errors = []
                    except BudgetReached:
                        raise
            if len(items) == 0:
                break
    if errors:
        api.post("/errors", {"errors": errors})
    return counts
