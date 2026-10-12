import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { JPG, ORIGIN, PNG, accept, addOwnerPasskey, call, enc, fileForm, invite, panel, pdfWith, setupOwner, signIn, uploaderSession, type TestEnv } from './helpers/panel';
import { addFile, addForm, addStatus, approveSubmission, e2eApprove, e2eCleanup, e2eState, PENDING_MESSAGE, rejectSubmission, reportSubmission, residentBytesUsed, RESIDENT_STORAGE_BYTES } from '../worker/contrib/resident';
import { getDocumentFile } from '../worker/api/documents';
import { ensureContribTables } from '../worker/contrib/schema';
import { plainText, sanitizeName, sniffFile } from '../worker/lib/contrib';
import { citationLabel, officialTopic, withoutResidentFor } from '../worker/ai/submissions';


function residentReq(path: string, init: { body?: unknown; form?: FormData; ip?: string }) {
  const headers: Record<string, string> = { 'cf-connecting-ip': init.ip ?? '192.0.2.1' };
  let body: BodyInit | undefined = init.form;
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  return new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body });
}

const note = (env: TestEnv, text: string, ip?: string, extra: Record<string, unknown> = {}) => call(() => addForm(env, residentReq('/api/add', { body: { kind: 'note', text, ...extra }, ip })));

// ------------------------------------------------------------------ pure helpers

describe('file checks', () => {
  it('reads the real type from the first bytes, not the name', () => {
    expect(sniffFile(PNG, 'x.pdf')).toBe('png');
    expect(sniffFile(JPG, 'photo.png')).toBe('jpg');
    expect(sniffFile(enc.encode('%PDF-1.7\n...'), 'a.bin')).toBe('pdf');
    expect(sniffFile(enc.encode('<html><script>alert(1)</script></html>'), 'evil.pdf')).toBeNull();
    expect(sniffFile(enc.encode('a,b\n1,2\n'), 'data.csv')).toBe('csv');
    expect(sniffFile(new Uint8Array([0, 1, 2, 3]), 'notes.txt')).toBeNull();
  });

  it('sanitizes file names and keeps only the real extension', () => {
    expect(sanitizeName('../../etc/passwd<script>.pdf.exe', 'pdf')).toBe('etc_passwd_script_.pdf.pdf');
    expect(sanitizeName('Budget 2026 (final).pdf', 'pdf')).toBe('Budget 2026 (final).pdf');
    expect(sanitizeName('', 'png')).toBe('file.png');
  });

  it('keeps notes as plain text', () => {
    expect(plainText('Hi\u0000 <b>there</b>\r\nline 2', 100)).toBe('Hi <b>there</b>\nline 2');
  });
});

describe('chat exclusion helper', () => {
  const hits = [
    { id: 1, sourceId: 'vineyard-city-website', documentType: 'minutes' },
    { id: 2, sourceId: 'resident-submitted', documentType: 'resident_submission' },
    { id: 3, sourceId: 'portal-staff', documentType: 'note' },
  ];
  it('drops resident items from vote, budget, meeting and construction questions', () => {
    for (const q of ['How did the council vote on the park?', 'What is in the 2026 budget?', 'What happened at the last meeting?', 'Is Main Street under construction?']) {
      expect(officialTopic(q)).toBe(true);
      expect(withoutResidentFor(hits, q).map((h) => h.id)).toEqual([1, 3]);
    }
  });
  it('keeps them for other questions, unless the answer path is official', () => {
    expect(withoutResidentFor(hits, 'Where is the new dog park?').map((h) => h.id)).toEqual([1, 2, 3]);
    expect(withoutResidentFor(hits, 'Where is the new dog park?', true).map((h) => h.id)).toEqual([1, 3]);
  });
  it('labels citations', () => {
    expect(citationLabel('resident-submitted')).toBe('Resident submitted. Not a city record.');
    expect(citationLabel('portal-staff')).toBe('Added by portal staff');
    expect(citationLabel('vineyard-city-website')).toBeNull();
  });
});

