"""Source registry: which systems are crawled, and how links found on the portal are classified."""
from __future__ import annotations

from urllib.parse import urlsplit

SEED_URL = "https://www.vineyardutah.gov/transparency_portal/index.php"

CITY_HOSTS = {"vineyardutah.gov", "vineyardutah.org"}

# Paths on the city site whose pages are record listings worth following.
CITY_PAGE_PREFIXES = ("/government/", "/transparency_portal/", "/community_/newsletters", "/services/utility_billing")
CITY_PAGE_EXCLUDE = ("calendar.php", "report-a-concern", "/revize/", "/security/", "search.php", "/contact/")

SOURCES = [
    {
        "id": "vineyard-transparency-portal",
        "name": "Vineyard City Transparency Portal",
        "baseUrl": SEED_URL,
        "sourceType": "transparency_portal",
        "authority": "Vineyard City",
        "crawlEnabled": True,
        "archiveEnabled": True,
        "documentDiscoveryEnabled": True,
        "description": "The city's transparency landing page. Primary seed for source discovery.",
        "notes": "Authoritative starting point; links are re-inventoried on every discovery run.",
    },
    {
        "id": "vineyard-city-website",
        "name": "Vineyard City website",
        "baseUrl": "https://www.vineyardutah.gov/",
        "sourceType": "city_website",
        "authority": "Vineyard City",
        "crawlEnabled": True,
        "archiveEnabled": True,
        "documentDiscoveryEnabled": True,
        "description": "Department pages linked from the transparency portal (budget, finance, recorder, RDA, water quality, elections and others) and the documents they publish.",
        "notes": "Revize CMS. Document links carry a ?t= cache-buster that changes when a file is replaced.",
    },
    {
        "id": "vineyard-civicclerk-meetings",
        "name": "Vineyard Government Meetings & Decisions (CivicClerk)",
        "baseUrl": "https://vineyardut.portal.civicclerk.com/",
        "sourceType": "meeting_portal",
        "authority": "Vineyard City",
        "crawlEnabled": True,
        "archiveEnabled": True,
        "documentDiscoveryEnabled": True,
        "description": "Meeting calendar with published agendas, agenda packets and minutes for the City Council, Planning Commission, RDA and boards.",
        "notes": "Read through the public API behind the portal (vineyardut.api.civicclerk.com/v1/Events). Meeting video links (SuiteOne Media / YouTube) are stored as links only.",
    },
    {
        "id": "vineyard-municipal-code",
        "name": "Vineyard Municipal Code (municipalcodeonline.com)",
        "baseUrl": "https://vineyard.municipalcodeonline.com/",
        "sourceType": "municipal_code",
        "authority": "Vineyard City",
        "crawlEnabled": False,
        "archiveEnabled": False,
        "documentDiscoveryEnabled": False,
        "description": "Codified municipal code, zoning code, resolutions and ordinance index.",
        "notes": "Client-rendered application; not crawled yet. Linked for reference.",
    },
    {
        "id": "transparent-utah",
        "name": "Transparent Utah",
        "baseUrl": "https://transparent.utah.gov/",
        "sourceType": "financial_transparency",
        "authority": "State of Utah",
        "crawlEnabled": False,
        "archiveEnabled": False,
        "documentDiscoveryEnabled": False,
        "description": "State financial transparency site linked from the city's Budget and Finance pages.",
        "notes": "Interactive data application; datasets are not crawled yet. Linked for reference.",
    },
    {
        "id": "vineyard-gis",
        "name": "Vineyard City Maps (ArcGIS)",
        "baseUrl": "https://experience.arcgis.com/experience/5d675261cad649ffb85deee52dcbe1cb",
        "sourceType": "gis_portal",
        "authority": "Vineyard City",
        "crawlEnabled": False,
        "archiveEnabled": False,
        "documentDiscoveryEnabled": False,
        "description": "Interactive city maps linked from the transparency portal.",
        "notes": "Interactive map application; not crawled.",
    },
]


def categorize(url: str) -> dict:
    """Classifies a link found on a portal page. Returns category, source id and crawlability."""
    parts = urlsplit(url)
    h = parts.netloc.lower().removeprefix("www.")
    path = parts.path.lower()
    ext = path.rsplit(".", 1)[-1] if "." in path.rsplit("/", 1)[-1] else ""
    if parts.scheme not in ("http", "https"):
        return {"category": "non_http", "sourceId": None, "crawlable": False, "notes": "Not an HTTP link."}
    if h in ("facebook.com", "twitter.com", "x.com", "reddit.com", "instagram.com", "linkedin.com", "youtube.com", "nextdoor.com"):
        return {"category": "social_media", "sourceId": None, "crawlable": False, "notes": "Social media; excluded by crawl boundaries."}
    if h in CITY_HOSTS:
        if "/revize/" in path or "security" in path:
            return {"category": "cms_login", "sourceId": None, "crawlable": False, "notes": "CMS login; never accessed."}
        if ext in ("pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "ppt", "pptx"):
            return {"category": "document", "sourceId": "vineyard-city-website", "crawlable": True, "notes": ""}
        if any(x in path for x in CITY_PAGE_EXCLUDE):
            return {"category": "city_page_excluded", "sourceId": None, "crawlable": False, "notes": "Calendar/forms/search pages are not record listings."}
        crawl = path.startswith(CITY_PAGE_PREFIXES) or path in ("/", "/index.php")
        return {"category": "city_page", "sourceId": "vineyard-city-website", "crawlable": crawl and path not in ("/", "/index.php"), "notes": "" if crawl else "Outside record-listing sections."}
    if h.endswith("civicclerk.com"):
        return {"category": "meeting_portal", "sourceId": "vineyard-civicclerk-meetings", "crawlable": True, "notes": "Crawled through its public API."}
    if h.endswith("municipalcodeonline.com"):
        return {"category": "municipal_code", "sourceId": "vineyard-municipal-code", "crawlable": False, "notes": "Client-rendered code library."}
    if h == "transparent.utah.gov":
        return {"category": "financial_transparency", "sourceId": "transparent-utah", "crawlable": False, "notes": "State data application."}
    if h.endswith("arcgis.com"):
        return {"category": "gis", "sourceId": "vineyard-gis", "crawlable": False, "notes": "Interactive map."}
    if h.endswith("suiteonemedia.com"):
        return {"category": "meeting_media", "sourceId": "vineyard-civicclerk-meetings", "crawlable": False, "notes": "Meeting video; stored as a link only."}
    if h.endswith("utah.gov"):
        return {"category": "utah_government", "sourceId": None, "crawlable": False, "notes": "Utah government resource; not yet configured as a source."}
    if "applicantpro" in h:
        return {"category": "jobs", "sourceId": None, "crawlable": False, "notes": "Job listings; not public records."}
    if h in ("goo.gl", "google.com", "maps.google.com") or h.endswith("revize.com"):
        return {"category": "third_party", "sourceId": None, "crawlable": False, "notes": "Third-party site."}
    return {"category": "external", "sourceId": None, "crawlable": False, "notes": "Outside the allowlist."}
