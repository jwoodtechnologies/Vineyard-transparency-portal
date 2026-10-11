/**
 * The public "Add to the record" page (/add): anyone can add a document (PDF, PNG, JPG), a project,
 * a note or a link. Each goes live at once in its own collection (source resident-submitted, type
 * resident_submission), labelled "Resident submitted. Not a city record." everywhere it shows.
 *
 * Guard rails, with no secret: plain text only, a honeypot field, 3 items per person and 30 in all
 * per day (people are told apart by a salted hash of the IP address; the address itself is never
 * stored), a Report button that hides an item after reports from 2 different people, a 300 MB
 * budget for files (R2 prefix resident/), and an on/off switch and one-click removal for the owner.
 */
import type { Env } from '../env';
import { Budget } from '../admin/routes';
import { HttpError, badRequest, json, notFound, readJson } from '../lib/http';
import { nowIso, utcDay } from '../lib/util';
import { MIME, plainLine, sanitizeName, sniffFile, titleFromName, plainText } from '../lib/contrib';
import { sha256Hex } from '../sync/ingest';
import { SYNC_PDF_BYTES, contributionFrom, createRecord, purgeCached, removeRecord, type Contribution } from './indexing';
import { ensureContribTables, ensurePortalSources, getSetting, setSetting } from './schema';
import { formFields } from './staff';

export const RESIDENT_FILE_MAX = 15 * 1024 * 1024;
export const RESIDENT_STORAGE_BYTES = 300 * 1024 * 1024;
export const PER_PERSON_PER_DAY = 3;
export const TOTAL_PER_DAY = 30;
export const REPORTS_TO_HIDE = 2;
export const REPORTS_PER_PERSON_PER_DAY = 10;
export const PAUSED_MESSAGE = 'Submissions are paused.';

const NO_STORE = { cache: 'no-store' };
const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A salted hash of the visitor's IP address. The salt is random, kept in the database, and never leaves it. */
export async function ipHash(env: Env, request: Request): Promise<string> {
  let salt = await getSetting(env, 'ip_salt', '');
  if (!salt) {
    salt = randomHex(32);
    await env.CATALOG_DB.prepare('INSERT OR IGNORE INTO portal_settings (key, value, updated_at) VALUES (?, ?, ?)').bind('ip_salt', salt, nowIso()).run();
    salt = await getSetting(env, 'ip_salt', salt);
  }
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return (await sha256Hex(`${salt}|${ip}`)).slice(0, 32);
}

export async function submissionsOpen(env: Env): Promise<boolean> {
  return (await getSetting(env, 'submissions_open', '1')) === '1';
}

async function log(env: Env, action: string, submissionId: string | null, ip: string | null, detail: string | null = null): Promise<void> {
  await env.CATALOG_DB.prepare('INSERT INTO resident_log (at, action, submission_id, ip_hash, detail) VALUES (?, ?, ?, ?, ?)').bind(nowIso(), action, submissionId, ip, detail?.slice(0, 300) ?? null).run();
}

