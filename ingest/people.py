"""Who's who at Vineyard City, current as of the day it runs (nightly with the crawl).

Reads the city's own pages on vineyardutah.gov:
  government/city_council2.php            mayor and council members, terms, emails
  government/city_staff.php               every staff member: department, title, email, phone
  government/board___commission_members.php  board and commission members
and publishes three dated records ("... as of YYYY-MM-DD"). Each run replaces the previous
version, so answers about who holds a position always read today's list. Past officeholders are
answered from the minutes, ordinances and resolutions themselves.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date

from .api import PortalApi
from .chunk import chunk_pages
from .extract import Page
from .http import PoliteClient
from .urls import key_for

SOURCE_ID = "vineyard-city-website"
BASE = "https://www.vineyardutah.gov/"
PAGES = {
    "council": BASE + "government/city_council2.php",
    "mayor": BASE + "government/mayors_office.php",
    "staff": BASE + "government/city_staff.php",
    "boards": BASE + "government/board___commission_members.php",
}


def log(msg: str) -> None:
    print(f"[people] {msg}", flush=True)


def _soup(client: PoliteClient, url: str):
    from bs4 import BeautifulSoup

    r = client.request("GET", url, headers={"Accept": "text/html"}, timeout=60)
    if r.status_code >= 400:
        return None
    return BeautifulSoup(r.text, "html.parser")


def _clean(t: str | None) -> str:
    return re.sub(r"\s+", " ", (t or "")).strip()


def _titlecase(name: str) -> str:
    return " ".join(w.capitalize() if w.isupper() and len(w) > 1 else w for w in name.split())


def _cards(soup) -> list[dict]:
    """Revize directory cards: category, name (h2), title, email, phone."""
    out = []
    for card in soup.select(".rz-business-block"):
        name = _clean(card.find("h2").get_text() if card.find("h2") else "")
        if not name:
            continue
        title = _clean(card.select_one(".rz-business-desc").get_text() if card.select_one(".rz-business-desc") else "")
        cats = [_clean(li.get_text()) for li in card.select(".category-list li")]
        mail = next((a["href"][7:].split("?")[0].strip() for a in card.select('a[href^="mailto:"]')), None)
        tel = next((_clean(a.get_text()) or a["href"][4:] for a in card.select('a[href^="tel:"]')), None)
        out.append({"name": _titlecase(name), "title": title, "department": ", ".join(c for c in cats if c), "email": mail, "phone": tel})
    return out


def council(client: PoliteClient) -> list[dict]:
    soup = _soup(client, PAGES["council"])
    if not soup:
        return []
    text = _clean(soup.get_text(" "))
    people = []
    for m in re.finditer(r"\b(Mayor|Council Member|Councilmember)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}?)\s+TERM\s+(.+?)\s+Read More\s+(\S+@\S+)", text):
        term = re.sub(r"\bTHROUGH\b", "through", m.group(3).strip().rstrip("."))
        term = re.sub(r"\b([A-Z]{3,})\b", lambda x: x.group(1).title(), term)
        people.append({"role": "Mayor" if m.group(1) == "Mayor" else "Council Member", "name": m.group(2).strip(), "term": term, "email": m.group(4).strip()})
    return people


def build(client: PoliteClient, today: str | None = None) -> list[tuple[str, str, str, str]]:
    """(key, title, url, text) for each record."""
    today = today or date.today().isoformat()
    records = []

    officials = council(client)
    if officials:
        mayor = [p for p in officials if p["role"] == "Mayor"]
        members = [p for p in officials if p["role"] != "Mayor"]
        lines = [
            f"Vineyard City elected officials as of {today}, from the city's City Council page ({PAGES['council']}).",
            f"Vineyard has a mayor and {len(members)} City Council members.",
        ]
        for p in mayor:
            lines.append(f"Mayor: {p['name']}. Term {p['term']}. Email {p['email']}.")
        for p in members:
            lines.append(f"City Council Member: {p['name']}. Term {p['term']}. Email {p['email']}.")
        lines.append("Council email for the whole council: council@vineyardutah.org.")
        records.append(("people:officials", "Mayor and City Council (current)", PAGES["council"], "\n".join(lines)))

    soup = _soup(client, PAGES["staff"])
    staff = _cards(soup) if soup else []
    if staff:
        by_dept: dict[str, list[dict]] = {}
        for p in staff:
            by_dept.setdefault(p["department"] or "Other", []).append(p)
        lines = [f"Vineyard City staff directory as of {today}, from the city's City Staff page ({PAGES['staff']}). {len(staff)} staff members are listed."]
        for dept in sorted(by_dept):
            lines.append(f"\n{dept.title()}:")
            for p in sorted(by_dept[dept], key=lambda x: x["name"]):
                bits = [f"{p['name']}, {p['title'] or 'staff'}"]
                if p["email"]:
                    bits.append(f"email {p['email']}")
                if p["phone"]:
                    bits.append(f"phone {p['phone']}")
                lines.append("; ".join(bits) + ".")
        lines.append("\nCity Hall: 125 S Main St, Vineyard, UT 84059. Main phone 801-226-1929. Hours Monday to Thursday 8am to 5pm, Friday 8am to noon.")
        records.append(("people:staff", "City staff directory (current)", PAGES["staff"], "\n".join(lines)))
        # Leadership on its own record too, so "who is the city manager / deputy mayor" finds it first.
        leaders = [p for p in staff if re.search(r"official|executive", p["department"], re.I) or re.search(r"director|manager|recorder|mayor|attorney|chief|official", p["title"], re.I)]
        if leaders:
            lines = [f"Vineyard City leadership and department heads as of {today}, from the city's City Staff page."]
            for p in sorted(leaders, key=lambda x: (x["department"], x["name"])):
                lines.append(f"{p['title'] or 'Staff'}: {p['name']} ({p['department'].title() or 'Vineyard City'})" + (f", email {p['email']}" if p["email"] else "") + (f", phone {p['phone']}" if p["phone"] else "") + ".")
            records.append(("people:leadership", "City leadership and department heads (current)", PAGES["staff"], "\n".join(lines)))

    soup = _soup(client, PAGES["boards"])
    if soup:
        main = soup.select_one("#post") or soup
        for el in main.select("script, style, nav"):
            el.decompose()
        text = re.sub(r"\n\s*\n+", "\n", main.get_text("\n")).strip()
        if len(text) > 200:
            records.append(("people:boards", "Board and commission members (current)", PAGES["boards"], f"Vineyard boards and commissions as of {today}, from the city's Board & Commission Members page.\n{text[:20000]}"))
    return records


def run(api: PortalApi, client: PoliteClient) -> dict:
    today = date.today().isoformat()
    records = build(client, today)
    counts = {"records": len(records), "new_or_changed": 0, "unchanged": 0}
    for key, title, url, text in records:
        sha = hashlib.sha256(text.encode()).hexdigest()
        res = api.post(
            "/documents",
            {
                "document": {
                    "title": title,
                    "documentType": "other",
                    "documentDate": today,
                    "year": int(today[:4]),
                    "governmentBodyId": "city-council" if key == "people:officials" else None,
                    "governmentBodyName": "Vineyard City",
                    "mimeType": "text/plain",
                    "fileName": f"{key.replace(':', '-')}.txt",
                    "fileSize": len(text.encode()),
                    "pageCount": None,
                    "sha256": sha,
                    "textStatus": "extracted",
                    "ocrStatus": "not_required",
                    "archiveStatus": "not_archived",
                    "currency": "current",
                },
                "source": {"canonicalKey": key_for(f"vineyard:{key}"), "sourceId": SOURCE_ID, "url": url, "parentUrl": BASE, "linkText": title, "retrievedAt": f"{today}T00:00:00Z", "httpStatus": 200},
                "relationships": [],
            },
        )
        if res.get("needsChunks"):
            chunks = chunk_pages([Page(number=None, text=text, section=title)])
            api.post(f"/documents/{res['documentId']}/chunks", {"chunks": [{"id": f"{res['documentId']}:c{c.index:05d}", "pageStart": None, "pageEnd": None, "sectionTitle": title[:200], "text": c.text, "ocr": False} for c in chunks], "append": False, "offset": 0})
            counts["new_or_changed"] += 1
        else:
            counts["unchanged"] += 1
    log(f"{counts}")
    return counts
