/**
 * Storage abstraction for archived files. The ingest pipeline only talks to this interface, so the
 * archive can move from the local filesystem to S3-compatible object storage (Cloudflare R2,
 * Backblaze B2, MinIO, AWS S3) without touching pipeline code.
 *
 * Keys are content-addressed (documents/<aa>/<sha256>/<sanitized-file-name>), which makes writes
 * idempotent and guarantees a new version can never overwrite an older one.
 */
export interface StoredObject {
  key: string;
  size: number;
  /** Human-readable location (file path or bucket URL) for logs/reports. */
  location: string;
}

export interface StorageProvider {
  readonly id: string;
  /** Store bytes under `key`. If the key exists with the same size, this is a no-op. */
  put(key: string, data: Uint8Array, meta: { contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
  stat(key: string): Promise<{ size: number } | null>;
  /** All keys under a prefix (used by validate-archive to find orphans). */
  list(prefix: string): Promise<string[]>;
  describe(key: string): string;
}
