"""crawl → queue → download → hash → dedupe → archive → extract → chunk → index. Resumable."""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .adapters import CivicClerkAdapter, VineyardWebsiteAdapter
from .api import BudgetReached, PortalApi
from .chunk import chunk_pages
from .classify import categories_for, classify_type, clean_title, parse_date, parse_document_number
from .discover import discover, main_content_seeds
from .extract import extract, sniff
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
        if mime.startswith("text/html"):
            api.post("/queue/status", {"updates": [{"urlKey": key, "status": "skipped", "error": "HTML page, not a document", "runId": run_id}]})
            return

        extraction = extract(dl.path, ext, mime, ocr=ocr) if dl.path else None
        title = clean_title(meta.get("title") or meta.get("linkText"), meta.get("fileName") or filename(url))
        doc_type = meta.get("documentType") or classify_type(title, meta.get("fileName"), meta.get("sectionHeading"), meta.get("pageTitle"))
        doc_date = meta.get("documentDate") or parse_date(title, meta.get("fileName"), meta.get("linkText"))
        document = {
            "title": title,
            "documentType": doc_type,
            "documentNumber": parse_document_number(title, meta.get("fileName")),
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

        if res.get("needsArchive") and storage and dl.path and dl.sha256:
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