// ------------------------------------------------------------------ accounts

describe('panel accounts', () => {
  it('owner password keeps working after a passkey is added (sign-in unchanged)', async () => {
    const env = testEnv();
    const cookie = await setupOwner(env);
    expect((await panel(env, 'POST', '/api/login', { body: { email: 'owner@example.org', password: 'correct horse battery' } })).status).toBe(200);
    const device = await addOwnerPasskey(env, cookie);
    const again = await panel(env, 'POST', '/api/login', { body: { email: 'owner@example.org', password: 'correct horse battery' } });
    expect(again.status).toBe(200);
    const state = (await (await panel(env, 'GET', '/api/state')).json()) as { passwordAllowed: boolean };
    expect(state.passwordAllowed).toBe(true);
    const pk = await signIn(env, device);
    expect(pk.status).toBe(200);
  });

  it('the owner may remove a passkey (the password remains)', async () => {
    const env = testEnv();
    const cookie = await setupOwner(env);
    const device = await addOwnerPasskey(env, cookie);
    const r = await panel(env, 'POST', '/api/passkey/delete', { body: { id: device.id }, cookie });
    expect(r.status).toBe(200);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM panel_passkeys').get()!.n).toBe(0);
  });

  it('invite links work once', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const token = await invite(env, owner);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM panel_invites WHERE token_hash = ?').get(token)!.n).toBe(0); // only the hash is stored
    const first = await accept(env, token);
    expect(first.res.status).toBe(200);
    const again = await accept(env, token, 'Mallory', '10.0.2.2');
    expect(again.res.status).toBe(410);
    const accounts = env.CATALOG_DB.db.prepare("SELECT name FROM panel_accounts WHERE role = 'uploader'").all();
    expect(accounts.map((a) => a.name)).toEqual(['Sam']);
    // The uploader signs in with the passkey it made.
    expect((await signIn(env, first.device!)).status).toBe(200);
  });

  it('expired and revoked invites are refused', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const old = await invite(env, owner);
    env.CATALOG_DB.db.prepare('UPDATE panel_invites SET expires_at = ?').run(new Date(Date.now() - 1000).toISOString());
    expect((await accept(env, old, 'Sam', '10.0.3.1')).res.status).toBe(410);
    const revoked = await invite(env, owner);
    const id = (env.CATALOG_DB.db.prepare('SELECT token_hash FROM panel_invites WHERE expires_at > ?').get(new Date().toISOString()) as { token_hash: string }).token_hash;
    await panel(env, 'POST', '/api/invites/revoke', { body: { id }, cookie: owner });
    expect((await accept(env, revoked, 'Sam', '10.0.3.2')).res.status).toBe(410);
  });

  it('invites expire after 72 hours', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    await invite(env, owner);
    const row = env.CATALOG_DB.db.prepare('SELECT created_at, expires_at FROM panel_invites').get() as { created_at: string; expires_at: string };
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(72 * 3600_000);
  });

  it('uploaders cannot reach owner routes', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const up = await uploaderSession(env, owner);
    for (const route of ['/api/summary', '/api/visits', '/api/questions', '/api/feedback', '/api/accounts', '/api/invites', '/api/submissions', '/api/audit']) {
      expect((await panel(env, 'GET', route, { cookie: up })).status, route).toBe(403);
    }
    expect((await panel(env, 'POST', '/api/invites/create', { body: {}, cookie: up })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/submissions/switch', { body: { open: false }, cookie: up })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/password', { body: { current: 'x', next: 'yyyyyyyyyyyy' }, cookie: up })).status).toBe(403);
    expect((await panel(env, 'GET', '/api/uploads', { cookie: up })).status).toBe(200);
  });

  it('a turned-off uploader is signed out at once', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const up = await uploaderSession(env, owner);
    const id = (env.CATALOG_DB.db.prepare("SELECT id FROM panel_accounts WHERE role = 'uploader'").get() as { id: number }).id;
    expect((await panel(env, 'POST', '/api/accounts/disable', { body: { id }, cookie: owner })).status).toBe(200);
    expect((await panel(env, 'GET', '/api/uploads', { cookie: up })).status).toBe(401);
    expect((await panel(env, 'POST', '/api/accounts/disable', { body: { id: 1 }, cookie: owner })).status).toBe(400);
  });
});

