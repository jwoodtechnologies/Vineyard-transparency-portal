/**
 * Large files into the R2 archive in parts (R2 multipart upload), for files over ARCHIVE_MAX_OBJECT_BYTES (25 MiB)
 * up to ARCHIVE_MAX_LARGE_OBJECT_BYTES (500 MB). A Worker request body is limited (100 MB on Workers Paid), so the
 * GitHub ingest sends a large file as parts of 20 MiB. Same authentication as every /api/admin route (GitHub OIDC,
 * checked in handleAdmin before this runs). The archive policy and the storage stop are checked when the upload is
 * created and again before it completes.
 *
 * POST /api/admin/archive/multipart/<sha256>/create    {"size": 83886080, "ext": "pdf", "contentType": "application/pdf"}
 *        -> {"status": "created", "key", "uploadId", "partBytes"}, or the outcome when nothing is to be uploaded
 *           ("exists", "quota_deferred", "link_only", "remote_only_large_file").
 * PUT  /api/admin/archive/multipart/<sha256>/part?uploadId=...&partNumber=1&ext=pdf   (body: the part's bytes)
 *        -> {"partNumber", "etag"}
 * POST /api/admin/archive/multipart/<sha256>/complete  {"uploadId", "ext", "size", "parts": [{"partNumber", "etag"}]}
 *        -> {"status": "archived", "key", "size"}. The stored object's size and SHA-256 are checked against the
 *           declared ones; a mismatched object (only the one this upload just made) is removed and 422 returned.
 * POST /api/admin/archive/multipart/<sha256>/abort     {"uploadId", "ext"}
 */
import type { Env } from '../env';
import { HttpError, badRequest, json, readJson } from '../lib/http';
import { archiveLimits, MAX_PART_BYTES, MAX_PARTS, MULTIPART_PART_BYTES } from '../lib/archivePolicy';
import { archiveKey } from '../storage/StorageProvider';
import { archiveGate, recordStored, type Budget } from './routes';

type Json = Record<string, unknown>;

const SHA = /^[0-9a-f]{64}$/;
const EXT = /^[a-z0-9]{1,8}$/;
const UPLOAD_ID = /^[A-Za-z0-9._~+/=-]{1,1024}$/;

function extOf(v: unknown): string {
  const e = String(v ?? 'bin').toLowerCase();
  if (!EXT.test(e)) throw badRequest('Invalid file extension.');
  return e;
}

function uploadIdOf(v: unknown): string {
  const id = typeof v === 'string' ? v : '';
  if (!UPLOAD_ID.test(id)) throw badRequest('Invalid uploadId.');
  return id;
}

