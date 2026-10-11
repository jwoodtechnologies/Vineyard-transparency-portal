import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { testEnv } from './helpers/d1';
import { PANEL_PREFIX, handlePanel } from '../worker/panel/routes';
import { newSetupCode } from '../worker/panel/auth';
import { addFile, addForm, addStatus, reportSubmission, RESIDENT_STORAGE_BYTES } from '../worker/contrib/resident';
import { getDocumentFile } from '../worker/api/documents';
import { HttpError } from '../worker/lib/http';
import { plainText, sanitizeName, sniffFile } from '../worker/lib/contrib';
import { citationLabel, officialTopic, withoutResidentFor } from '../worker/ai/submissions';

type TestEnv = ReturnType<typeof testEnv>;
const ORIGIN = 'https://vineyardportal.org';
const RP = 'vineyardportal.org';
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => {
  let s = '';
  for (const x of b instanceof Uint8Array ? b : new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

async function pdfWith(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  page.drawText(text, { x: 40, y: 300, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

/** Calls the handler and turns an HttpError into the response the Worker would send. */
async function call(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify({ error: { message: e.message } }), { status: e.status });
    throw e;
  }
}

function panel(env: TestEnv, method: string, route: string, opts: { body?: unknown; form?: FormData; cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { 'x-vtp-panel': '1', 'cf-connecting-ip': opts.ip ?? '10.0.0.1' };
  if (opts.cookie) headers.cookie = `vtp_k=${opts.cookie}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const url = new URL(`${ORIGIN}${PANEL_PREFIX}${route}`);
  return call(() => handlePanel(env, new Request(url, { method, headers, body }), url));
}

const cookieOf = (r: Response) => /vtp_k=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';

function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 0x80) v = new Uint8Array([0, ...v]);
    return new Uint8Array([0x02, v.length, ...v]);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

async function authData(counter = 0): Promise<Uint8Array> {
  const rp = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(RP)));
  return new Uint8Array([...rp, 0x05, 0, 0, 0, counter]);
}

interface Device {
  id: string;
  keys: CryptoKeyPair;
}

/** A software authenticator: makes the registration body the panel page would send. */
async function register(challenge: string, extra: Record<string, unknown> = {}): Promise<{ device: Device; body: Record<string, unknown> }> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const id = b64u(crypto.getRandomValues(new Uint8Array(20)));
  const clientDataJSON = b64u(enc.encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN })));
  const spki = (await crypto.subtle.exportKey('spki', keys.publicKey)) as ArrayBuffer;
  return { device: { id, keys }, body: { id, clientDataJSON, authenticatorData: b64u(await authData()), publicKey: b64u(spki), alg: -7, name: 'Test', ...extra } };
}

async function signIn(env: TestEnv, device: Device, ip = '10.0.0.9'): Promise<Response> {
  const { challenge } = (await (await panel(env, 'POST', '/api/passkey/login/options', { body: {}, ip })).json()) as { challenge: string };
  const client = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN }));
  const ad = await authData();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', client));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.keys.privateKey, new Uint8Array([...ad, ...hash])));
  return panel(env, 'POST', '/api/passkey/login', { body: { id: device.id, clientDataJSON: b64u(client), authenticatorData: b64u(ad), signature: b64u(rawToDer(sig)) }, ip });
}

async function setupOwner(env: TestEnv): Promise<string> {
  const code = await newSetupCode(env);
  const r = await panel(env, 'POST', '/api/setup', { body: { code, email: 'owner@example.org', password: 'correct horse battery' } });
  expect(r.status).toBe(200);
  return cookieOf(r);
}

async function addOwnerPasskey(env: TestEnv, cookie: string): Promise<Device> {
  const o = (await (await panel(env, 'POST', '/api/passkey/register/options', { body: {}, cookie })).json()) as { challenge: string };
  const { device, body } = await register(o.challenge);
  const r = await panel(env, 'POST', '/api/passkey/register', { body, cookie });
  expect(r.status, await r.clone().text()).toBe(200);
  return device;
}

async function invite(env: TestEnv, ownerCookie: string, name = 'Sam'): Promise<string> {
  const r = await panel(env, 'POST', '/api/invites/create', { body: { name }, cookie: ownerCookie });
  expect(r.status).toBe(200);
  const j = (await r.json()) as { path: string };
  return j.path.split('/invite/')[1];
}

async function accept(env: TestEnv, token: string, name = 'Sam', ip = '10.0.1.1'): Promise<{ res: Response; device?: Device }> {
  const o = await panel(env, 'POST', '/api/invite/options', { body: { token }, ip });
  if (o.status !== 200) return { res: o };
  const { challenge } = (await o.json()) as { challenge: string };
  const { device, body } = await register(challenge, { token, name });
  return { res: await panel(env, 'POST', '/api/invite/accept', { body, ip }), device };
}

async function uploaderSession(env: TestEnv, ownerCookie: string, name = 'Sam', ip = '10.0.1.1'): Promise<string> {
  const { res } = await accept(env, await invite(env, ownerCookie, name), name, ip);
  expect(res.status).toBe(200);
  return cookieOf(res);
}

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
function fileForm(bytes: Uint8Array, name: string, fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append('file', new File([bytes], name));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

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
  it('owner password works only until the owner has a passkey', async () => {
    const env = testEnv();
    const cookie = await setupOwner(env);
    expect((await panel(env, 'POST', '/api/login', { body: { email: 'owner@example.org', password: 'correct horse battery' } })).status).toBe(200);
    const device = await addOwnerPasskey(env, cookie);
    const refused = await panel(env, 'POST', '/api/login', { body: { email: 'owner@example.org', password: 'correct horse battery' } });
    expect(refused.status).toBe(403);
    const state = (await (await panel(env, 'GET', '/api/state')).json()) as { passwordAllowed: boolean };
    expect(state.passwordAllowed).toBe(false);
    const pk = await signIn(env, device);
    expect(pk.status).toBe(200);
    expect(cookieOf(pk)).not.toBe('');
  });

  it('never removes the last passkey', async () => {
    const env = testEnv();
    const cookie = await setupOwner(env);
    const device = await addOwnerPasskey(env, cookie);
    const r = await panel(env, 'POST', '/api/passkey/delete', { body: { id: device.id }, cookie });
    expect(r.status).toBe(400);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM panel_passkeys').get()!.n).toBe(1);
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
    env.CATALOG_DB.db.prepare('UPDATE archive_stats SET stored_bytes = ?').run(6_000_000_000 - 5);
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

describe('resident submissions', () => {
  it('adds a plain-text note to its own labelled collection', async () => {
    const env = testEnv();
    const r = await note(env, '<script>alert(1)</script> The crosswalk light on Main is broken.');
    expect(r.status).toBe(201);
    const { documentId } = (await r.json()) as { documentId: string };
    const doc = env.CATALOG_DB.db.prepare('SELECT source_id, document_type, mime_type, original_url, meeting_id FROM documents WHERE id = ?').get(documentId) as Record<string, unknown>;
    expect(doc).toMatchObject({ source_id: 'resident-submitted', document_type: 'resident_submission', mime_type: 'text/plain', meeting_id: null });
    expect(String(doc.original_url)).not.toMatch(/^https?:/);
    const chunk = env.SEARCH_DB_0.db.prepare('SELECT text FROM chunks WHERE document_id = ?').get(documentId) as { text: string };
    // Kept as literal text, never interpreted, and carrying the label.
    expect(chunk.text).toContain('<script>alert(1)</script>');
    expect(chunk.text).toContain('Resident submitted. Not a city record.');
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM resident_submissions WHERE ip_hash LIKE ?').get('%192.0.2.1%')!.n).toBe(0);
  });

  it('links are kept as text, with no web address of their own', async () => {
    const env = testEnv();
    const r = await call(() => addForm(env, residentReq('/api/add', { body: { kind: 'link', url: 'https://example.org/page', title: 'A page' } })));
    const { documentId } = (await r.json()) as { documentId: string };
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

  it('serves resident files sandboxed and never sniffed', async () => {
    const env = testEnv();
    const pdf = await pdfWith('Neighborhood petition about the Center Street crossing, signed by forty residents');
    const r = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(pdf, 'petition.pdf') })));
    const { documentId } = (await r.json()) as { documentId: string };
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

  it('allows 3 items per person and 30 in all each day', async () => {
    const env = testEnv();
    for (let i = 0; i < 3; i++) expect((await note(env, `note ${i}`, '198.51.100.1')).status).toBe(201);
    const fourth = await note(env, 'note 4', '198.51.100.1');
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: { message: string } }).error.message).toMatch(/3 items a day/);
    for (let i = 0; i < 27; i++) expect((await note(env, `n${i}`, `198.51.101.${i}`)).status).toBe(201);
    expect((await note(env, 'one more', '198.51.102.1')).status).toBe(429);
    // The address itself is never stored.
    expect(env.CATALOG_DB.db.prepare("SELECT count(*) AS n FROM resident_submissions WHERE ip_hash LIKE '198.%'").get()!.n).toBe(0);
  });

  it('a filled honeypot stores nothing', async () => {
    const env = testEnv();
    const r = await note(env, 'spam', '203.0.113.5', { website: 'http://spam.example' });
    expect(r.status).toBe(201);
    expect(env.CATALOG_DB.db.prepare('SELECT count(*) AS n FROM documents').get()!.n).toBe(0);
  });

  it('hides an item after reports from 2 different people', async () => {
    const env = testEnv();
    const { documentId } = (await (await note(env, 'Something false')).json()) as { documentId: string };
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
    expect(actions).toEqual(['submit', 'report', 'report', 'hide']);
  });

  it('reports are rate limited per person', async () => {
    const env = testEnv();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) ids.push(((await (await note(env, `item ${i}`, `198.18.0.${i}`)).json()) as { documentId: string }).documentId);
    const statuses: number[] = [];
    for (const documentId of ids) statuses.push((await call(() => reportSubmission(env, residentReq('/api/add/report', { body: { documentId }, ip: '198.18.1.1' })))).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('the owner switch pauses submissions, and removal is one click', async () => {
    const env = testEnv();
    const owner = await setupOwner(env);
    const { documentId } = (await (await note(env, 'Bad item')).json()) as { documentId: string };
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
    expect(log.items.map((i) => i.action).reverse()).toEqual(['submit', 'pause', 'remove', 'resume', 'submit']);
  });

  it('refuses files when the 300 MB resident budget is full', async () => {
    const env = testEnv();
    await note(env, 'seed', '198.51.100.90');
    env.CATALOG_DB.db.prepare("INSERT INTO resident_submissions (id, kind, title, file_key, file_size, ip_hash, day, created_at) VALUES ('sub_x', 'file', 't', 'resident/sub_0000000000000000.pdf', ?, 'h', '2000-01-01', '2000-01-01')").run(RESIDENT_STORAGE_BYTES - 4);
    const r = await call(() => addFile(env, residentReq('/api/add/file', { form: fileForm(PNG, 'a.png'), ip: '198.51.100.91' })));
    expect(r.status).toBe(507);
  });
});
