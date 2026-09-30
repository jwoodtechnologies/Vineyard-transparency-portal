"""Metadata parsing from titles, filenames and source structure. Unknown stays None."""
from __future__ import annotations

import re
from datetime import date

TYPE_RULES: list[tuple[str, str]] = [
    (r"\bagenda\s*packet|\bpacket\b", "agenda_packet"),
    (r"\bagenda\b", "agenda"),
    (r"\bminutes\b", "minutes"),
    (r"\bordinance\b|\bord\.?\s*\d", "ordinance"),
    (r"\bresolution\b|\bres\.?\s*\d", "resolution"),
    (r"\bproclamation\b", "proclamation"),
    (r"development\s+agreement", "development_agreement"),
    (r"interlocal", "interlocal_agreement"),
    (r"professional\s+services", "professional_services_agreement"),
    (r"\baudit\b|observations\s+and\s+recommendations", "audit"),
    (r"annual\s+(comprehensive\s+)?financial\s+report|\bacfr\b|\bcafr\b|financial\s+statements?", "financial_report"),
    (r"\bbudget\b|budget\s+amendment|citizen'?s\s+budget", "budget"),
    (r"\brfp\b|\brfq\b|request\s+for\s+(proposals?|qualifications)|\bbid\b|procurement", "procurement"),
    (r"\bcontract\b|\bagreement\b", "contract"),
    (r"staff\s+report", "staff_report"),
    (r"public\s+notice|notice\s+of\b|public\s+hearing\s+notice", "public_notice"),
    (r"\bslides?\b|\bpresentation\b", "presentation"),
    (r"\bmemo(randum)?\b", "memorandum"),
    (r"\bmap\b", "map"),
    (r"master\s+plan|general\s+plan|\bplan\b", "plan"),
    (r"water\s+quality|consumer\s+confidence|\bccr\b|\bstudy\b|\breport\b|\banalysis\b", "study"),
]

MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"])}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
MONTHS["sept"] = 9


def classify_type(*texts: str | None) -> str:
    blob = " ".join(t for t in texts if t).lower().replace("_", " ")
    for pattern, kind in TYPE_RULES:
        if re.search(pattern, blob):
            return kind
    return "other"


def _valid(y: int, m: int, d: int) -> str | None:
    if not (1990 <= y <= date.today().year + 3):
        return None
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def parse_date(*texts: str | None) -> str | None:
    """First unambiguous full date printed in a title or filename."""
    for t in texts:
        if not t:
            continue
        s = t.replace("_", " ")
        for m in re.finditer(r"(?<!\d)(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)", s):
            if v := _valid(int(m[1]), int(m[2]), int(m[3])):
                return v
        for m in re.finditer(r"(?<!\d)(\d{1,2})[-_./](\d{1,2})[-_./](\d{4}|\d{2})(?!\d)(?!\.\d)", s):
            y = int(m[3])
            y = y + 2000 if y < 100 else y
            if v := _valid(y, int(m[1]), int(m[2])):
                return v
        for m in re.finditer(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", s):
            mon = MONTHS.get(m[1].lower())
            if mon and (v := _valid(int(m[3]), mon, int(m[2]))):
                return v
    return None


def parse_document_number(*texts: str | None) -> str | None:
    for t in texts:
        if not t:
            continue
        m = re.search(r"\b(ordinance|resolution)\s*(?:no\.?|number|#)?\s*(\d{2,4}\s*-\s*\d{1,4}[A-Za-z]?)\b", t, re.I)
        if m:
            number = re.sub(r"\s+", "", m[2])
            return f"{m[1].title()} {number}"
    return None


def clean_title(text: str | None, fallback_filename: str) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if not t or t.lower() in {"click here", "here", "download", "view", "pdf", "link"}:
        t = re.sub(r"\.[A-Za-z0-9]{2,5}$", "", fallback_filename).replace("_", " ").strip()
    t = re.sub(r"\.(pdf|docx?|xlsx?|csv|txt)$", "", t, flags=re.I).strip()
    return t[:300] or "Untitled record"


CATEGORY_TYPES = {
    "meetings": ["agenda", "agenda_packet", "minutes", "transcript", "recording"],
    "agendas": ["agenda"],
    "agenda_packets": ["agenda_packet"],
    "minutes": ["minutes"],
    "ordinances": ["ordinance"],
    "resolutions": ["resolution"],
    "contracts": ["contract", "interlocal_agreement", "professional_services_agreement"],
    "development_agreements": ["development_agreement"],
    "budgets_finance": ["budget", "financial_report"],
    "audits": ["audit"],
    "planning_land_use": ["plan", "staff_report"],
    "public_notices": ["public_notice"],
    "reports_studies": ["study", "memorandum", "presentation"],
    "procurement": ["procurement"],
    "maps": ["map"],
    "other": ["other", "correspondence", "exhibit", "proclamation", "municipal_code"],
}


def categories_for(doc_type: str) -> list[str]:
    return [c for c, types in CATEGORY_TYPES.items() if doc_type in types]


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80] or "body"
