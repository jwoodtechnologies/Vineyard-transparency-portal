"""Vineyard Transparency Portal ingestion pipeline (crawl, extract, index, archive).

Runs locally or in GitHub Actions. Heavy work (downloads, PDF extraction) happens here, never in
the Cloudflare Worker. Results are published through the Worker's authenticated /api/admin API,
which enforces the D1 daily write budget and the R2 storage hard stop server-side.
"""
__version__ = "1.0.0"
