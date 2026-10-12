import { beforeAll, describe, expect, it, vi } from 'vitest';
import { testEnv } from './helpers/d1';
import { archiveLimits, archiveOrder, DEFAULT_CEILING_BYTES, DEFAULT_HARD_STOP_BYTES, MAX_CEILING_BYTES } from '../worker/lib/archivePolicy';
import { Budget, handleAdmin, storeArchive } from '../worker/admin/routes';
import { getDocumentFile } from '../worker/api/documents';

const now = '2026-10-12T00:00:00Z';
const OIDC = { OIDC_AUDIENCE: 'vineyardportal.org', OIDC_REPOSITORY: 'jwoodtechnologies/Vineyard-transparency-portal', OIDC_ALLOWED_REFS: 'refs/heads/main' };
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
let keys: CryptoKeyPair;

async function token(claims: Record<string, unknown> = {}): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://token.actions.githubusercontent.com', aud: OIDC.OIDC_AUDIENCE, exp: t + 300, nbf: t - 5, repository: OIDC.OIDC_REPOSITORY, ref: 'refs/heads/main', ...claims };
  const signed = `${enc({ alg: 'RS256', kid: 'large-kid' })}.${enc(body)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(signed));
  return `${signed}.${Buffer.from(sig).toString('base64url')}`;
}

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey;
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'large-kid' }] }), { headers: { 'content-type': 'application/json' } }));
});

const hex = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest('SHA-256', b)).toString('hex');

function seed(vars: Record<string, string> = {}) {
  const env = testEnv();
  Object.assign(env, OIDC, { MAX_D1_INGEST_ROWS_PER_DAY: '1000000' }, vars);
  const db = env.CATALOG_DB.db;
  const add = (id: string, type: string, sha: string, size: number, status = 'remote_only_large_file', mime = 'application/pdf') =>
    db
      .prepare(
        `INSERT INTO documents (id, slug, title, document_type, document_date, source_id, mime_type, original_filename, file_size, sha256, canonical_key, archive_status, created_at, updated_at, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, '2026-06-23', 's', ?, 'packet.pdf', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, id, `Record ${id}`, type, mime, size, sha, `k_${id}`, status, now, now, now, now);
  return { env, db, add };
}

async function admin(env: ReturnType<typeof testEnv>, method: string, path: string, opts: { body?: BodyInit; json?: unknown; headers?: Record<string, string>; auth?: string | null } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  const auth = opts.auth === undefined ? await token() : opts.auth;
  if (auth) headers.authorization = `Bearer ${auth}`;
  let body = opts.body;
  if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(new TextEncoder().encode(body).byteLength);
  }
  const url = new URL(`https://vineyardportal.org/api/admin${path}`);
  return handleAdmin(env, new Request(url, { method, headers, body }), url);
}

const bytesOf = (n: number, seedByte = 7) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seedByte) % 251;
  return b;
};

