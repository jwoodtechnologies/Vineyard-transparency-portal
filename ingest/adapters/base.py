"""SourceAdapter contract shared by every source."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator

from ..http import Download, PoliteClient
from ..urls import url_key


@dataclass
class QueueItem:
    source_id: str
    url: str
    key: str
    parent_url: str | None = None
    kind: str = "document"
    priority: int = 100
    metadata: dict = field(default_factory=dict)

    def to_api(self, run_id: str | None = None) -> dict:
        return {"urlKey": self.key, "sourceId": self.source_id, "url": self.url, "kind": self.kind, "priority": self.priority, "parentUrl": self.parent_url, "metadata": self.metadata, "runId": run_id}


class SourceAdapter:
    source_id: str = ""

    def __init__(self, client: PoliteClient):
        self.client = client
        self.meetings: list[dict] = []
        self.bodies: dict[str, dict] = {}

    def discover(self) -> list[str]:
        """Pages or endpoints this adapter will read (for the source manifest)."""
        return []

    def list_documents(self) -> Iterator[QueueItem]:
        raise NotImplementedError

    def get_canonical_id(self, url: str) -> str:
        return url_key(url)

    def fetch_metadata(self, item: dict) -> dict:
        return dict(item.get("metadata") or {})

    def download(self, item: dict, max_bytes: int) -> Download:
        return self.client.download(item["url"], etag=item.get("known_etag"), last_modified=item.get("known_last_modified"), max_bytes=max_bytes)

    def normalize(self, item: dict, metadata: dict) -> dict:
        """Adapter-specific cleanup of document metadata before publishing."""
        return metadata
