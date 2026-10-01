"""CivicClerk meeting portal (vineyardut.portal.civicclerk.com), read via its public OData API.

Verified live (2026-09-29): GET https://vineyardut.api.civicclerk.com/v1/Events returns events with
eventName, categoryName, startDateTime, eventLocation, externalMediaUrl, youtubeVideoId and
publishedFiles[{fileId, type, name, url, publishOn}]. Files download from
/v1/Meetings/GetMeetingFileStream(fileId=N,plainText=false).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterator
from urllib.parse import quote
from zoneinfo import ZoneInfo

from ..classify import slug
from ..urls import key_for
from .base import QueueItem, SourceAdapter

def local_start(value: object) -> datetime | None:
    """CivicClerk sends Vineyard wall-clock time with a "Z" suffix (a 6:00 PM council meeting
    arrives as ...T18:00:00Z), so the clock value is local Mountain time, not UTC."""
    try:
        return datetime.fromisoformat(str(value)[:19]).replace(tzinfo=TZ)
    except (TypeError, ValueError):
        return None


TENANT = "vineyardut"
API = f"https://{TENANT}.api.civicclerk.com/v1"
PORTAL = f"https://{TENANT}.portal.civicclerk.com"
TZ = ZoneInfo("America/Denver")

FILE_TYPES = {"agenda": ("agenda", "agenda", "MEETING_HAS_AGENDA"), "agenda packet": ("agenda_packet", "packet", "MEETING_HAS_PACKET"), "minutes": ("minutes", "minutes", "MEETING_HAS_MINUTES")}

BODY_KIND = [("council", "council"), ("commission", "commission"), ("redevelopment", "agency"), ("rda", "agency"), ("board", "board"), ("committee", "committee")]


def body_for(category: str | None) -> dict | None:
    if not category:
        return None
    name = category.strip()
    kind = next((k for needle, k in BODY_KIND if needle in name.lower()), "other")
    return {"id": slug(name), "name": name, "kind": kind}


def file_url(file_id: int) -> str:
    return f"{API}/Meetings/GetMeetingFileStream(fileId={int(file_id)},plainText=false)"


class CivicClerkAdapter(SourceAdapter):
    source_id = "vineyard-civicclerk-meetings"

    def __init__(self, client, lookahead_days: int = 60, page_size: int = 100, max_pages: int = 1000, since: str | None = None):
        super().__init__(client)
        self.lookahead_days = lookahead_days
        self.page_size = page_size
        self.max_pages = max_pages
        self.since = since

    def discover(self) -> list[str]:
        return [f"{API}/Events"]

    def events(self) -> Iterator[dict]:
        until = (datetime.now(timezone.utc) + timedelta(days=self.lookahead_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        flt = f"startDateTime lt {until}" + (f" and startDateTime ge {self.since}T00:00:00Z" if self.since else "")
        # The API pages server-side (15 events per page) and returns @odata.nextLink with a skip token.
        # No $top: on this API $top caps the TOTAL result count (nextLink carries the remainder), not the page size.
        url: str | None = f"{API}/Events?$filter={quote(flt)}&$orderby={quote('startDateTime desc')}"
        seen: set[int] = set()
        for _ in range(self.max_pages):
            if not url:
                return
            data = self.client.get_json(url)
            items = [e for e in (data.get("value") or []) if e.get("id") not in seen]
            if not items:
                return
            seen.update(e.get("id") for e in items)
            yield from items
            nxt = data.get("@odata.nextLink")
            url = nxt if isinstance(nxt, str) and nxt.startswith(f"{API}/Events") else None

    def list_documents(self) -> Iterator[QueueItem]:
        now = datetime.now(timezone.utc)
        for ev in self.events():
            if ev.get("isDeleted") or ev.get("isPublished") not in (None, "Published"):
                continue
            start = ev.get("startDateTime") or ev.get("eventDate")
            local = local_start(start)
            dt_utc = local.astimezone(timezone.utc) if local else None
            body = body_for(ev.get("categoryName") or ev.get("eventCategoryName"))
            if body:
                self.bodies[body["id"]] = body
            name = (ev.get("eventName") or "Meeting").strip()
            agenda_name = (ev.get("agendaName") or "").strip()
            label = f"{name} {agenda_name}".lower()
            meeting_type = "special" if "special" in label else "work_session" if "work session" in label else "emergency" if "emergency" in label else "regular" if "regular" in label or "meeting" in label else "other"
            meeting_id = f"mtg_cc_{int(ev['id'])}"
            media = []
            if ev.get("externalMediaUrl"):
                media.append({"kind": "video", "label": "Meeting video", "url": ev["externalMediaUrl"], "sourceId": self.source_id})
            if ev.get("youtubeVideoId"):
                media.append({"kind": "video", "label": "Meeting video (YouTube)", "url": f"https://www.youtube.com/watch?v={ev['youtubeVideoId']}", "sourceId": self.source_id})
            loc = ev.get("eventLocation") or {}
            location = ", ".join(x for x in [loc.get("address1"), loc.get("city"), loc.get("state")] if x) or None
            date_str = local.date().isoformat() if local else None
            title = agenda_name if agenda_name and agenda_name.lower() != name.lower() else name
            self.meetings.append(
                {
                    "id": meeting_id,
                    "slug": "-".join(x for x in [slug(title)[:100], date_str, str(ev["id"])] if x),  # event id keeps same-day, same-title events unique
                    "title": title,
                    "governmentBodyId": body["id"] if body else None,
                    "governmentBodyName": body["name"] if body else None,
                    "meetingType": meeting_type,
                    "date": date_str,
                    "startTime": local.strftime("%H:%M") if local else None,
                    "location": location,
                    "status": "cancelled" if "cancel" in f"{name} {agenda_name}".lower() else "held" if dt_utc and dt_utc < now else "scheduled",
                    "sourceId": self.source_id,
                    "sourceUrl": f"{PORTAL}/event/{int(ev['id'])}/files",
                    "externalId": str(ev["id"]),
                    "media": media,
                }
            )
            for f in ev.get("publishedFiles") or []:
                fid = f.get("fileId")
                if not fid:
                    continue
                ftype = (f.get("type") or "").strip().lower()
                doc_type, role, rel = FILE_TYPES.get(ftype, ("other", None, None))
                if doc_type == "other" and ftype:
                    from ..classify import classify_type

                    doc_type = classify_type(f.get("name"), ftype)
                yield QueueItem(
                    source_id=self.source_id,
                    url=file_url(fid),
                    key=key_for(f"civicclerk:{TENANT}:file:{int(fid)}"),
                    parent_url=f"{PORTAL}/event/{int(ev['id'])}/files",
                    priority=50 if role else 80,
                    metadata={
                        "title": (f.get("name") or f"{title} {f.get('type') or 'file'}").strip(),
                        "fileType": f.get("type"),
                        "documentType": doc_type,
                        "documentDate": date_str,
                        "meetingId": meeting_id,
                        "meetingTitle": title,
                        "meetingRole": role,
                        "relationship": rel,
                        "governmentBodyId": body["id"] if body else None,
                        "governmentBodyName": body["name"] if body else None,
                        "publishedAt": f.get("publishOn"),
                        "externalId": f"civicclerk:file:{int(fid)}",
                        # One record per meeting: the same minutes on the municipal code site attach here.
                        "dedupeMeeting": doc_type in ("minutes", "agenda", "agenda_packet"),
                        "fileNameHint": (f.get("url") or "").rsplit("/", 1)[-1],
                    },
                )