describe('archive policy: stop and ceiling', () => {
  it('stops at 60 GB by default and never past the ceiling', () => {
    expect(DEFAULT_HARD_STOP_BYTES).toBe(60_000_000_000);
    expect(DEFAULT_CEILING_BYTES).toBe(60_000_000_000);
    const d = archiveLimits({});
    expect(d.hardStop).toBe(60_000_000_000);
    expect(d.maxObject).toBe(25 * 1024 * 1024);
    expect(d.maxLargeObject).toBe(500_000_000);
    // Raising the stop alone does nothing past the ceiling.
    expect(archiveLimits({ ARCHIVE_STORAGE_HARD_STOP_BYTES: '900000000000' }).hardStop).toBe(60_000_000_000);
    expect(archiveLimits({ ARCHIVE_STORAGE_HARD_STOP_BYTES: '20000000000', ARCHIVE_STORAGE_CEILING_BYTES: '30000000000' }).hardStop).toBe(20_000_000_000);
    // A mistyped ceiling is still capped.
    expect(archiveLimits({ ARCHIVE_STORAGE_HARD_STOP_BYTES: '600000000000', ARCHIVE_STORAGE_CEILING_BYTES: '600000000000' }).hardStop).toBe(MAX_CEILING_BYTES);
    // Garbage falls back to the defaults; the single-request size never passes the largest stored size.
    expect(archiveLimits({ ARCHIVE_STORAGE_HARD_STOP_BYTES: 'lots', ARCHIVE_STORAGE_CEILING_BYTES: '-1' }).hardStop).toBe(60_000_000_000);
    expect(archiveLimits({ ARCHIVE_MAX_OBJECT_BYTES: '900000000', ARCHIVE_MAX_LARGE_OBJECT_BYTES: '5000000000' })).toMatchObject({ maxObject: 900_000_000, maxLargeObject: 1_000_000_000 });
    expect(archiveLimits({ ARCHIVE_MAX_OBJECT_BYTES: '900000000', ARCHIVE_MAX_LARGE_OBJECT_BYTES: '500000000' })).toMatchObject({ maxObject: 500_000_000, maxLargeObject: 500_000_000 });
  });

  it('orders by priority rank, then newest first', () => {
    const rows = [
      { document_type: 'agenda_packet', title: 'Packet', document_date: '2026-01-01' },
      { document_type: 'staff_report', title: 'Report', document_date: '2020-01-01' },
      { document_type: 'minutes', title: 'Minutes', document_date: '2019-01-01' },
      { document_type: 'staff_report', title: 'Report 2', document_date: '2025-01-01' },
    ];
    expect([...rows].sort(archiveOrder).map((r) => `${r.document_type} ${r.document_date}`)).toEqual(['minutes 2019-01-01', 'staff_report 2025-01-01', 'staff_report 2020-01-01', 'agenda_packet 2026-01-01']);
  });

  it('refuses an upload past the ceiling even for a file stored always', async () => {
    const { env, db, add } = seed({ ARCHIVE_STORAGE_HARD_STOP_BYTES: '90000', ARCHIVE_STORAGE_CEILING_BYTES: '10000' });
    db.prepare('UPDATE archive_stats SET stored_bytes = 9500 WHERE id = 1').run();
    add('doc_0000000000000001', 'minutes', 'c'.repeat(64), 600, 'not_archived');
    const out = await storeArchive(env, 'c'.repeat(64), new Uint8Array(600).buffer, 600, 'pdf', 'application/pdf', new Budget(env), { always: true });
    expect(out.status).toBe('quota_deferred');
    expect(env.ARCHIVE.objects.size).toBe(0);
  });

  it('refuses a single-request upload over 25 MiB (it must go in parts) without marking the record', async () => {
    const { env, db, add } = seed();
    add('doc_0000000000000002', 'agenda_packet', 'd'.repeat(64), 30_000_000);
    const res = await admin(env, 'PUT', `/archive/${'d'.repeat(64)}?ext=pdf`, { body: new Uint8Array(10), headers: { 'content-length': '30000000', 'content-type': 'application/pdf' } });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { status: string }).status).toBe('use_multipart');
    expect((db.prepare(`SELECT archive_status FROM documents`).get() as { archive_status: string }).archive_status).toBe('remote_only_large_file');
  });
});