// ------------------------------------------------------------------ staff uploads

describe('staff uploads', () => {
  it('indexes a note and a PDF for search, labelled as portal staff', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const r = await panel(env, 'POST', '/api/uploads/note', { body: { title: 'Park survey', text: 'Residents asked for shade at Grove Park.' }, cookie: owner });
    expect(r.status).toBe(201);
    const { documentId } = (await r.json()) as { documentId: string };
    const doc = env.CATALOG_DB.db.prepare('SELECT source_id, document_type FROM documents WHERE id = ?').get(documentId) as { source_id: string; document_type: string };
    expect(doc).toEqual({ source_id: 'portal-staff', document_type: 'note' });
    const chunk = env.SEARCH_DB_0.db.prepare('SELECT text FROM chunks WHERE document_id = ?').get(documentId) as { text: string };
    expect(chunk.text).toContain('shade at Grove Park');
    expect((env.CATALOG_DB.db.prepare("SELECT name FROM sources WHERE id = 'portal-staff'").get() as { name: string }).name).toBe('Added by portal staff');

    const pdf = await pdfWith('Water rate study for Vineyard, prepared for the City Council in May 2026');
    const up = await panel(env, 'POST', '/api/uploads/file', { form: fileForm(pdf, 'water_rates.pdf', { type: 'staff_report', date: '2026-05-01' }), cookie: owner });
    expect(up.status).toBe(201);
    const f = (await up.json()) as { documentId: string; status: string };
    expect(f.status).toBe('done');
    const row = env.CATALOG_DB.db.prepare('SELECT title, document_type, archive_status, document_date FROM documents WHERE id = ?').get(f.documentId) as Record<string, unknown>;
    expect(row).toMatchObject({ title: 'water rates', document_type: 'staff_report', archive_status: 'archived', document_date: '2026-05-01' });
    const text = env.SEARCH_DB_0.db.prepare('SELECT group_concat(text) AS t FROM chunks WHERE document_id = ?').get(f.documentId) as { t: string };
    expect(text.t).toContain('Water rate study');
    expect(env.ARCHIVE.objects.size).toBe(1);
    // Audit log has both adds.
    expect(env.CATALOG_DB.db.prepare("SELECT count(*) AS n FROM upload_audit WHERE action = 'add'").get()!.n).toBe(2);
  });

  it('refuses a file over the archive stop with a clear message', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    env.CATALOG_DB.db.prepare('UPDATE archive_stats SET stored_bytes = ?').run(7_500_000_000 - 5);
    const r = await panel(env, 'POST', '/api/uploads/file', { form: fileForm(PNG, 'map.png'), cookie: owner });
    expect(r.status).toBe(507);
    expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/archive is full/);
  });

  it('uploaders change only their own uploads; the owner can change any', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const sam = await uploaderSession(env, owner, 'Sam', '10.0.4.1');
    const kim = await uploaderSession(env, owner, 'Kim', '10.0.4.2');
    const mk = async (cookie: string, title: string) => ((await (await panel(env, 'POST', '/api/uploads/link', { body: { url: 'https://example.org/x', title }, cookie })).json()) as { id: string }).id;
    const samId = await mk(sam, 'Sam link');
    const kimId = await mk(kim, 'Kim link');
    expect((await panel(env, 'POST', '/api/uploads/delete', { body: { id: kimId }, cookie: sam })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/uploads/edit', { body: { id: kimId, title: 'Hijacked' }, cookie: sam })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/uploads/edit', { body: { id: samId, title: 'Sam link, updated', url: 'https://example.org/y' }, cookie: sam })).status).toBe(200);
    expect((await panel(env, 'POST', '/api/uploads/delete', { body: { id: samId }, cookie: sam })).status).toBe(200);
    expect((await panel(env, 'POST', '/api/uploads/delete', { body: { id: kimId }, cookie: owner })).status).toBe(200);
    expect(env.CATALOG_DB.db.prepare("SELECT count(*) AS n FROM documents WHERE source_id = 'portal-staff'").get()!.n).toBe(0);
    const actions = env.CATALOG_DB.db.prepare('SELECT action, account_name FROM upload_audit ORDER BY id').all().map((a) => `${a.action}:${a.account_name}`);
    expect(actions).toEqual(['add:Sam', 'add:Kim', 'edit:Sam', 'delete:Sam', 'delete:Owner']);
  });

  it('refuses to adopt a file that is already in the archive', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    expect((await panel(env, 'POST', '/api/uploads/file', { form: fileForm(PNG, 'a.png'), cookie: owner })).status).toBe(201);
    expect((await panel(env, 'POST', '/api/uploads/file', { form: fileForm(PNG, 'b.png'), cookie: owner })).status).toBe(409);
  });
});

