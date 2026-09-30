"""Weekly catalog backup into the portal's R2 bucket (backups/YYYY-MM-DD/<table>.ndjson.gz).

Pages every catalog table through the Worker's admin export endpoint, writes one gzipped NDJSON
file per table and uploads it to R2, then prunes backups older than 90 days (the newest backup is
always kept). Run with `python -m ingest backup`. Restoring: each line is one row, column names as
in migrations/catalog/0001_catalog.sql (plus __rowid).
"""
from __future__ import annotations

import gzip
import json
import os
import tempfile
from datetime import date

from .api import PortalApi


def log(msg: str) -> None:
    print(msg, flush=True)


def run(api: PortalApi, keep_days: int = 90) -> dict:
    day = date.today().isoformat()
    tables = api.get("/export/tables")["tables"]
    summary: dict[str, int] = {}
    for table in tables:
        fd, path = tempfile.mkstemp(suffix=".ndjson.gz")
        os.close(fd)
        rows = 0
        try:
            with gzip.open(path, "wt", encoding="utf-8") as out:
                after = 0
                while True:
                    page = api.get("/export", table=table, after=after, limit=1000)
                    for r in page["rows"]:
                        out.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
                    rows += len(page["rows"])
                    after = page["last"]
                    if page.get("done") or not page["rows"]:
                        break
            size = os.path.getsize(path)
            with open(path, "rb") as f:
                api.call("PUT", f"/backup/{day}/{table}.ndjson.gz", data=f, headers={"Content-Type": "application/gzip", "Content-Length": str(size)})
            summary[table] = rows
            log(f"  backed up {table}: {rows} rows ({size / 1024:.0f} KB)")
        finally:
            os.unlink(path)
    pruned = api.post("/backup/prune", {"keepDays": keep_days})
    log(f"Backup {day}: {sum(summary.values())} rows in {len(summary)} tables; kept {pruned.get('kept')}; removed {pruned.get('deleted')} old files")
    return {"day": day, "tables": summary, "pruned": pruned}