describe('multipart upload routes', () => {
  it('require the ingest authentication', async () => {
    const { env } = seed();
    const sha = 'e'.repeat(64);
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 10, ext: 'pdf' }, auth: null })).rejects.toMatchObject({ status: 401 });
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 10, ext: 'pdf' }, auth: await token({ repository: 'someone/else' }) })).rejects.toMatchObject({ status: 403 });
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 10, ext: 'pdf' }, auth: await token({ ref: 'refs/heads/feature' }) })).rejects.toMatchObject({ status: 403 });
    await expect(admin(env, 'PUT', `/archive/multipart/${sha}/part?uploadId=abc&partNumber=1&ext=pdf`, { body: new Uint8Array(4), headers: { 'content-length': '4' }, auth: 'not.a.token' })).rejects.toMatchObject({ status: 401 });
    expect(env.ARCHIVE.uploads.size).toBe(0);
  });

  it('validate every input', async () => {
    const { env } = seed();
    const sha = 'f'.repeat(64);
    await expect(admin(env, 'POST', `/archive/multipart/${'F'.repeat(64)}/create`, { json: { size: 10 } })).rejects.toMatchObject({ status: 400 });
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/rename`, { json: {} })).rejects.toMatchObject({ status: 400 });
    await expect(admin(env, 'GET', `/archive/multipart/${sha}/create`)).rejects.toMatchObject({ status: 405 });
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/part`, { json: {} })).rejects.toMatchObject({ status: 405 });
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 0, ext: 'pdf' } })).rejects.toMatchObject({ status: 400 });
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 1.5, ext: 'pdf' } })).rejects.toMatchObject({ status: 400 });
    await expect(admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 10, ext: '../x' } })).rejects.toMatchObject({ status: 400 });
    const part = (q: string, headers: Record<string, string>, body: BodyInit = new Uint8Array(4)) => admin(env, 'PUT', `/archive/multipart/${sha}/part?${q}`, { body, headers });
    await expect(part('uploadId=&partNumber=1&ext=pdf', { 'content-length': '4' })).rejects.toMatchObject({ status: 400 });
    await expect(part('uploadId=a%20b&partNumber=1&ext=pdf', { 'content-length': '4' })).rejects.toMatchObject({ status: 400 });
    await expect(part('uploadId=abc&partNumber=0&ext=pdf', { 'content-length': '4' })).rejects.toMatchObject({ status: 400 });
    await expect(part('uploadId=abc&partNumber=10001&ext=pdf', { 'content-length': '4' })).rejects.toMatchObject({ status: 400 });
    await expect(part('uploadId=abc&partNumber=1&ext=pdf', {})).rejects.toMatchObject({ status: 400 });
    // Parts over 50 MiB are refused before the body is read.
    await expect(part('uploadId=abc&partNumber=1&ext=pdf', { 'content-length': String(60 * 1024 * 1024) })).rejects.toMatchObject({ status: 413 });
    await expect(part('uploadId=abc&partNumber=1&ext=pdf', { 'content-length': '9' })).rejects.toMatchObject({ status: 400 });
    // An upload that does not exist.
    await expect(part('uploadId=nosuch&partNumber=1&ext=pdf', { 'content-length': '4' })).rejects.toMatchObject({ status: 400 });
    const complete = (json: unknown) => admin(env, 'POST', `/archive/multipart/${sha}/complete`, { json });
    await expect(complete({ uploadId: 'abc', ext: 'pdf', size: 8, parts: [] })).rejects.toMatchObject({ status: 400 });
    await expect(complete({ uploadId: 'abc', ext: 'pdf', size: 8, parts: [{ partNumber: 1, etag: 'a' }, { partNumber: 1, etag: 'b' }] })).rejects.toMatchObject({ status: 400 });
    await expect(complete({ uploadId: 'abc', ext: 'pdf', size: 8, parts: [{ partNumber: 1, etag: '' }] })).rejects.toMatchObject({ status: 400 });
  });

  it('store a large file in parts, check it, and mark every record with it archived', async () => {
    const { env, db, add } = seed();
    const file = bytesOf(2500);
    const sha = await hex(file);
    add('doc_0000000000000003', 'agenda_packet', sha, file.byteLength);
    add('doc_0000000000000004', 'minutes', sha, file.byteLength, 'not_archived');
    const created = await admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: file.byteLength, ext: 'pdf', contentType: 'application/pdf' } });
    expect(created.status).toBe(201);
    const c = (await created.json()) as { status: string; uploadId: string; key: string; partBytes: number };
    expect(c.status).toBe('created');
    expect(c.partBytes).toBe(20 * 1024 * 1024);
    const parts = [];
    for (let i = 0, n = 1; i < file.byteLength; i += 1000, n++) {
      const chunk = file.slice(i, i + 1000);
      const r = await admin(env, 'PUT', `/archive/multipart/${sha}/part?uploadId=${c.uploadId}&partNumber=${n}&ext=pdf`, { body: chunk, headers: { 'content-length': String(chunk.byteLength) } });
      parts.push((await r.json()) as { partNumber: number; etag: string });
    }
    // Parts may arrive in any order.
    const done = await admin(env, 'POST', `/archive/multipart/${sha}/complete`, { json: { uploadId: c.uploadId, ext: 'pdf', size: file.byteLength, parts: [...parts].reverse() } });
    expect(done.status).toBe(201);
    expect(await done.json()).toMatchObject({ status: 'archived', key: c.key, size: 2500 });
    expect(Buffer.from(env.ARCHIVE.objects.get(c.key)!.bytes).equals(Buffer.from(file))).toBe(true);
    const docs = db.prepare(`SELECT archive_status, archive_key FROM documents ORDER BY id`).all() as Array<{ archive_status: string; archive_key: string }>;
    expect(docs.every((d) => d.archive_status === 'archived' && d.archive_key === c.key)).toBe(true);
    const stats = db.prepare('SELECT stored_bytes, stored_objects FROM archive_stats WHERE id = 1').get() as { stored_bytes: number; stored_objects: number };
    expect(stats).toEqual({ stored_bytes: 2500, stored_objects: 1 });
    // Create, three parts, complete.
    const usage = db.prepare('SELECT r2_class_a_ops FROM quota_usage').get() as { r2_class_a_ops: number };
    expect(usage.r2_class_a_ops).toBe(5);
    // A second run finds it stored.
    const again = await admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: file.byteLength, ext: 'pdf' } });
    expect(await again.json()).toMatchObject({ status: 'exists' });
  });

  it('remove an upload whose bytes do not match its SHA-256', async () => {
    const { env, add } = seed();
    const file = bytesOf(1200);
    const sha = await hex(bytesOf(1200, 9));
    add('doc_0000000000000005', 'agenda_packet', sha, file.byteLength);
    const c = (await (await admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 1200, ext: 'pdf' } })).json()) as { uploadId: string; key: string };
    const p = (await (await admin(env, 'PUT', `/archive/multipart/${sha}/part?uploadId=${c.uploadId}&partNumber=1&ext=pdf`, { body: file, headers: { 'content-length': '1200' } })).json()) as { partNumber: number; etag: string };
    const done = await admin(env, 'POST', `/archive/multipart/${sha}/complete`, { json: { uploadId: c.uploadId, ext: 'pdf', size: 1200, parts: [p] } });
    expect(done.status).toBe(422);
    expect(env.ARCHIVE.objects.has(c.key)).toBe(false);
  });

  it('respect the stop when created, and abort cleanly', async () => {
    const { env, db, add } = seed({ ARCHIVE_STORAGE_HARD_STOP_BYTES: '100000', ARCHIVE_PRIORITY_RESERVE_BYTES: '10000' });
    db.prepare('UPDATE archive_stats SET stored_bytes = 85000 WHERE id = 1').run();
    const sha = 'a1'.repeat(32);
    add('doc_0000000000000006', 'agenda_packet', sha, 6000);
    const deferred = await admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 6000, ext: 'pdf' } });
    expect(deferred.status).toBe(409);
    expect(await deferred.json()).toMatchObject({ status: 'quota_deferred' });
    const big = await admin(env, 'POST', `/archive/multipart/${sha}/create`, { json: { size: 600_000_000, ext: 'pdf' } });
    expect(big.status).toBe(413);
    const sha2 = 'b2'.repeat(32);
    add('doc_0000000000000007', 'minutes', sha2, 6000);
    const c = (await (await admin(env, 'POST', `/archive/multipart/${sha2}/create`, { json: { size: 6000, ext: 'pdf' } })).json()) as { uploadId: string };
    expect(env.ARCHIVE.uploads.size).toBe(1);
    const aborted = await admin(env, 'POST', `/archive/multipart/${sha2}/abort`, { json: { uploadId: c.uploadId, ext: 'pdf' } });
    expect(await aborted.json()).toEqual({ status: 'aborted' });
    expect(env.ARCHIVE.uploads.size).toBe(0);
  });
});

