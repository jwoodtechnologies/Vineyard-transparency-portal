"""Client for the Worker's /api/admin ingestion endpoints (auth: GitHub OIDC or INGEST_TOKEN)."""
from __future__ import annotations

import os
import time

import requests

BUDGET_MESSAGE = "Daily free-tier ingestion budget reached. Resume next UTC quota period."


class BudgetReached(Exception):
    pass


class ApiError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"API {status}: {body[:300]}")
        self.status = status
        self.body = body


class PortalApi:
    def __init__(self, base: str | None = None, audience: str | None = None):
        self.base = self._pick_base(base or os.environ.get("VTP_API_BASE") or "https://vineyardportal.org")
        self.audience = audience or os.environ.get("VTP_OIDC_AUDIENCE", "vineyardportal.org")
        self.static_token = os.environ.get("VTP_INGEST_TOKEN")
        self._token: str | None = None
        self._token_at = 0.0
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "VineyardTransparencyPortal-Ingest/1.0"
        self.requests = 0

    @staticmethod
    def _pick_base(value: str) -> str:
        """VTP_API_BASE may list several origins (custom domain first, workers.dev second)."""
        candidates = [v.strip().rstrip("/") for v in value.split(",") if v.strip()]
        if len(candidates) == 1:
            return candidates[0]
        for c in candidates:
            try:
                r = requests.get(f"{c}/api/health", timeout=15)
                if r.ok and r.headers.get("content-type", "").startswith("application/json"):
                    return c
            except requests.RequestException:
                continue
        return candidates[0]

    def _auth(self) -> str:
        if self.static_token:
            return self.static_token
        if self._token and time.time() - self._token_at < 240:
            return self._token
        req_url = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
        req_token = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
        if not req_url or not req_token:
            raise RuntimeError("No credentials: run inside GitHub Actions with `permissions: id-token: write`, or set VTP_INGEST_TOKEN.")
        r = requests.get(f"{req_url}&audience={self.audience}", headers={"Authorization": f"Bearer {req_token}"}, timeout=30)
        r.raise_for_status()
        self._token = r.json()["value"]
        self._token_at = time.time()
        return self._token

    def call(self, method: str, path: str, *, json_body=None, data=None, headers: dict | None = None, params: dict | None = None, ok=(200, 201)):
        h = {"Authorization": f"Bearer {self._auth()}", **(headers or {})}
        for attempt in range(5):
            try:
                r = self.session.request(method, f"{self.base}/api/admin{path}", json=json_body, data=data, headers=h, params=params, timeout=120)
            except requests.RequestException:
                if attempt == 4:
                    raise
                time.sleep(2**attempt)
                if hasattr(data, "seek"):
                    data.seek(0)
                continue
            self.requests += 1
            if r.status_code == 429 and "quota_exhausted" in r.text:
                raise BudgetReached(BUDGET_MESSAGE)
            # 500s from D1 under load are usually momentary: retry them like gateway errors.
            if r.status_code in (500, 502, 503, 504) and attempt < 4:
                time.sleep(2**attempt)
                if hasattr(data, "seek"):
                    data.seek(0)
                continue
            if r.status_code in ok or (isinstance(ok, tuple) and r.status_code in ok):
                return r.json() if r.content else {}
            if r.status_code in (409, 413):
                return r.json()
            raise ApiError(r.status_code, r.text)
        raise ApiError(0, "unreachable")

    def get(self, path, **params):
        return self.call("GET", path, params=params)

    def post(self, path, body):
        return self.call("POST", path, json_body=body)

    def put_archive(self, sha256: str, path: str, size: int, content_type: str, ext: str):
        with open(path, "rb") as f:
            return self.call("PUT", f"/archive/{sha256}", data=f, headers={"Content-Type": content_type or "application/octet-stream", "Content-Length": str(size)}, params={"ext": ext})

    def public(self, path: str, **params):
        r = self.session.get(f"{self.base}/api{path}", params=params, timeout=60)
        r.raise_for_status()
        return r.json()
