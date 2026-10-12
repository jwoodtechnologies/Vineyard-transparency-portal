/**
 * StorageProvider: archived original documents.
 *
 * Keys are content-addressed: documents/<first two hex chars>/<sha256>.<ext>. One object can back
 * many catalog sources (the same agenda posted on several government sites), which is how
 * duplicate binaries are avoided.
 */
export interface StoredObjectInfo {
  key: string;
  size: number;
  etag: string;
  contentType: string | null;
}

export interface RangeRequest {
  offset: number;
  length?: number;
  suffix?: number;
}

export interface StoredObject extends StoredObjectInfo {
  body: ReadableStream;
  range?: { offset: number; length: number };
}

export interface StorageProvider {
  readonly name: string;
  readonly available: boolean;
  head(key: string): Promise<StoredObjectInfo | null>;
  get(key: string, range?: RangeRequest): Promise<StoredObject | null>;
  put(key: string, body: ReadableStream | ArrayBuffer, size: number, contentType: string, sha256: string): Promise<StoredObjectInfo>;
}

const SHA256 = /^[0-9a-f]{64}$/;
const EXT = /^[a-z0-9]{1,8}$/;

export function archiveKey(sha256: string, ext: string): string {
  if (!SHA256.test(sha256)) throw new Error('Invalid sha256.');
  const safeExt = EXT.test(ext) ? ext : 'bin';
  return `documents/${sha256.slice(0, 2)}/${sha256}.${safeExt}`;
}

export function isArchiveKey(key: string): boolean {
  return /^documents\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(key) || isResidentKey(key);
}

/** Files residents send on the public "Submit a public record" page (pending or approved): a separate prefix with its own storage budget. */
export function isResidentKey(key: string): boolean {
  return /^resident\/sub_[0-9a-f]{16}\.(pdf|png|jpg)$/.test(key);
}

export class R2StorageProvider implements StorageProvider {
  readonly name = 'r2';
  readonly available = true;
  constructor(private readonly bucket: R2Bucket) {}

  async head(key: string): Promise<StoredObjectInfo | null> {
    const o = await this.bucket.head(key);
    return o ? { key, size: o.size, etag: o.etag, contentType: o.httpMetadata?.contentType ?? null } : null;
  }

  async get(key: string, range?: RangeRequest): Promise<StoredObject | null> {
    const r2Range = range ? (range.suffix != null ? { suffix: range.suffix } : { offset: range.offset, ...(range.length != null ? { length: range.length } : {}) }) : undefined;
    const o = await this.bucket.get(key, r2Range ? { range: r2Range } : undefined);
    if (!o) return null;
    let resolved: { offset: number; length: number } | undefined;
    if (range && o.range) {
      const rr = o.range as { offset?: number; length?: number; suffix?: number };
      if (rr.suffix != null) resolved = { offset: o.size - rr.suffix, length: rr.suffix };
      else resolved = { offset: rr.offset ?? 0, length: rr.length ?? o.size - (rr.offset ?? 0) };
    }
    return { key, size: o.size, etag: o.etag, contentType: o.httpMetadata?.contentType ?? null, body: o.body, ...(resolved ? { range: resolved } : {}) };
  }

  async put(key: string, body: ReadableStream | ArrayBuffer, size: number, contentType: string, sha256: string): Promise<StoredObjectInfo> {
    // A stream goes through a FixedLengthStream so R2 knows its length (it is never read into memory). Outside
    // Workers (tests) the stream is passed as it is.
    const fixed = !(body instanceof ArrayBuffer) && typeof FixedLengthStream === 'function' ? new FixedLengthStream(size) : null;
    if (fixed) void (body as ReadableStream).pipeTo(fixed.writable);
    const stream = fixed ? fixed.readable : body;
    const o = await this.bucket.put(key, stream, { httpMetadata: { contentType }, sha256, customMetadata: { sha256 } });
    return { key, size: o.size, etag: o.etag, contentType };
  }
}

/** Used when no bucket is bound: the portal links to original government URLs instead. */
export class UnavailableStorageProvider implements StorageProvider {
  readonly name = 'none';
  readonly available = false;
  async head(): Promise<null> {
    return null;
  }
  async get(): Promise<null> {
    return null;
  }
  async put(): Promise<StoredObjectInfo> {
    throw new Error('Archive storage is not configured.');
  }
}

export function storageFor(bucket: R2Bucket | undefined): StorageProvider {
  return bucket ? new R2StorageProvider(bucket) : new UnavailableStorageProvider();
}