describe('serving a stored file', () => {
  async function stored() {
    const { env, db, add } = seed();
    const file = bytesOf(5000);
    const sha = await hex(file);
    const key = `documents/${sha.slice(0, 2)}/${sha}.pdf`;
    add('doc_00000000000000aa', 'agenda_packet', sha, 5000, 'archived');
    db.prepare('UPDATE documents SET archive_key = ? WHERE id = ?').run(key, 'doc_00000000000000aa');
    env.ARCHIVE.objects.set(key, { bytes: file, contentType: 'application/pdf' });
    const get = (headers: Record<string, string> = {}, method = 'GET') => {
      const url = new URL('https://vineyardportal.org/api/documents/doc_00000000000000aa/file');
      return getDocumentFile(env, new Request(url, { method, headers }), 'doc_00000000000000aa', url);
    };
    return { env, file, get };
  }

  it('answers a Range with only those bytes, asking R2 for just that range', async () => {
    const { env, file, get } = await stored();
    const res = await get({ range: 'bytes=1000-1999' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 1000-1999/5000');
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(file.subarray(1000, 2000)))).toBe(true);
    expect(env.ARCHIVE.gets.at(-1)?.range).toEqual({ offset: 1000, length: 1000 });
  });

  it('serves suffix and open-ended ranges, refuses impossible ones, and the whole file without a Range', async () => {
    const { env, file, get } = await stored();
    const tail = await get({ range: 'bytes=-100' });
    expect(tail.status).toBe(206);
    expect(tail.headers.get('content-range')).toBe('bytes 4900-4999/5000');
    expect(Buffer.from(await tail.arrayBuffer()).equals(Buffer.from(file.subarray(4900)))).toBe(true);
    const open = await get({ range: 'bytes=4000-' });
    expect(open.headers.get('content-range')).toBe('bytes 4000-4999/5000');
    expect((await open.arrayBuffer()).byteLength).toBe(1000);
    const bad = await get({ range: 'bytes=6000-7000' });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */5000');
    const whole = await get();
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-length')).toBe('5000');
    expect(whole.headers.get('content-type')).toBe('application/pdf');
    expect(env.ARCHIVE.gets.at(-1)?.range).toBeUndefined();
    expect((await whole.arrayBuffer()).byteLength).toBe(5000);
  });

  it('reads no body for HEAD', async () => {
    const { env, get } = await stored();
    const before = env.ARCHIVE.gets.length;
    const head = await get({ range: 'bytes=0-99' }, 'HEAD');
    expect(head.status).toBe(206);
    expect(head.headers.get('content-length')).toBe('100');
    expect(head.body).toBeNull();
    const full = await get({}, 'HEAD');
    expect(full.headers.get('content-length')).toBe('5000');
    expect(env.ARCHIVE.gets.length).toBe(before);
  });
});