// ------------------------------------------------------------------ resident submissions

/** The submission id a resident gets back (the item waits for review). */
async function subIdOf(r: Response): Promise<string> {
  const j = (await r.json()) as { id: string; pending: boolean; documentId?: string };
  expect(j.pending).toBe(true);
  expect(j.documentId).toBeUndefined();
  return j.id;
}

/** Submits, then approves as the owner would, and returns the new record id. */
async function live(env: TestEnv, r: Response | Promise<Response>): Promise<string> {
  const res = await r;
  expect(res.status).toBe(201);
  const out = await approveSubmission(env, await subIdOf(res));
  return String(out.documentId);
}

const count = (env: TestEnv, sql: string, ...args: unknown[]) => Number((env.CATALOG_DB.db.prepare(sql).get(...args) as { n: number }).n);

describe('resident submissions: pending until approved', () => {
  it('a submission is stored as pending: not indexed, not in search, not served', async () => {
    const env = testEnv();
    const r = await note(env, 'The crosswalk light on Main is broken.');
    expect(r.status).toBe(201);
    const j = (await r.clone().json()) as { message: string };
    expect(j.message).toBe(PENDING_MESSAGE);
    expect(PENDING_MESSAGE).toBe('Thanks. Your submission will appear after review.');
    const id = await subIdOf(r);
    expect(env.CATALOG_DB.db.prepare('SELECT status, document_id FROM resident_submissions WHERE id = ?').get(id)).toMatchObject({ status: 'pending', document_id: null });
    expect(count(env, 'SELECT count(*) AS n FROM documents')).toBe(0);
    expect(Number((env.SEARCH_DB_0.db.prepare('SELECT count(*) AS n FROM chunks').get() as { n: number }).n)).toBe(0);
    // Reports go only to approved items.
    expect((await call(() => reportSubmission(env, residentReq('/api/add/report', { body: { documentId: id } })))).status).toBe(404);
  });

  it('a pending file is kept under resident/ and counts against the 300 MB budget', async () => {
    const env = testEnv();
    const r = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(PNG, 'street.png') })));
    expect(r.status).toBe(201);
    await subIdOf(r);
    expect([...env.ARCHIVE.objects.keys()][0]).toMatch(/^resident\/sub_[0-9a-f]{16}\.png$/);
    expect(await residentBytesUsed(env)).toBe(PNG.byteLength);
    expect(count(env, 'SELECT count(*) AS n FROM documents')).toBe(0);
  });

  it('approve creates the labelled record exactly as before and logs it', async () => {
    const env = testEnv();
    const id = await subIdOf(await note(env, '<script>alert(1)</script> The crosswalk light on Main is broken.'));
    const { documentId } = (await approveSubmission(env, id)) as { documentId: string };
    const doc = env.CATALOG_DB.db.prepare('SELECT source_id, document_type, mime_type, original_url, meeting_id FROM documents WHERE id = ?').get(documentId) as Record<string, unknown>;
    expect(doc).toMatchObject({ source_id: 'resident-submitted', document_type: 'resident_submission', mime_type: 'text/plain', meeting_id: null });
    const chunk = env.SEARCH_DB_0.db.prepare('SELECT text FROM chunks WHERE document_id = ?').get(documentId) as { text: string };
    expect(chunk.text).toContain('<script>alert(1)</script>');
    expect(chunk.text).toContain('Resident submitted. Not a city record.');
    expect(env.CATALOG_DB.db.prepare('SELECT status, document_id FROM resident_submissions WHERE id = ?').get(id)).toMatchObject({ status: 'approved', document_id: documentId });
    const actions = env.CATALOG_DB.db.prepare('SELECT action FROM resident_log ORDER BY id').all().map((x) => x.action);
    expect(actions).toEqual(['submit', 'approve']);
    // Only pending items can be approved or rejected.
    await expect(approveSubmission(env, id)).rejects.toThrow(/not waiting for review/);
    await expect(rejectSubmission(env, id)).rejects.toThrow(/not waiting for review/);
  });

  it('reject deletes the file and the row and logs it', async () => {
    const env = testEnv();
    const id = await subIdOf(await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(JPG, 'photo.jpg', { title: 'Spam photo' }) }))));
    expect(env.ARCHIVE.objects.size).toBe(1);
    expect(await rejectSubmission(env, id)).toEqual({ ok: true });
    expect(env.ARCHIVE.objects.size).toBe(0);
    expect(count(env, 'SELECT count(*) AS n FROM resident_submissions')).toBe(0);
    expect(count(env, 'SELECT count(*) AS n FROM documents')).toBe(0);
    const last = env.CATALOG_DB.db.prepare('SELECT action, submission_id, detail FROM resident_log ORDER BY id DESC').get() as Record<string, string>;
    expect(last).toMatchObject({ action: 'reject', submission_id: id });
    expect(last.detail).toContain('Spam photo');
  });

  it('the owner reviews in the panel: Pending list with preview, file, Approve and Reject; uploaders cannot', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const fileId = await subIdOf(await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(PNG, 'map.png', { title: 'Map of the trail', description: 'Line one\nLine two' }), ip: '198.51.100.40' }))));
    const noteId = await subIdOf(await note(env, 'A note to reject', '198.51.100.41'));
    const list = (await (await panel(env, 'GET', '/api/submissions', { cookie: owner })).json()) as { pending: Array<Record<string, unknown>>; items: unknown[] };
    expect(list.items).toEqual([]);
    expect(list.pending.map((p) => p.id).sort()).toEqual([fileId, noteId].sort());
    expect(list.pending.find((p) => p.id === fileId)).toMatchObject({ title: 'Map of the trail', kind: 'file', body: 'Line one\nLine two', file_name: 'map.png' });

    const file = await panel(env, 'GET', `/api/submissions/file?id=${fileId}`, { cookie: owner });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('cache-control')).toContain('no-store');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(file.headers.get('content-security-policy')).toMatch(/^sandbox/);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    expect((await panel(env, 'GET', `/api/submissions/file?id=${fileId}`)).status).toBe(401);

    const uploader = await uploaderSession(env, owner);
    expect((await panel(env, 'GET', '/api/submissions', { cookie: uploader })).status).toBe(403);
    expect((await panel(env, 'GET', `/api/submissions/file?id=${fileId}`, { cookie: uploader })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/submissions/approve', { body: { id: fileId }, cookie: uploader })).status).toBe(403);
    expect((await panel(env, 'POST', '/api/submissions/reject', { body: { id: noteId }, cookie: uploader })).status).toBe(403);
    expect(count(env, "SELECT count(*) AS n FROM resident_submissions WHERE status = 'pending'")).toBe(2);

    // Pending items cannot be hidden or restored, only approved or rejected.
    expect((await panel(env, 'POST', '/api/submissions/hide', { body: { id: fileId }, cookie: owner })).status).toBe(400);
    const ok = await panel(env, 'POST', '/api/submissions/approve', { body: { id: fileId }, cookie: owner });
    expect(ok.status).toBe(200);
    const { documentId } = (await ok.json()) as { documentId: string };
    expect(env.CATALOG_DB.db.prepare('SELECT source_id FROM documents WHERE id = ?').get(documentId)).toMatchObject({ source_id: 'resident-submitted' });
    expect((await panel(env, 'POST', '/api/submissions/reject', { body: { id: noteId }, cookie: owner })).status).toBe(200);
    const after = (await (await panel(env, 'GET', '/api/submissions', { cookie: owner })).json()) as { pending: unknown[]; items: Array<Record<string, unknown>> };
    expect(after.pending).toEqual([]);
    expect(after.items.map((i) => i.id)).toEqual([fileId]);
    const log = (await (await panel(env, 'GET', '/api/submissions/log', { cookie: owner })).json()) as { items: Array<{ action: string }> };
    expect(log.items.map((i) => i.action).reverse()).toEqual(['submit', 'submit', 'approve', 'reject']);
  });

  it('rows from before the review step stay approved (column added on first use)', async () => {
    const env = testEnv();
    env.CATALOG_DB.db.exec(`CREATE TABLE resident_submissions (
      id TEXT PRIMARY KEY, document_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT, url TEXT, status_text TEXT, location TEXT,
      file_key TEXT, file_name TEXT, mime TEXT, file_size INTEGER, sha256 TEXT, ip_hash TEXT NOT NULL, day TEXT NOT NULL,
      reports INTEGER NOT NULL DEFAULT 0, index_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, hidden_at TEXT, removed_at TEXT)`);
    env.CATALOG_DB.db.prepare("INSERT INTO resident_submissions (id, document_id, kind, title, ip_hash, day, created_at) VALUES ('sub_old', 'doc_old', 'note', 't', 'h', '2000-01-01', '2000-01-01')").run();
    await ensureContribTables(env);
    expect(env.CATALOG_DB.db.prepare("SELECT status FROM resident_submissions WHERE id = 'sub_old'").get()).toMatchObject({ status: 'approved' });
    const id = await subIdOf(await note(env, 'new one'));
    expect(env.CATALOG_DB.db.prepare('SELECT status FROM resident_submissions WHERE id = ?').get(id)).toMatchObject({ status: 'pending' });
  });
});

