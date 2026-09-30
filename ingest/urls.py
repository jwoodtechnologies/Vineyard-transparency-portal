"""URL canonicalization and stable keys."""
from __future__ import annotations

import hashlib
import re
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlsplit, urlunsplit

# Query parameters that only bust caches on Revize sites (?t=202606231131570). The value still
# matters for change detection, so it is kept in the fetch URL but dropped from the canonical key.
CACHE_BUSTERS = {"t", "_", "v", "ver", "cb"}

DOCUMENT_EXTENSIONS = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
    "txt": "text/plain",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "rtf": "application/rtf",
}
MEDIA_EXTENSIONS = {"mp4", "mov", "m4v", "webm", "mp3", "m4a", "wav", "wma", "wmv", "avi", "flv", "ogg"}
IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "tif", "tiff", "webp"}


def normalize_url(url: str, base: str | None = None) -> str:
    """Absolute URL with spaces encoded, fragment removed, host lower-cased."""
    raw = urljoin(base, url.strip()) if base else url.strip()
    parts = urlsplit(raw)
    path = quote(unquote(parts.path), safe="/%:@!$&'()*+,;=-._~")
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path or "/", parts.query, ""))


def canonical_url(url: str) -> str:
    parts = urlsplit(normalize_url(url))
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in CACHE_BUSTERS]
    host = parts.netloc.removeprefix("www.")
    return urlunsplit(("https", host, parts.path, urlencode(sorted(query)), ""))


def url_key(url: str) -> str:
    return hashlib.sha256(canonical_url(url).encode()).hexdigest()


def key_for(identifier: str) -> str:
    """Stable key for records whose identity is not a URL (e.g. civicclerk:vineyardut:file:3340)."""
    return hashlib.sha256(identifier.encode()).hexdigest()


def extension(url: str) -> str:
    path = unquote(urlsplit(url).path).lower()
    m = re.search(r"\.([a-z0-9]{2,5})$", path)
    return m.group(1) if m else ""


def filename(url: str) -> str:
    name = unquote(urlsplit(url).path).rstrip("/").split("/")[-1]
    return name[:300]


def host(url: str) -> str:
    return urlsplit(url).netloc.lower().removeprefix("www.")