describe('the Worker sync with a large city-hosted file', () => {
  it('streams a known record over 25 MiB straight to R2, checked against its SHA-256, without reading its text', async () => {
    const { env, db, add } = seed();
    env.ARCHIVE.verifySha = true;
    const file = bytesOf(26 * 1024 * 1024 + 5);
    const sha = await hex(file);
    add('doc_00000000000000bb', 'agenda_packet', sha, file.byteLength);
    db.prepare(`INSERT INTO document_sources (id, document_id, source_id, source_url, canonical_key, retrieved_at) VALUES ('src_bb', 'doc_00000000000000bb', 's', 'https://vineyardutah.gov/packet.pdf', 'k_doc_00000000000000bb', ?)`).run(now);
    db.prepare(`INSERT INTO crawl_queue (url_key, source_id, url, status, priority, discovered_at, updated_at) VALUES ('k_doc_00000000000000bb', 's', 'https://vineyardutah.gov/packet.pdf', 'pending', 500, ?, ?)`).run(now, now);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.endsWith('/robots.txt')) return new Response('', { status: 404 });
      return new Response(file, { headers: { 'content-length': String(file.byteLength), 'content-type': 'application/pdf' } });
    });
    const { ingestItem } = await import('../worker/sync/ingest');
    const item = db.prepare(`SELECT * FROM crawl_queue WHERE url_key = 'k_doc_00000000000000bb'`).get() as unknown as Parameters<typeof ingestItem>[1];
    expect(await ingestItem(env, item, new Budget(env))).toBe('done');
    const key = `documents/${sha.slice(0, 2)}/${sha}.pdf`;
    expect(env.ARCHIVE.objects.get(key)?.bytes.byteLength).toBe(file.byteLength);
    expect((db.prepare(`SELECT archive_status FROM documents`).get() as { archive_status: string }).archive_status).toBe('archived');
    expect((db.prepare(`SELECT status FROM crawl_queue`).get() as { status: string }).status).toBe('done');
  });
});
