/** Bindings and configuration for the Vineyard Transparency Portal Worker (see wrangler.jsonc). */
export interface Env {
  ASSETS: Fetcher;
  /** Catalog database (vtp-catalog): metadata, provenance, crawl state. */
  CATALOG_DB: D1Database;
  /** Full-text search shards. Only the ones listed in SEARCH_SHARDS are used. */
  SEARCH_DB_0?: D1Database;
  SEARCH_DB_1?: D1Database;
  SEARCH_DB_2?: D1Database;
  SEARCH_DB_3?: D1Database;
  SEARCH_DB_4?: D1Database;
  SEARCH_DB_5?: D1Database;
  SEARCH_DB_6?: D1Database;
  SEARCH_DB_7?: D1Database;
  /** R2 bucket for archived originals (optional: the site works without it). */
  ARCHIVE?: R2Bucket;
  /** Workers AI binding (optional: Ask falls back to search without it). */
  AI?: Ai;

  /** Comma-separated shard numbers that are searched, e.g. "0" or "0,1". */
  SEARCH_SHARDS?: string;
  /** Comma-separated shard numbers that receive newly indexed documents. */
  SEARCH_WRITE_SHARDS?: string;
  /** Pause indexing when a search shard database passes this size (bytes). */
  SEARCH_SHARD_MAX_BYTES?: string;
  AI_ENABLED?: string;
  AI_MODEL?: string;
  AI_MAX_REQUESTS_PER_DAY?: string;
  ARCHIVE_STORAGE_HARD_STOP_BYTES?: string;
  ARCHIVE_MAX_OBJECT_BYTES?: string;
  MAX_D1_INGEST_ROWS_PER_DAY?: string;
  /** GitHub Actions OIDC trust for the ingestion endpoints. */
  OIDC_AUDIENCE?: string;
  OIDC_REPOSITORY?: string;
  OIDC_ALLOWED_REFS?: string;
  /** Optional static bearer token (Worker secret) for running ingestion from a local machine. */
  INGEST_TOKEN?: string;
}

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function boolVar(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