describe('resident submissions', () => {
  it('links are kept as text, with no web address of their own', async () => {
    const env = testEnv();
    const documentId = await live(env, call(() => addForm(env, residentReq('/api/add', { body: { kind: 'link', url: 'https://example.org/page', title: 'A page' } }))));
    const doc = env.CATALOG_DB.db.prepare('SELECT original_url FROM documents WHERE id = ?').get(documentId) as { original_url: string };
    expect(doc.original_url.startsWith('vtp:')).toBe(true);
    expect((await call(() => addForm(env, residentReq('/api/add', { body: { kind: 'link', url: 'javascript:alert(1)' } })))).status).toBe(400);
  });

  it('checks magic bytes and the size cap', async () => {
    const env = testEnv();
    const html = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(enc.encode('<html>hi</html>'), 'doc.pdf') })));
    expect(html.status).toBe(415);
    const txt = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(enc.encode('hello'), 'a.txt'), ip: '192.0.2.2' })));
    expect(txt.status).toBe(415);
    const big = new Uint8Array(15 * 1024 * 1024 + 1);
    big.set(PNG);
    const tooBig = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(big, 'big.png'), ip: '192.0.2.3' })));
    expect(tooBig.status).toBe(413);
    const ok = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(JPG, 'photo of street.jpg', { title: 'Pothole' }), ip: '192.0.2.4' })));
    expect(ok.status).toBe(201);
    expect([...env.ARCHIVE.objects.keys()][0]).toMatch(/^resident\/sub_[0-9a-f]{16}\.jpg$/);
  });

  it('serves approved resident files sandboxed and never sniffed', async () => {
    const env = testEnv();
    const pdf = await pdfWith('Neighborhood petition about the Center Street crossing, signed by forty residents');
    const documentId = await live(env, call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(pdf, 'petition.pdf') }))));
    const url = new URL(`${ORIGIN}/api/documents/${documentId}/file`);
    const res = await getDocumentFile(env, new Request(url), documentId, url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toMatch(/^sandbox/);
    expect(res.headers.get('content-disposition')).toMatch(/^inline; filename="petition\.pdf"/);
    const text = env.SEARCH_DB_0.db.prepare('SELECT group_concat(text) AS t FROM chunks WHERE document_id = ?').get(documentId) as { t: string };
    expect(text.t).toContain('Neighborhood petition');
  });

  it('allows 3 items per person and 30 in all each day (pending ones count)', async () => {
    const env = testEnv();
    for (let i = 0; i < 3; i++) expect((await note(env, `note ${i}`, '198.51.100.1')).status).toBe(201);
    const fourth = await note(env, 'note 4', '198.51.100.1');
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: { message: string } }).error.message).toMatch(/3 items a day/);
    for (let i = 0; i < 27; i++) expect((await note(env, `n${i}`, `198.51.101.${i}`)).status).toBe(201);
    expect((await note(env, 'one more', '198.51.102.1')).status).toBe(429);
    // The address itself is never stored.
    expect(env.CATALOG_DB.db.prepare("SELECT count(*) AS n FROM resident_submissions WHERE ip_hash LIKE '198.%'").get()!.n).toBe(0);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM resident_submissions WHERE ip_hash LIKE ?').get('%192.0.2.1%')!.n).toBe(0);
  });

  it('a filled honeypot gets the same answer and stores nothing', async () => {
    const env = testEnv();
    const r = await note(env, 'spam', '203.0.113.5', { website: 'http://spam.example' });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { pending: boolean; message: string }).message).toBe(PENDING_MESSAGE);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM documents').get()!.n).toBe(0);
  });

  it('hides an approved item after reports from 2 different people', async () => {
    const env = testEnv();
    const documentId = await live(env, note(env, 'Something false'));
    const report = (ip: string) => call(() => reportSubmission(env, residentReq('/api/add/report', { body: { documentId }, ip })));
    expect((await report('203.0.113.1')).status).toBe(200);
    expect((await report('203.0.113.1')).status).toBe(200); // same person again counts once
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM documents WHERE id = ?').get(documentId)!.n).toBe(1);
    expect((await report('203.0.113.2')).status).toBe(200);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM documents WHERE id = ?').get(documentId)!.n).toBe(0);
    expect(env.SEARCH_DB_0.db.prepare('SELECT count(*) AS n FROM chunks WHERE document_id = ?').get(documentId)!.n).toBe(0);
    const sub = env.CATALOG_DB.db.prepare('SELECT hidden_at, reports FROM resident_submissions').get() as { hidden_at: string | null; reports: number };
    expect(sub.hidden_at).not.toBeNull();
    expect(sub.reports).toBe(2);
    const actions = env.CATALOG_DB.db.prepare('SELECT action FROM resident_log ORDER BY id').all().map((r) => r.action);
    expect(actions).toEqual(['submit', 'approve', 'report', 'report', 'hide']);
  });

  it('reports are rate limited per person', async () => {
    const env = testEnv();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(await live(env, note(env, `item ${i}`, `198.18.0.${i}`)));
    const statuses: number[] = [];
    for (const documentId of ids) statuses.push((await call(() => reportSubmission(env, residentReq('/api/add/report', { body: { documentId }, ip: '198.18.1.1' })))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('the owner switch pauses submissions, and removal is one click', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const documentId = await live(env, note(env, 'Bad item'));
    expect((await panel(env, 'POST', '/api/submissions/switch', { body: { open: false }, cookie: owner })).status).toBe(200);
    expect(((await (await addStatus(env)).json()) as { open: boolean }).open).toBe(false);
    const paused = await note(env, 'Another', '198.51.100.77');
    expect(paused.status).toBe(503);
    expect(((await paused.json()) as { error: { message: string } }).error.message).toBe('Submissions are paused.');
    const id = (env.CATALOG_DB.db.prepare('SELECT id FROM resident_submissions').get() as { id: string }).id;
    expect((await panel(env, 'POST', '/api/submissions/remove', { body: { id }, cookie: owner })).status).toBe(200);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM documents WHERE id = ?').get(documentId)!.n).toBe(0);
    await panel(env, 'POST', '/api/submissions/switch', { body: { open: true }, cookie: owner });
    expect((await note(env, 'Back on', '198.51.100.78')).status).toBe(201);
    const log = (await (await panel(env, 'GET', '/api/submissions/log', { cookie: owner })).json()) as { items: Array<{ action: string }> };
    expect(log.items.map((i) => i.action).reverse()).toEqual(['submit', 'approve', 'pause', 'remove', 'resume', 'submit']);
  });

  it('refuses files when the 300 MB resident budget is full', async () => {
    const env = testEnv();
    await note(env, 'seed', '198.51.100.90');
    env.CATALOG_DB.db.prepare("INSERT INTO resident_submissions (id, kind, title, file_key, file_size, ip_hash, day, created_at) VALUES ('sub_x', 'file', 't', 'resident/sub_0000000000000000.pdf', ?, 'h', '2000-01-01', '2000-01-01')").run(RESIDENT_STORAGE_BYTES - 4);
    const r = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(PNG, 'a.png'), ip: '198.51.100.91' })));
    expect(r.status).toBe(507);
  });

  it('the end to end admin routes touch only test items: pending, approve, cleanup', async () => {
    const env = testEnv();
    const realId = await subIdOf(await note(env, 'A real note from a resident', '198.51.100.7'));
    await expect(e2eState(env, realId)).rejects.toThrow(/end to end test/);
    await expect(e2eApprove(env, realId)).rejects.toThrow(/end to end test/);
    await expect(e2eCleanup(env, realId)).rejects.toThrow(/end to end test/);
    expect(env.CATALOG_DB.db.prepare('SELECT status FROM resident_submissions WHERE id = ?').get(realId)).toMatchObject({ status: 'pending' });
    const testId = await subIdOf(await note(env, 'Automated check', '198.51.100.8', { title: 'Portal end to end test e2e1' }));
    expect(await e2eState(env, testId)).toMatchObject({ status: 'pending', documentId: null, hidden: false, removed: false });
    const { documentId } = (await e2eApprove(env, testId)) as { documentId: string };
    expect(env.CATALOG_DB.db.prepare('SELECT source_id FROM documents WHERE id = ?').get(documentId)).toMatchObject({ source_id: 'resident-submitted' });
    expect(await e2eState(env, documentId)).toMatchObject({ id: testId, status: 'approved', documentId, hidden: false });
    expect(await e2eCleanup(env, testId)).toMatchObject({ ok: true, deleted: true });
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM resident_submissions WHERE id = ?').get(testId)!.n).toBe(0);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM documents WHERE id = ?').get(documentId)!.n).toBe(0);
  });
});
