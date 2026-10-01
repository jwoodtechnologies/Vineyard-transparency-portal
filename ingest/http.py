"""Polite HTTP client: identification, robots.txt, per-domain pacing, retries with backoff."""
from __future__ import annotations

import re

import hashlib
import os
import random
import tempfile
import threading
import time
import urllib.robotparser
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

import requests

USER_AGENT = os.environ.get(
    "VTP_USER_AGENT",
    "VineyardTransparencyPortal/1.0 (+https://vineyardportal.org/about)",
)
MIN_INTERVAL = float(os.environ.get("VTP_MIN_INTERVAL_SECONDS", "1.0"))  # ~1 request/second/domain
MAX_RETRIES = 4


# Public ArcGIS REST APIs (the city's GIS layers) and Amazon S3 (where the municipal code site keeps
# its PDFs) publish no robots.txt and answer 403 for it.
# RFC 9309 section 2.3.1.3: a 4xx robots.txt response means no crawl restrictions.
API_HOST = re.compile(r"(^|\.)services\d*\.arcgis\.com$|^s3([.-][a-z0-9-]+)?\.amazonaws\.com$|\.s3([.-][a-z0-9-]+)?\.amazonaws\.com$", re.I)


class RobotsDisallowed(Exception):
    pass


class HttpFailure(Exception):
    def __init__(self, status: int | None, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


@dataclass
class Download:
    url: str
    final_url: str
    status: int
    path: str | None
    size: int
    sha256: str | None
    content_type: str
    etag: str | None
    last_modified: str | None
    not_modified: bool = False
    truncated: bool = False


class PoliteClient:
    def __init__(self, respect_robots: bool = True):
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.8"})
        self.respect_robots = respect_robots
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()
        # At most 2 in-flight requests per domain.
        self._slots: dict[str, threading.Semaphore] = {}
        self.requests_made = 0

    # -- robots -------------------------------------------------------------------------------
    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                self._pace(parts.netloc)
                r = self.session.get(f"{origin}/robots.txt", timeout=20)
                self.requests_made += 1
                if r.status_code in (401, 403) and not API_HOST.search(parts.netloc):
                    # Conservative for websites: a locked robots.txt is read as "keep out".
                    rp.parse(["User-agent: *", "Disallow: /"])
                elif r.status_code >= 400:
                    rp.parse([])  # no robots.txt → everything allowed
                else:
                    rp.parse(r.text.splitlines())
            except requests.RequestException:
                rp = None  # unreachable robots.txt: treat as allowed, per RFC 9309 §2.3.1.3
            self._robots[origin] = rp
        rp = self._robots[origin]
        return True if rp is None else rp.can_fetch(USER_AGENT, url)

    def crawl_delay(self, netloc: str) -> float:
        for origin, rp in self._robots.items():
            if rp is not None and urlsplit(origin).netloc == netloc:
                d = rp.crawl_delay(USER_AGENT)
                if d:
                    return max(MIN_INTERVAL, float(d))
        return MIN_INTERVAL

    # -- pacing -------------------------------------------------------------------------------
    def _pace(self, netloc: str) -> None:
        with self._lock:
            wait = self._last.get(netloc, 0) + self.crawl_delay(netloc) - time.monotonic()
            self._last[netloc] = max(time.monotonic(), self._last.get(netloc, 0) + self.crawl_delay(netloc))
        if wait > 0:
            time.sleep(wait)

    def _slot(self, netloc: str) -> threading.Semaphore:
        with self._lock:
            return self._slots.setdefault(netloc, threading.Semaphore(2))

    # -- requests -----------------------------------------------------------------------------
    def request(self, method: str, url: str, *, headers: dict | None = None, stream: bool = False, timeout: float = 60) -> requests.Response:
        if not self.allowed(url):
            raise RobotsDisallowed(url)
        netloc = urlsplit(url).netloc
        attempt = 0
        while True:
            with self._slot(netloc):
                self._pace(netloc)
                try:
                    r = self.session.request(method, url, headers=headers, stream=stream, timeout=timeout, allow_redirects=True)
                    self.requests_made += 1
                except requests.RequestException as e:
                    r = None
                    err: Exception | None = e
                else:
                    err = None
            if r is not None and r.status_code not in (429, 500, 502, 503, 504):
                return r
            attempt += 1
            retry_after = None
            if r is not None:
                retry_after = _retry_after(r.headers.get("Retry-After"))
                r.close()
            if attempt > MAX_RETRIES:
                status = r.status_code if r is not None else None
                raise HttpFailure(status, f"{method} {url} failed after {MAX_RETRIES} retries ({status or err})", retry_after)
            delay = retry_after if retry_after is not None else min(120, (2**attempt) + random.random())
            if retry_after is not None and retry_after > 600:
                raise HttpFailure(r.status_code if r is not None else None, f"Server asked to wait {retry_after:.0f}s", retry_after)
            time.sleep(delay)

    def get_text(self, url: str, timeout: float = 60) -> tuple[str, str]:
        r = self.request("GET", url, timeout=timeout)
        if r.status_code >= 400:
            raise HttpFailure(r.status_code, f"GET {url} → {r.status_code}")
        r.encoding = r.encoding or r.apparent_encoding
        return r.text, r.url

    def get_json(self, url: str, timeout: float = 60):
        r = self.request("GET", url, headers={"Accept": "application/json"}, timeout=timeout)
        if r.status_code >= 400:
            raise HttpFailure(r.status_code, f"GET {url} → {r.status_code}")
        return r.json()

    def download(self, url: str, *, etag: str | None = None, last_modified: str | None = None, max_bytes: int = 300 * 1024 * 1024) -> Download:
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        r = self.request("GET", url, headers=headers, stream=True, timeout=120)
        common = dict(url=url, final_url=r.url, status=r.status_code, content_type=(r.headers.get("Content-Type") or "").split(";")[0].strip().lower(), etag=r.headers.get("ETag"), last_modified=r.headers.get("Last-Modified"))
        if r.status_code == 304:
            r.close()
            return Download(path=None, size=0, sha256=None, not_modified=True, **common)
        if r.status_code >= 400:
            r.close()
            raise HttpFailure(r.status_code, f"GET {url} → {r.status_code}")
        h = hashlib.sha256()
        size = 0
        truncated = False
        fd, path = tempfile.mkstemp(prefix="vtp-", dir=os.environ.get("VTP_TMP"))
        with os.fdopen(fd, "wb") as f:
            for block in r.iter_content(chunk_size=1024 * 256):
                if not block:
                    continue
                size += len(block)
                if size > max_bytes:
                    truncated = True
                    break
                h.update(block)
                f.write(block)
        r.close()
        if truncated:
            os.unlink(path)
            return Download(path=None, size=size, sha256=None, truncated=True, **common)
        return Download(path=path, size=size, sha256=h.hexdigest(), **common)


def _retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            return max(0.0, parsedate_to_datetime(value).timestamp() - time.time())
        except (TypeError, ValueError):
            return None
