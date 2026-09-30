"""Vineyard City website (Revize CMS): department pages linked from the transparency portal and
the documents they publish. Follows only allowlisted record-listing pages on city hosts."""
from __future__ import annotations

import re
from typing import Iterator

from bs4 import BeautifulSoup

from ..discover import content_root
from ..sources import CITY_HOSTS, categorize
from ..urls import extension, filename, host, normalize_url, url_key
from .base import QueueItem, SourceAdapter

RDA_HINT = re.compile(r"redevelopment|/rda|\brda\b", re.I)


class VineyardWebsiteAdapter(SourceAdapter):
    source_id = "vineyard-city-website"

    def __init__(self, client, seeds: list[str], max_depth: int = 1, max_pages: int = 80):
        super().__init__(client)
        self.seeds = seeds
        self.max_depth = max_depth
        self.max_pages = max_pages
        self.pages_read: list[str] = []
        self.page_errors: list[dict] = []

    def discover(self) -> list[str]:
        return list(self.seeds)

    def list_documents(self) -> Iterator[QueueItem]:
        frontier = [(normalize_url(s), 0) for s in self.seeds]
        seen_pages: set[str] = set()
        seen_docs: set[str] = set()
        while frontier and len(self.pages_read) < self.max_pages:
            page, depth = frontier.pop(0)
            if page in seen_pages:
                continue
            seen_pages.add(page)
            try:
                html, final = self.client.get_text(page)
            except Exception as e:  # noqa: BLE001
                self.page_errors.append({"url": page, "error": str(e)[:300]})
                continue
            self.pages_read.append(final)
            soup = BeautifulSoup(html, "html.parser")
            page_title = (soup.title.get_text(" ", strip=True) if soup.title else "").strip()
            h1 = soup.find(["h1"])
            page_heading = h1.get_text(" ", strip=True) if h1 else page_title
            content = content_root(soup)
            for a in content.find_all("a", href=True):
                href = a["href"].strip()
                if href.startswith(("#", "javascript:", "mailto:", "tel:")):
                    continue
                url = normalize_url(href, final)
                if host(url) not in CITY_HOSTS:
                    continue
                cat = categorize(url)
                if cat["category"] == "document":
                    key = url_key(url)
                    if key in seen_docs:
                        continue
                    seen_docs.add(key)
                    heading = a.find_previous(["h2", "h3", "h4", "strong"])
                    text = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
                    body = {"id": "redevelopment-agency", "name": "Vineyard Redevelopment Agency", "kind": "agency"} if RDA_HINT.search(final) or RDA_HINT.search(text) else None
                    if body:
                        self.bodies[body["id"]] = body
                    yield QueueItem(
                        source_id=self.source_id,
                        url=url,
                        key=key,
                        parent_url=final,
                        priority=100 + depth * 10,
                        metadata={
                            "linkText": text or None,
                            "pageTitle": page_heading or None,
                            "sectionHeading": heading.get_text(" ", strip=True)[:200] if heading else None,
                            "fileName": filename(url),
                            "extension": extension(url),
                            "governmentBodyId": body["id"] if body else None,
                            "governmentBodyName": body["name"] if body else None,
                        },
                    )
                elif cat["category"] == "city_page" and cat["crawlable"] and depth < self.max_depth:
                    frontier.append((url, depth + 1))
