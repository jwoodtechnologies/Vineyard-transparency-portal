"""Vineyard's municipalcodeonline.com books: minutes since incorporation (May 11, 1989), every
resolution and ordinance since 1989, and the codified Municipal, Zoning and Subdivision codes.

The site's own pages read two public endpoints, and so does this adapter:
  GET /book/expand?type=<book>&id=<node>    table of contents (JSON nodes with id, name, hasChildren)
  GET /book/content?type=<book>&name=<node> one entry ({"Text": "<html>", "Success": true})
Both expect the two headers the site's pages send on every request (X-Requested-With and a fixed
"x-csrf: 1" request-forgery guard). There is no robots.txt; requests are paced like every source.

One record per thing, never two: a meeting, resolution or ordinance with a PDF is indexed as that
PDF, with the site's written summary added in front of its text. Entries without a PDF, and code
sections, are indexed from their own text.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Iterator
from urllib.parse import quote, urlencode

from ..urls import key_for
from .base import QueueItem, SourceAdapter

HOST = "https://vineyard.municipalcodeonline.com"
HEADERS = {"X-Requested-With": "XMLHttpRequest", "x-csrf": "1", "Accept": "application/json, */*"}

# book type -> (label, kind of entries)
BOOKS = {
    "minutes": ("Agenda & Minutes", "minutes"),
    "resolutions": ("Municipal Resolutions", "resolution"),
    "orddoc": ("Ordinances", "ordinance"),
    "ordinances": ("Municipal Code", "code"),
    "zoning": ("Zoning Code", "code"),
    "subdivords": ("Subdivision Code", "code"),
    "districts": ("Special Purpose Zoning Districts", "code"),
    "landscaping": ("Vineyard Tree and Landscape Manual", "code"),
    "plan": ("General Plan", "plan"),
}

BODIES = [
    (re.compile(r"redevelopment|\brda\b", re.I), {"id": "redevelopment-agency", "name": "Vineyard Redevelopment Agency", "kind": "agency"}),
    (re.compile(r"planning", re.I), {"id": "planning-commission", "name": "Planning Commission", "kind": "commission"}),
    (re.compile(r"council", re.I), {"id": "city-council", "name": "City Council", "kind": "council"}),
]

MONTHS = r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
DATE_RE = re.compile(rf"\b({MONTHS})\.?\s+(\d{{1,2}}),?\s+(\d{{4}})\b", re.I)
NUM_RE = re.compile(r"\b((?:19|20)\d{2})\s*-\s*(\d{1,3}[A-Z]?)\b")


def content_url(book: str, node_id: str) -> str:
    q = urlencode({"type": book, "name": node_id, "highlightTerm": "", "editing": "false", "printing": "false", "bookDataId": ""})
    return f"{HOST}/book/content?{q}"


def expand_url(book: str, node_id: str | None) -> str:
    q = {"type": book}
    if node_id:
        q["id"] = node_id
    return f"{HOST}/book/expand?{urlencode(q)}"


def body_for(path: list[str]) -> dict | None:
    joined = " ".join(path)
    for rx, body in BODIES:
        if rx.search(joined):
            return body
    return None


def meeting_date(name: str) -> str | None:
    m = DATE_RE.search(name)
    if not m:
        return None
    try:
        return datetime.strptime(f"{m.group(1)[:3].title()} {int(m.group(2))} {m.group(3)}", "%b %d %Y").date().isoformat()
    except ValueError:
        return None


def entry_metadata(book: str, path: list[str], name: str) -> dict:
    """What an entry is, from where it sits in the book."""
    label, kind = BOOKS[book]
    meta: dict = {"kind": "mco_content", "book": book, "bookLabel": label, "entryKind": kind, "path": path[-4:], "entryName": name}
    if kind == "minutes":
        body = body_for(path)
        date = meeting_date(name)
        council = body and body["id"] == "city-council"
        # Vineyard was a town until it became a city; the book's own section names say which.
        body_label = ("Town Council" if any("Town Council" in p and "City" not in p for p in path) else "City Council") if council else (body or {}).get("name", "Meeting")
        special = "special" in name.lower()
        meta.update(
            title=f"{body_label} {'special ' if special else ''}meeting minutes, {name.strip()}",
            documentType="minutes",
            documentDate=date,
            governmentBodyId=body["id"] if body else None,
            governmentBodyName=body_label if council else (body or {}).get("name"),
            dedupeMeeting=True,
        )
    elif kind in ("resolution", "ordinance"):
        num = NUM_RE.search(name)
        year = next((int(m) for m in re.findall(r"\b(19[89]\d|20\d{2})\b", " ".join([name, *path]))), None)
        rda = any(re.search(r"\bRDA\b|redevelopment", p, re.I) for p in path)
        title = re.sub(r"^ORD\s+", "Ordinance ", name.strip()) if kind == "ordinance" else (f"{'RDA ' if rda else ''}Resolution {name.strip()}" if not name.lower().startswith("resolution") else name.strip())
        meta.update(
            title=title,
            documentType=kind,
            documentNumber=f"{num.group(1)}-{num.group(2)}" if num else None,
            documentDate=f"{year}-01-01" if year else None,
            datePrecision="year",
            governmentBodyId="redevelopment-agency" if rda else "city-council",
            governmentBodyName="Vineyard Redevelopment Agency" if rda else "City Council",
        )
    else:
        meta.update(
            title=f"{label}: {name.strip()}" if name.strip().lower() != "preface" else f"{label}: Preface",
            documentType="plan" if kind == "plan" else "municipal_code",
            governmentBodyId="city-council",
            governmentBodyName="City Council",
            currency="current",
        )
    return meta


class MunicipalCodeAdapter(SourceAdapter):
    source_id = "vineyard-municipal-code"

    def __init__(self, client, books: list[str] | None = None, max_nodes: int = 40000):
        super().__init__(client)
        self.books = books or list(BOOKS)
        self.max_nodes = max_nodes
        self.counts: dict[str, int] = {}

    def discover(self) -> list[str]:
        return [expand_url(b, None) for b in self.books]

    def expand(self, book: str, node_id: str | None) -> list[dict]:
        r = self.client.request("GET", expand_url(book, node_id), headers=HEADERS, timeout=60)
        if r.status_code >= 400:
            return []
        try:
            data = r.json()
        except ValueError:
            return []
        return [n for n in data if isinstance(n, dict) and n.get("is_published", True) and not n.get("is_deleted")] if isinstance(data, list) else []

    def list_documents(self) -> Iterator[QueueItem]:
        seen = 0
        for book in self.books:
            stack: list[tuple[str | None, list[str]]] = [(None, [])]
            while stack and seen < self.max_nodes:
                node_id, path = stack.pop()
                for n in self.expand(book, node_id):
                    seen += 1
                    nid, name = str(n.get("id") or ""), str(n.get("name") or "").strip()
                    if not nid:
                        continue
                    if n.get("hasChildren"):
                        stack.append((nid, [*path, name]))
                        continue
                    if book == "minutes" and name.lower() == "preface":
                        continue
                    self.counts[book] = self.counts.get(book, 0) + 1
                    meta = entry_metadata(book, path, name)
                    # Minutes, resolutions and ordinances are small and are the whole history: they go
                    # ahead of everything else. Code sections next; giant agenda packets go last.
                    yield QueueItem(
                        source_id=self.source_id,
                        url=content_url(book, nid),
                        key=key_for(f"mco:vineyard:{book}:{nid}"),
                        parent_url=f"{HOST}/book?type={quote(book)}",
                        kind="document",
                        priority=30 if BOOKS[book][1] in ("minutes", "resolution", "ordinance") else 60,
                        metadata=meta,
                    )
