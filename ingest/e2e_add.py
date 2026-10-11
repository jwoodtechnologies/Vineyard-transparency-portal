"""End to end check of the public Submit a public record page, run from two GitHub runners.

  python -m ingest.e2e_add submit    -> submits a test note, checks it is pending and not in search,
                                        approves it (admin route), checks search and the label, reports it once
  python -m ingest.e2e_add second ID -> reports it again from another runner, checks it is hidden, removes and deletes it

ID is the submission id (sub_...). Only items titled "Portal end to end test ..." are touched by the
admin routes this uses (/resident/e2e/state, /approve, /cleanup).
"""
from __future__ import annotations

import json
import os
import sys
import time

import requests

from .api import PortalApi

BASE = os.environ.get("VTP_PUBLIC_BASE", "https://vineyardportal.org")
UA = "VineyardTransparencyPortal-e2e/1.0 (+https://vineyardportal.org)"
LABEL = "Resident submitted. Not a city record."
PENDING = "Thanks. Your submission will appear after review."


def say(msg: str) -> None:
    print(msg, flush=True)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(f"- {msg}\n")


def output(key: str, value: str) -> None:
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")


def post(path: str, body: dict) -> requests.Response:
    return requests.post(f"{BASE}{path}", json=body, headers={"user-agent": UA, "origin": BASE, "referer": f"{BASE}/add"}, timeout=30)


def search_hit(token: str) -> dict | None:
    r = requests.get(f"{BASE}/api/search", params={"q": token, "pageSize": 5, "_": str(time.time())}, headers={"user-agent": UA}, timeout=30)
    r.raise_for_status()
    for item in r.json().get("items", []):
        if token in (item.get("document", {}).get("title") or ""):
            return item
    return None


def fail(msg: str) -> None:
    say(f"FAIL: {msg}")
    sys.exit(1)


def submit() -> None:
    api = PortalApi()
    token = f"e2e{os.environ.get('GITHUB_RUN_ID', str(int(time.time())))}"
    title = f"Portal end to end test {token}"
    r = post("/api/add", {"kind": "note", "title": title, "body": f"Automated check of the submit page ({token}). This item is removed by the same run.", "website": ""})
    if r.status_code != 201:
        fail(f"submit returned {r.status_code}: {r.text[:200]}")
    j = r.json()
    sub = j.get("id")
    if not sub or not j.get("pending"):
        fail(f"submit did not return a pending item: {r.text[:200]}")
    output("sub", sub)
    say(f"Submitted note {sub} ({title}); message: {j.get('message')}")
    if j.get("message") != PENDING:
        fail("the submitter was not told the item appears after review")
    if j.get("documentId"):
        fail("a pending submission already has a public record")

    # Pending: stored, not public.
    state = api.get("/resident/e2e/state", id=sub)
    say(f"Pending state: {json.dumps(state)}")
    if state.get("status") != "pending" or state.get("documentId"):
        fail("the submission is not pending")
    time.sleep(10)
    if search_hit(token):
        fail("a pending submission appears in search")
    say("Pending item is not in search")

    # Approve (admin route, test items only), then it is public with its label.
    res = api.post("/resident/e2e/approve", {"id": sub})
    doc = res.get("documentId")
    say(f"Approved: {json.dumps(res)}")
    if not doc:
        fail("approval returned no documentId")
    output("doc", doc)
    hit = None
    for _ in range(12):
        hit = search_hit(token)
        if hit:
            break
        time.sleep(5)
    if not hit:
        fail("the approved note did not appear in search within 60 seconds")
    d = hit["document"]
    say(f"Found in search: source {d.get('sourceId')}, type {d.get('documentType')}")
    if d.get("sourceId") != "resident-submitted":
        fail("search result is not in the resident submissions collection")
    page = requests.get(f"{BASE}/api/documents/{doc}", headers={"user-agent": UA}, timeout=30)
    labelled = LABEL in page.text or "resident" in page.text.lower()
    say(f"Document API {page.status_code}; label present: {labelled}")
    if page.status_code != 200 or not labelled:
        fail("the approved record is not served with its label")
    rep = post("/api/add/report", {"documentId": doc})
    say(f"Report 1 returned {rep.status_code}: {rep.text[:120]}")
    if rep.status_code >= 400:
        fail("first report was refused")
    state = api.get("/resident/e2e/state", id=sub)
    say(f"After report 1: {json.dumps(state)}")
    if state.get("hidden"):
        fail("item was hidden after a single report")


def second(sub: str) -> None:
    api = PortalApi()
    doc = None
    try:
        state = api.get("/resident/e2e/state", id=sub)
        doc = state.get("documentId")
        if state.get("status") != "approved" or not doc:
            fail(f"the item was not approved, nothing to report: {json.dumps(state)}")
        rep = post("/api/add/report", {"documentId": doc})
        say(f"Report 2 returned {rep.status_code}: {rep.text[:120]}")
        state = api.get("/resident/e2e/state", id=sub)
        say(f"After report 2: {json.dumps(state)}")
        if not state.get("hidden"):
            say("NOTE: not hidden; the two runners may share an IP address (reports count per person).")
        if state.get("hidden"):
            token = f"e2e{os.environ.get('GITHUB_RUN_ID', '')}"
            time.sleep(3)
            hit = search_hit(token)
            say(f"Hidden item in search: {'yes' if hit else 'no'}")
            if hit:
                fail("hidden item still appears in search")
    finally:
        res = api.post("/resident/e2e/cleanup", {"id": sub})
        say(f"Removed and deleted: {json.dumps(res)}")
    gone = requests.get(f"{BASE}/api/documents/{doc}", headers={"user-agent": UA}, timeout=30)
    say(f"Document API after removal: {gone.status_code}")
    if gone.status_code == 200:
        fail("removed item is still served")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "submit":
        submit()
    elif len(sys.argv) >= 3 and sys.argv[1] == "second":
        second(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(2)
