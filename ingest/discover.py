"""sources:discover: inventory every link on the live transparency portal page."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from .http import PoliteClient
from .sources import SEED_URL, categorize
from .urls import extension, host, normalize_url


def _text(el) -> str:
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True) or el.get("aria-label", "") or el.get("title", "")).strip()


# Revize page layout verified on the live portal (2026-09-29): MAIN#main > ... > DIV#entry holds the
# page's own links; #menu-content is the site navigation and must not be treated as content.
CONTENT_SELECTORS = ["#entry", "#freeform-main", "#post", "main#main", "main", "#content"]


def content_root(soup):
    for sel in CONTENT_SELECTORS:
        el = soup.select_one(sel)
        if el is not None:
            return el
    return soup.body or soup


def inventory(html: str, page_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    main = content_root(soup)
    main_links = {id(a) for a in main.find_all("a", href=True)} if main is not None else set()
    out: list[dict] = []
    seen: set[str] = set()

    def add(kind: str, text: str, raw: str, el):
        if not raw or raw.startswith(("javascript:", "#", "mailto:", "tel:")):
            return
        resolved = normalize_url(raw, page_url)
        k = f"{kind}|{resolved}|{text}"
        if k in seen:
            return
        seen.add(k)
        cat = categorize(resolved)
        out.append(
            {
                "elementType": kind,
                "displayText": text,
                "href": raw,
                "resolvedUrl": resolved,
                "domain": host(resolved),
                "fileType": extension(resolved) or None,
                "parentPage": page_url,
                "internal": host(resolved) == host(page_url),
                "inMainContent": id(el) in main_links,
                **cat,
            }
        )

    for a in soup.find_all("a", href=True):
        add("a", _text(a), a["href"], a)
    for b in soup.find_all(["button", "input"]):
        m = re.search(r"location(?:\.href)?\s*=\s*['\"]([^'\"]+)", b.get("onclick", "") or "")
        if m:
            add("button", _text(b) or b.get("value", ""), m.group(1), b)
    for f in soup.find_all(["iframe", "embed", "object"]):
        add(f.name, f.get("title", ""), f.get("src") or f.get("data") or "", f)
    return out


def discover(client: PoliteClient, follow_depth: int = 1) -> dict:
    html, final = client.get_text(SEED_URL)
    links = inventory(html, final)
    pages = [SEED_URL]
    if follow_depth:
        # Record external systems linked one level down (e.g. Transparent Utah on the Budget page).
        for link in [l for l in links if l["category"] == "city_page" and l["crawlable"] and l["inMainContent"]]:
            try:
                sub_html, sub_final = client.get_text(link["resolvedUrl"])
            except Exception as e:  # noqa: BLE001
                link["notes"] = f"{link['notes']} Fetch failed: {e}".strip()
                continue
            link["redirectedTo"] = sub_final if sub_final != link["resolvedUrl"] else None
            pages.append(sub_final)
            for sub in inventory(sub_html, sub_final):
                if not sub["internal"] and sub["category"] not in ("social_media", "third_party", "cms_login", "non_http"):
                    sub["discoveredVia"] = link["resolvedUrl"]
                    links.append(sub)
    by_cat: dict[str, int] = {}
    for l in links:
        by_cat[l["category"]] = by_cat.get(l["category"], 0) + 1
    return {
        "seed": SEED_URL,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pagesInspected": pages,
        "linkCount": len(links),
        "countsByCategory": by_cat,
        "sourceIds": sorted({l["sourceId"] for l in links if l.get("sourceId")}),
        "links": links,
    }


def main_content_seeds(manifest: dict) -> list[str]:
    """City pages linked from the portal's main content, used as crawl seeds."""
    return sorted({l["resolvedUrl"] for l in manifest["links"] if l["category"] == "city_page" and l["crawlable"] and l.get("inMainContent") and l["parentPage"].startswith(SEED_URL.split("/index")[0])})


if __name__ == "__main__":
    print(json.dumps(discover(PoliteClient(), follow_depth=0), indent=2)[:4000])