function wholeNumber(v: unknown, min: number, max: number, what: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw badRequest(`Invalid ${what}.`);
  return n;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of a stream without holding it in memory (DigestStream in Workers; buffered where it does not exist, as in tests). */
export async function sha256OfStream(body: ReadableStream): Promise<string> {
  const Digest = (crypto as unknown as { DigestStream?: new (algorithm: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } }).DigestStream;
  if (Digest) {
    const ds = new Digest('SHA-256');
    await body.pipeTo(ds);
    return hex(await ds.digest);
  }
  return hex(await crypto.subtle.digest('SHA-256', await new Response(body).arrayBuffer()));
}

function bucket(env: Env): R2Bucket {
  if (!env.ARCHIVE) throw new HttpError(409, 'bad_request', 'No archive bucket is bound.');
  return env.ARCHIVE;
}

export async function handleMultipart(env: Env, request: Request, url: URL, rest: string, budget: Budget): Promise<Response> {
  const m = /^([0-9a-f]{64})\/(create|part|complete|abort)$/.exec(rest);
  if (!m || !SHA.test(m[1])) throw badRequest('Use /archive/multipart/<sha256>/(create|part|complete|abort).');
  const [, sha, action] = m;
  const method = request.method;
  if (action === 'part') {
    if (method !== 'PUT') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    return putPart(env, request, url, sha);
  }
  if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
  if (action === 'create') return create(env, await readJson<Json>(request, 4096), sha, budget);
  if (action === 'complete') return complete(env, await readJson<Json>(request, 1024 * 1024), sha, budget);
  return abort(env, await readJson<Json>(request, 4096), sha);
}

async function create(env: Env, body: Json, sha: string, budget: Budget): Promise<Response> {
  const limits = archiveLimits(env);
  const size = wholeNumber(body.size, 1, Number.MAX_SAFE_INTEGER, 'size');
  const ext = extOf(body.ext);
  const contentType = (typeof body.contentType === 'string' && body.contentType ? body.contentType : 'application/octet-stream').split(';')[0].trim().slice(0, 100);
  const r2 = bucket(env);
  await budget.check(5);
  const gate = await archiveGate(env, sha, size, ext, budget);
  if ('done' in gate) {
    const code = gate.done.status === 'remote_only_large_file' ? 413 : gate.done.status === 'quota_deferred' ? 409 : 200;
    return json(gate.done, { status: code });
  }
  if (Math.ceil(size / MULTIPART_PART_BYTES) > MAX_PARTS) throw badRequest('Too many parts.');
  const upload = await r2.createMultipartUpload(gate.key, { httpMetadata: { contentType }, customMetadata: { sha256: sha } });
  console.log(JSON.stringify({ event: 'archive_multipart_created', sha, size, key: gate.key }));
  return json({ status: 'created', key: gate.key, uploadId: upload.uploadId, partBytes: MULTIPART_PART_BYTES, maxPartBytes: MAX_PART_BYTES, maxObjectBytes: limits.maxLargeObject }, { status: 201 });
}

async function putPart(env: Env, request: Request, url: URL, sha: string): Promise<Response> {
  const uploadId = uploadIdOf(url.searchParams.get('uploadId'));
  const partNumber = wholeNumber(url.searchParams.get('partNumber'), 1, MAX_PARTS, 'partNumber');
  const key = archiveKey(sha, extOf(url.searchParams.get('ext')));
  const length = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isSafeInteger(length) || length <= 0) throw badRequest('Content-Length is required.');
  if (length > MAX_PART_BYTES) throw new HttpError(413, 'bad_request', `A part may be at most ${MAX_PART_BYTES} bytes.`);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== length) throw badRequest('The body does not match Content-Length.');
  const r2 = bucket(env);
  let part: R2UploadedPart;
  try {
    part = await r2.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, bytes);
  } catch (e) {
    throw badRequest(`Could not store the part: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
  }
  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function complete(env: Env, body: Json, sha: string, budget: Budget): Promise<Response> {
  const uploadId = uploadIdOf(body.uploadId);
  const ext = extOf(body.ext);
  const size = wholeNumber(body.size, 1, Number.MAX_SAFE_INTEGER, 'size');
  const list = Array.isArray(body.parts) ? (body.parts as Json[]) : [];
  if (!list.length || list.length > MAX_PARTS) throw badRequest(`Provide 1-${MAX_PARTS} parts.`);
  const seen = new Set<number>();
  const parts: R2UploadedPart[] = list.map((p) => {
    const partNumber = wholeNumber(p?.partNumber, 1, MAX_PARTS, 'partNumber');
    if (seen.has(partNumber)) throw badRequest('Each part number may appear once.');
    seen.add(partNumber);
    const etag = typeof p?.etag === 'string' ? p.etag : '';
    if (!etag || etag.length > 200) throw badRequest('Invalid part etag.');
    return { partNumber, etag };
  });
  parts.sort((a, b) => a.partNumber - b.partNumber);
  const r2 = bucket(env);
  const key = archiveKey(sha, ext);
  const upload = r2.resumeMultipartUpload(key, uploadId);
  await budget.check(5);
  // Checked again: another run may have stored the same file, or filled the archive, since the upload was created.
  const gate = await archiveGate(env, sha, size, ext, budget);
  if ('done' in gate) {
    await upload.abort().catch(() => undefined);
    const code = gate.done.status === 'remote_only_large_file' ? 413 : gate.done.status === 'quota_deferred' ? 409 : 200;
    return json(gate.done, { status: code });
  }
  let obj: R2Object;
  try {
    obj = await upload.complete(parts);
  } catch (e) {
    throw badRequest(`Could not complete the upload: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
  }
  // The object must be exactly the declared file: same size and the same SHA-256 (its key is that hash).
  let actual = obj.size === size ? null : `size ${obj.size}`;
  if (!actual) {
    const stored = await r2.get(key);
    const digest = stored ? await sha256OfStream(stored.body) : '';
    if (digest !== sha) actual = `sha256 ${digest.slice(0, 16)}`;
  }
  if (actual) {
    // Only the object this upload just made, never a copy that was already stored (archiveGate returned "exists" for that).
    await r2.delete(key);
    console.warn(JSON.stringify({ event: 'archive_multipart_mismatch', sha, size, actual }));
    return json({ status: 'mismatch', message: `The uploaded file does not match (${actual}).` }, { status: 422 });
  }
  const out = await recordStored(env, sha, key, obj.size, budget, parts.length + 2);
  console.log(JSON.stringify({ event: 'archive_multipart_stored', sha, size: obj.size, parts: parts.length }));
  return json(out, { status: 201 });
}

async function abort(env: Env, body: Json, sha: string): Promise<Response> {
  const uploadId = uploadIdOf(body.uploadId);
  const key = archiveKey(sha, extOf(body.ext));
  await bucket(env)
    .resumeMultipartUpload(key, uploadId)
    .abort()
    .catch(() => undefined);
  return json({ status: 'aborted' });
}
