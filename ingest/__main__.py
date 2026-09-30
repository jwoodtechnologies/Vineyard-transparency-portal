"""CLI: python -m ingest <command>

  sources:discover   Inventory the live transparency portal → data/sources.manifest.json (+ sync sources)
  crawl              Discover document URLs from every enabled source into the crawl queue
  ingest             Download, hash, dedupe, archive, extract and index queued documents
  ingest:resume      Same as ingest (the queue is the resume point)
  retry-errors       Put failed queue items back to pending
  index              Merge FTS5 segments (run after large batches)
  verify             Consistency checks + live test searches against real indexed text
  stats              Archive statistics, quota usage and queue state
  migrate            Apply the D1 schema through the Worker (idempotent)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter

from .api import BUDGET_MESSAGE, BudgetReached, PortalApi
from .discover import discover
from .http import PoliteClient
from .pipeline import crawl, ingest, log, new_run_id, sync_sources


def cmd_verify(api: PortalApi) -> int:
    v = api.get("/verify")
    print(json.dumps(v, indent=2))
    docs = api.public("/documents", pageSize=50, sort="date_desc").get("items", [])
    tested = 0
    failures = 0
    for d in docs:
        if tested >= 5:
            break
        pages = api.public(f"/documents/{d['id']}/text")
        if not pages:
            continue
        words = Counter(w.lower() for p in pages for w in re.findall(r"[A-Za-z]{7,}", p["text"]))
        # A distinctive word: appears in this document but is not boilerplate.
        term = next((w for w, _ in sorted(words.items(), key=lambda kv: (kv[1], kv[0])) if w not in {"vineyard", "council", "meeting", "minutes", "approved"}), None)
        if not term:
            continue
        tested += 1
        res = api.public("/search", q=term, pageSize=20)
        hit = next((r for r in res["items"] if r["document"]["id"] == d["id"]), None)
        page = hit["excerpts"][0]["page"] if hit and hit["excerpts"] else None
        top = res["items"][0]["document"]["title"] if res["items"] else None
        ok = hit is not None
        failures += 0 if ok else 1
        print(f"search {term!r}: {'FOUND' if ok else 'MISSING'} → {d['title']!r} (source {d['sourceId']}, page {page}); {res['total']} result(s), top: {top!r}")
    print(f"test searches: {tested - failures}/{tested} passed")
    return 0 if failures == 0 and v.get("chunkCountsConsistent", True) else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m ingest", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command")
    p.add_argument("--limit", type=int, default=25, help="max documents to process (ingest)")
    p.add_argument("--source", action="append", help="restrict crawl to a source id (repeatable)")
    p.add_argument("--no-archive", action="store_true", help="do not upload originals to R2")
    p.add_argument("--ocr", action="store_true", help="OCR image-only PDF pages with Tesseract")
    p.add_argument("--manifest", default="data/sources.manifest.json")
    p.add_argument("--since", help="CivicClerk: only events on/after YYYY-MM-DD")
    p.add_argument("--hours", type=float, default=5.0, help="wall-clock budget for ingest")
    p.add_argument("--include-errors", action="store_true", help="also retry error items whose backoff elapsed")
    a = p.parse_args(argv)

    api = PortalApi()
    client = PoliteClient()
    run_id = new_run_id()
    cmd = a.command
    try:
        if cmd == "migrate":
            print(json.dumps(api.post("/migrate", {}), indent=2))
        elif cmd == "sources:discover":
            m = discover(client, follow_depth=1)
            os.makedirs(os.path.dirname(a.manifest) or ".", exist_ok=True)
            json.dump(m, open(a.manifest, "w"), indent=2)
            sync_sources(api)
            print(f"{m['linkCount']} links; categories {m['countsByCategory']}; sources {m['sourceIds']} → {a.manifest}")
        elif cmd in ("crawl", "ingest", "ingest:resume", "run"):
            api.post("/runs", {"id": run_id, "trigger": os.environ.get("VTP_TRIGGER", "manual"), "sources": a.source or []})
            status, message = "completed", None
            total = {}
            try:
                if cmd in ("crawl", "run"):
                    c = crawl(api, client, run_id, set(a.source) if a.source else None, a.manifest, a.since)
                    total.update(c.api())
                if cmd in ("ingest", "ingest:resume", "run"):
                    c = ingest(api, client, run_id, a.limit, archive=not a.no_archive, ocr=a.ocr, time_budget_s=int(a.hours * 3600), statuses=("pending", "error") if a.include_errors else ("pending",))
                    for k, v in c.api().items():
                        total[k] = total.get(k, 0) + v
                    log(f"Ingest: {c.by_status} archived={c.archived} deferred={c.quota_deferred} chunks={c.chunks} errors={c.errors}")
            except BudgetReached:
                status, message = "budget_reached", BUDGET_MESSAGE
                log(BUDGET_MESSAGE)
            except KeyboardInterrupt:
                status, message = "interrupted", "Stopped manually; resume with ingest:resume."
            try:
                api.post(f"/runs/{run_id}", {"status": status, "counts": total, "message": message})
            except BudgetReached:
                pass
            log(f"Run {run_id}: {status} {total} (source requests {client.requests_made}, API requests {api.requests})")
        elif cmd == "gis":
            from . import gis

            print(json.dumps(gis.run(api, client)))
        elif cmd == "retry-errors":
            print(json.dumps(api.post("/queue/retry-errors", {})))
        elif cmd == "index":
            print(json.dumps(api.post("/optimize", {})))
        elif cmd == "verify":
            return cmd_verify(api)
        elif cmd == "stats":
            print(json.dumps({"stats": api.public("/stats"), "quota": api.get("/quota"), "queue": api.get("/queue", status="pending", limit=1)["counts"]}, indent=2))
        else:
            p.print_help()
            return 2
    except BudgetReached:
        print(BUDGET_MESSAGE)
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
