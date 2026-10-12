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
  /** The deployed Worker version (wrangler.jsonc version_metadata): its id keys every cached API copy to the build. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;

  /** Comma-separated shard numbers that are searched, e.g. "0" or "0,1". */
  SEARCH_SHARDS?: string;
  /** Comma-separated shard numbers that receive newly indexed documents. */
  SEARCH_WRITE_SHARDS?: string;
  /** Pause indexing when a search shard database passes this size (bytes). */
  SEARCH_SHARD_MAX_BYTES?: string;
  AI_ENABLED?: string;
  AI_MODEL?: string;
  /** The cheaper model tried last, with fewer sources, before Ask falls back to record cards. */
  AI_LITE_MODEL?: string;
  AI_MAX_REQUESTS_PER_DAY?: string;
  /** Answers per day from the larger model before the small one takes over. */
  AI_BIG_PER_DAY?: string;
  /** Daily caps on estimated Workers AI Neurons by spender (worker/ai/meter.ts; together never above the 10,000 included). */
  AI_NEURONS_PUBLIC_PER_DAY?: string;
  AI_NEURONS_TESTS_PER_DAY?: string;
  /** Set per request by spenderEnv (worker/ai/meter.ts), never in config: 'public' or 'tests'. */
  AI_SPENDER?: string;
  ARCHIVE_STORAGE_HARD_STOP_BYTES?: string;
  /** The stop can never pass this (worker/lib/archivePolicy.ts), so storage cost has a fixed worst case. */
  ARCHIVE_STORAGE_CEILING_BYTES?: string;
  /** The largest file stored at all; files over ARCHIVE_MAX_OBJECT_BYTES go up in parts. */
  ARCHIVE_MAX_LARGE_OBJECT_BYTES?: string;
  /** Kept free below the hard stop for priority records (minutes, agendas, ordinances...) when other files are stored. */
  ARCHIVE_PRIORITY_RESERVE_BYTES?: string;
  /** What the account's other R2 buckets hold, in bytes (for the storage cost estimate only; never a limit). */
  R2_OTHER_BUCKETS_BYTES?: string;
  ARCHIVE_MAX_OBJECT_BYTES?: string;
  MAX_D1_INGEST_ROWS_PER_DAY?: string;
  /** GitHub Actions OIDC trust for the ingestion endpoints. */
  OIDC_AUDIENCE?: string;
  OIDC_REPOSITORY?: string;
  OIDC_ALLOWED_REFS?: string;
  /** Optional static bearer token (Worker secret) for running ingestion from a local machine. */
  INGEST_TOKEN?: string;
  /** Optional Worker secret: lets the five-minute tick start the GitHub CivicClerk check (worker/sync/dispatch.ts). */
  GITHUB_DISPATCH_TOKEN?: string;
}

export function intVar(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function boolVar(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
