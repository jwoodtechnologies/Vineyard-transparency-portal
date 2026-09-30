"""Utah County Sheriff's Office press releases (sheriff.utahcounty.gov).

The office publishes its whole release archive as public JSON (/api/news/archive: id, headline,
body_short, entered_date); each release has a public page (/media/sheriffNewsDetails?ID=n). Every
release is queued; the indexer keeps only releases whose full text mentions Vineyard, so the
archive gains the Vineyard-related ones without county-wide noise. Keys and metadata match the
hourly check in worker/cron.ts.
"""
from __future__ import annotations

import html
import re
from typing import Iterator

from ..urls import key_for
from .base import QueueItem, SourceAdapter

ARCHIVE = "https://sheriff.utahcounty.gov/api/news/archive"
LISTING = "https://sheriff.utahcounty.gov/media/pressArchive"


def page_url(release_id: int) -> str:
    return f"https://sheriff.utahcounty.gov/media/sheriffNewsDetails?ID={int(release_id)}"


def clean(text: str | None) -> str:
    t = re.sub(r"<[^>]+>", " ", text or "")
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t).strip()


class SheriffAdapter(SourceAdapter):
    source_id = "ucso-press-releases"

    def discover(self) -> list[str]:
        return [ARCHIVE]

    def list_documents(self) -> Iterator[QueueItem]:
        data = self.client.get_json(ARCHIVE)
        items = data if isinstance(data, list) else data.get("data") or []
        for it in items:
            rid = it.get("id")
            if not isinstance(rid, int):
                continue
            yield QueueItem(
                source_id=self.source_id,
                url=page_url(rid),
                key=key_for(f"ucso:press:{rid}"),
                parent_url=LISTING,
                priority=60,
                metadata={
                    "kind": "press_release",
                    "title": clean(it.get("headline"))[:300] or "Press release",
                    "documentType": "public_notice",
                    "documentDate": str(it.get("entered_date") or "")[:10] or None,
                    "requireMention": "vineyard",
                    "governmentBodyName": "Utah County Sheriff's Office",
                },
            )
