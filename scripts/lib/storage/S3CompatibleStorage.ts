/**
 * S3-compatible StorageProvider — INTENTIONALLY A STUB.
 *
 * The archive will outgrow a single disk (20k+ documents). This class documents the contract for
 * moving to object storage (Cloudflare R2, Backblaze B2, MinIO, AWS S3) without adding an SDK
 * dependency today. To implement:
 *
 *  1. Credentials come from the environment only (S3_ENDPOINT, S3_BUCKET, S3_REGION,
 *     S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY). Never commit them; never expose them to the frontend.
 *  2. Either add `@aws-sdk/client-s3` (works with R2/B2/MinIO via `endpoint` + `forcePathStyle`),
 *     or sign requests yourself with AWS Signature Version 4 using node:crypto HMAC-SHA256 and
 *     plain `fetch` (PUT/GET/HEAD object, ListObjectsV2 for `list`).
 *  3. put(): send `x-amz-checksum-sha256` (base64 of the SHA-256) so the store verifies integrity;
 *     use `If-None-Match: *` so an existing key is never overwritten (keys are content-addressed).
 *  4. stat(): HEAD object → Content-Length. get(): GET object with a size cap.
 *  5. Keep keys identical to LocalFilesystemStorage so the two can be synced with `rclone`.
 *  6. Serve files to the public through the API (GET /api/documents/:id/file) or a read-only
 *     public bucket/custom domain with `Content-Disposition: inline` and `X-Content-Type-Options: nosniff`.
 */
import { assertSafeKey } from './keys';
import type { StoredObject, StorageProvider } from './StorageProvider';

export interface S3CompatibleStorageOptions {
  endpoint: string;
  bucket: string;
  region: string;
}

const NOT_IMPLEMENTED = 'S3CompatibleStorage is a documented stub. See scripts/lib/storage/S3CompatibleStorage.ts and docs/INDEXING_ARCHITECTURE.md.';

export class S3CompatibleStorage implements StorageProvider {
  readonly id = 's3-compatible';
  private readonly options: S3CompatibleStorageOptions;

  constructor(options: S3CompatibleStorageOptions) {
    this.options = options;
  }

  describe(key: string): string {
    assertSafeKey(key);
    return `${this.options.endpoint.replace(/\/+$/, '')}/${this.options.bucket}/${key}`;
  }

  async put(key: string, data: Uint8Array, meta: { contentType: string }): Promise<StoredObject> {
    assertSafeKey(key);
    void data;
    void meta;
    throw new Error(NOT_IMPLEMENTED);
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    throw new Error(NOT_IMPLEMENTED);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    assertSafeKey(key);
    throw new Error(NOT_IMPLEMENTED);
  }

  async list(prefix: string): Promise<string[]> {
    void prefix;
    throw new Error(NOT_IMPLEMENTED);
  }
}