export async function residentBytesUsed(env: Env): Promise<number> {
  const r = await env.CATALOG_DB.prepare('SELECT coalesce(sum(file_size), 0) AS n FROM resident_submissions WHERE removed_at IS NULL AND file_key IS NOT NULL').first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** Refuses when the switch is off or today's limits are reached. */
async function gate(env: Env, ip: string): Promise<void> {
  if (!(await submissionsOpen(env))) throw new HttpError(503, 'backend_unavailable', PAUSED_MESSAGE);
  const r = await env.CATALOG_DB.prepare('SELECT count(*) AS total, sum(CASE WHEN ip_hash = ? THEN 1 ELSE 0 END) AS mine FROM resident_submissions WHERE day = ?').bind(ip, utcDay()).first<{ total: number; mine: number | null }>();
  if (Number(r?.mine ?? 0) >= PER_PERSON_PER_DAY) throw new HttpError(429, 'rate_limited', `You can add ${PER_PERSON_PER_DAY} items a day. Try again tomorrow.`, 3600);
  if (Number(r?.total ?? 0) >= TOTAL_PER_DAY) throw new HttpError(429, 'rate_limited', "Today's limit for new items is reached. Try again tomorrow.", 3600);
}

async function begin(env: Env, request: Request): Promise<{ ip: string; budget: Budget }> {
  await ensureContribTables(env);
  await ensurePortalSources(env);
  const ip = await ipHash(env, request);
  await gate(env, ip);
  const budget = new Budget(env);
  await budget.check(20);
  return { ip, budget };
}

/** A honeypot hit gets the same answer as a real submission, and nothing is stored. */
const trapped = (v: unknown) => typeof v === 'string' && v.trim() !== '';

async function finish(env: Env, c: Contribution, bytes: Uint8Array | null, ip: string, budget: Budget): Promise<Response> {
  try {
    const r = await createRecord(env, c, bytes, budget, c.fileKind === 'pdf' && (c.fileSize ?? 0) > SYNC_PDF_BYTES);
    await env.CATALOG_DB.prepare('UPDATE resident_submissions SET document_id = ?, index_status = ? WHERE id = ?').bind(r.documentId, r.indexStatus, c.id).run();
    await log(env, 'submit', c.id, ip, `${c.kind}: ${c.title}`);
    return json({ ok: true, documentId: r.documentId }, { status: 201 });
  } catch (e) {
    await env.CATALOG_DB.prepare('DELETE FROM resident_submissions WHERE id = ?').bind(c.id).run();
    if (c.fileKey && env.ARCHIVE) await env.ARCHIVE.delete(c.fileKey).catch(() => undefined);
    if (e instanceof HttpError) throw e;
    console.error(JSON.stringify({ event: 'resident_submit_failed', message: String(e instanceof Error ? e.message : e).slice(0, 300) }));
    throw new HttpError(500, 'server', 'That could not be added. Try again later.');
  }
}

/** POST /api/add/file (multipart: file, title, description, website). */
export async function addFile(env: Env, request: Request): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > RESIDENT_FILE_MAX + 64 * 1024) throw new HttpError(413, 'bad_request', 'Files can be up to 15 MB.');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest('Choose a file to add.');
  }
  if (trapped(form.get('website'))) return json({ ok: true }, { status: 201 });
  const { ip, budget } = await begin(env, request);
  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('Choose a file to add.');
  if (file.size <= 0) throw badRequest('That file is empty.');
  if (file.size > RESIDENT_FILE_MAX) throw new HttpError(413, 'bad_request', 'Files can be up to 15 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffFile(bytes);
  if (kind !== 'pdf' && kind !== 'png' && kind !== 'jpg') throw new HttpError(415, 'bad_request', 'Only PDF, PNG or JPG files.');
  if (!env.ARCHIVE) throw new HttpError(503, 'backend_unavailable', 'Adding files is not available right now.');
  if ((await residentBytesUsed(env)) + bytes.byteLength > RESIDENT_STORAGE_BYTES) throw new HttpError(507, 'quota_exhausted', 'Storage for added files is full. Try a note or a link instead.');
  const title = plainLine(form.get('title'), 200) || titleFromName(sanitizeName(file.name, kind));
  const body = plainText(form.get('description'), 5000) || null;
  const id = `sub_${randomHex(8)}`;
  const key = `resident/${id}.${kind}`;
  const sha = await sha256Hex(bytes);
  const fileName = sanitizeName(file.name, kind);
  await env.ARCHIVE.put(key, bytes, { httpMetadata: { contentType: MIME[kind], contentDisposition: `inline; filename="${fileName}"` } });
  await env.CATALOG_DB.prepare(
    `INSERT INTO resident_submissions (id, kind, title, body, file_key, file_name, mime, file_size, sha256, ip_hash, day, created_at) VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, title, body, key, fileName, MIME[kind], bytes.byteLength, sha, ip, utcDay(), nowIso())
    .run();
  const c: Contribution = {
    origin: 'resident', id, kind: 'file', title, docType: 'resident_submission', docDate: null, body, url: null, statusText: null, location: null, meetingId: null,
    projectName: null, fileKind: kind, fileName, mime: MIME[kind], fileSize: bytes.byteLength, sha256: sha, fileKey: key, fileText: null,
  };
  return finish(env, c, bytes, ip, budget);
}

/** POST /api/add (JSON: kind project | note | link, plus its fields, plus the website honeypot). */
export async function addForm(env: Env, request: Request): Promise<Response> {
  const b = await readJson<Record<string, unknown>>(request, 32 * 1024);
  if (trapped(b.website)) return json({ ok: true }, { status: 201 });
  const kind = String(b.kind ?? '');
  if (!['project', 'note', 'link'].includes(kind)) throw badRequest('Choose what to add.');
  const f = formFields(kind, b);
  const { ip, budget } = await begin(env, request);
  const id = `sub_${randomHex(8)}`;
  await env.CATALOG_DB.prepare(
    `INSERT INTO resident_submissions (id, kind, title, body, url, status_text, location, ip_hash, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, f.kind, f.title, f.body, f.url, f.statusText, f.location, ip, utcDay(), nowIso())
    .run();
  const c: Contribution = { origin: 'resident', id, ...f, docType: 'resident_submission', docDate: null, meetingId: null, projectName: null, fileKind: null, fileName: null, mime: null, fileSize: null, sha256: null, fileKey: null, fileText: null };
  return finish(env, c, null, ip, budget);
}

/** Takes a submission out of search and the catalog, keeping its file so the owner can restore it. */
async function hide(env: Env, sub: Record<string, unknown>, ip: string | null, why: string): Promise<void> {
  if (sub.document_id) await removeRecord(env, String(sub.document_id), 'resident', { keepFile: true });
  await env.CATALOG_DB.prepare('UPDATE resident_submissions SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL').bind(nowIso(), sub.id).run();
  await log(env, 'hide', String(sub.id), ip, why);
}

/** POST /api/add/report {documentId}: a second report from a different person hides the item. */
export async function reportSubmission(env: Env, request: Request): Promise<Response> {
  await ensureContribTables(env);
  const b = await readJson<Record<string, unknown>>(request, 4 * 1024);
  const documentId = typeof b.documentId === 'string' ? b.documentId.slice(0, 64) : '';
  const sub = await env.CATALOG_DB.prepare('SELECT * FROM resident_submissions WHERE document_id = ? AND removed_at IS NULL').bind(documentId).first<Record<string, unknown>>();
  if (!sub) throw notFound('That item was not found.');
  const ip = await ipHash(env, request);
  const day = utcDay();
  const mine = await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM resident_reports WHERE ip_hash = ? AND day = ?').bind(ip, day).first<{ n: number }>();
  if (Number(mine?.n ?? 0) >= REPORTS_PER_PERSON_PER_DAY) throw new HttpError(429, 'rate_limited', 'Too many reports today. Try again tomorrow.', 3600);
  const ins = await env.CATALOG_DB.prepare('INSERT OR IGNORE INTO resident_reports (submission_id, ip_hash, day, at) VALUES (?, ?, ?, ?)').bind(sub.id, ip, day, nowIso()).run();
  if (Number(ins.meta?.changes ?? 0) > 0) {
    await log(env, 'report', String(sub.id), ip);
    const n = await env.CATALOG_DB.prepare('SELECT count(DISTINCT ip_hash) AS n FROM resident_reports WHERE submission_id = ?').bind(sub.id).first<{ n: number }>();
    const count = Number(n?.n ?? 0);
    await env.CATALOG_DB.prepare('UPDATE resident_submissions SET reports = ? WHERE id = ?').bind(count, sub.id).run();
    if (count >= REPORTS_TO_HIDE && !sub.hidden_at) await hide(env, sub, null, `${count} reports`);
  }
  return json({ ok: true }, { status: 200, ...NO_STORE });
}

export async function addStatus(env: Env): Promise<Response> {
  await ensureContribTables(env);
  return json({ open: await submissionsOpen(env) }, NO_STORE);
}

// ------------------------------------------------------------------ owner moderation (panel)

export async function listSubmissions(env: Env): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const r = await env.CATALOG_DB.prepare(
    `SELECT id, document_id, kind, title, substr(body, 1, 400) AS body, url, status_text, location, file_name, mime, file_size, substr(ip_hash, 1, 8) AS person,
            reports, index_status, created_at, hidden_at, removed_at FROM resident_submissions ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return { items: r.results ?? [], open: await submissionsOpen(env), storage: { used: await residentBytesUsed(env), limit: RESIDENT_STORAGE_BYTES } };
}

export async function submissionLog(env: Env): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const r = await env.CATALOG_DB.prepare('SELECT id, at, action, submission_id, substr(ip_hash, 1, 8) AS person, detail FROM resident_log ORDER BY id DESC LIMIT 300').all();
  return { items: r.results ?? [] };
}

async function submission(env: Env, id: unknown): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const sub = await env.CATALOG_DB.prepare('SELECT * FROM resident_submissions WHERE id = ?').bind(String(id ?? '').slice(0, 64)).first<Record<string, unknown>>();
  if (!sub) throw notFound('That item was not found.');
  return sub;
}

/** One-click removal: out of the catalog and search, and the file deleted. */
export async function removeSubmission(env: Env, id: unknown): Promise<Record<string, unknown>> {
  const sub = await submission(env, id);
  if (sub.removed_at) return { ok: true };
  if (sub.document_id) await removeRecord(env, String(sub.document_id), 'resident');
  if (sub.file_key && env.ARCHIVE) await env.ARCHIVE.delete(String(sub.file_key)).catch(() => undefined);
  await env.CATALOG_DB.prepare('UPDATE resident_submissions SET removed_at = ? WHERE id = ?').bind(nowIso(), sub.id).run();
  await log(env, 'remove', String(sub.id), null, 'by owner');
  return { ok: true };
}

export async function hideSubmission(env: Env, id: unknown): Promise<Record<string, unknown>> {
  const sub = await submission(env, id);
  if (!sub.hidden_at && !sub.removed_at) await hide(env, sub, null, 'by owner');
  return { ok: true };
}

/** Puts a hidden item back (reports start again from zero). */
export async function restoreSubmission(env: Env, id: unknown): Promise<Record<string, unknown>> {
  const sub = await submission(env, id);
  if (sub.removed_at) throw badRequest('Removed items cannot be restored.');
  if (!sub.hidden_at) return { ok: true };
  const budget = new Budget(env);
  const c = contributionFrom('resident', sub);
  let bytes: Uint8Array | null = null;
  if (c.fileKey) {
    const obj = env.ARCHIVE ? await env.ARCHIVE.get(c.fileKey) : null;
    if (!obj) throw badRequest('The file is no longer stored.');
    bytes = new Uint8Array(await obj.arrayBuffer());
  }
  const r = await createRecord(env, c, bytes, budget, c.fileKind === 'pdf' && (c.fileSize ?? 0) > SYNC_PDF_BYTES);
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('UPDATE resident_submissions SET hidden_at = NULL, reports = 0, document_id = ?, index_status = ? WHERE id = ?').bind(r.documentId, r.indexStatus, sub.id),
    env.CATALOG_DB.prepare('DELETE FROM resident_reports WHERE submission_id = ?').bind(sub.id),
  ]);
  await purgeCached(r.documentId);
  await log(env, 'restore', String(sub.id), null, 'by owner');
  return { ok: true };
}

export async function setSubmissionsOpen(env: Env, open: boolean): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  await setSetting(env, 'submissions_open', open ? '1' : '0');
  await log(env, open ? 'resume' : 'pause', null, null, 'by owner');
  return { ok: true, open };
}
