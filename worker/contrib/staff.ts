/**
 * Staff uploads from the private panel: files (PDF, PNG, JPG, TXT, CSV), projects, notes and links.
 * Every account can add; an uploader edits and deletes only its own uploads, the owner any of them.
 * Every add, edit and delete is written to the audit log.
 */
import type { Env } from '../env';
import { intVar } from '../env';
import { Budget } from '../admin/routes';
import { HttpError, badRequest, notFound } from '../lib/http';
import { isIsoDate, nowIso } from '../lib/util';
import { MIME, STAFF_TYPES, plainLine, plainText, sanitizeName, sniffFile, titleFromName, webUrl, type FileKind } from '../lib/contrib';
import { sha256Hex } from '../sync/ingest';
import { SYNC_PDF_BYTES, archiveRoom, contributionFrom, createRecord, removeRecord, updateRecord, type ContribKind, type Contribution } from './indexing';
import { ensureContribTables, ensurePortalSources } from './schema';

export interface Me {
  id: number;
  name: string;
  role: 'owner' | 'uploader';
}

const TEXT_FILE_MAX = 1024 * 1024;

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** May this account change this upload? The owner may change any; an uploader only its own. */
export function canModify(me: Me, row: { account_id: number }): boolean {
  return me.role === 'owner' || Number(row.account_id) === me.id;
}

async function audit(env: Env, me: Me, action: 'add' | 'edit' | 'delete', uploadId: string, documentId: string | null, title: string): Promise<void> {
  await env.CATALOG_DB.prepare('INSERT INTO upload_audit (at, account_id, account_name, action, upload_id, document_id, title) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(nowIso(), me.id, me.name, action, uploadId, documentId, title.slice(0, 300))
    .run();
}

const dateOf = (v: unknown): string | null => (typeof v === 'string' && isIsoDate(v.trim()) ? v.trim() : null);

async function meetingOf(env: Env, v: unknown): Promise<string | null> {
  if (typeof v !== 'string' || !v.trim()) return null;
  const id = v.trim();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw badRequest('That meeting was not found.');
  const row = await env.CATALOG_DB.prepare('SELECT id FROM meetings WHERE id = ?').bind(id).first<{ id: string }>();
  if (!row) throw badRequest('That meeting was not found.');
  return row.id;
}

async function projectOf(env: Env, v: unknown): Promise<{ id: string; title: string } | null> {
  if (typeof v !== 'string' || !v.trim()) return null;
  const row = await env.CATALOG_DB.prepare("SELECT id, title FROM uploads WHERE id = ? AND kind = 'project'").bind(v.trim().slice(0, 64)).first<{ id: string; title: string }>();
  if (!row) throw badRequest('That project was not found.');
  return row;
}

async function prepare(env: Env): Promise<Budget> {
  await ensureContribTables(env);
  await ensurePortalSources(env);
  const budget = new Budget(env);
  await budget.check(20);
  return budget;
}

function friendly(e: unknown): never {
  if (e instanceof HttpError) throw e;
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.startsWith('not_new:')) throw new HttpError(409, 'bad_request', 'This file is already in the archive.');
  console.error(JSON.stringify({ event: 'staff_upload_failed', message: msg.slice(0, 300) }));
  throw new HttpError(500, 'server', 'The record could not be saved. Try again.');
}

/** One dropped file with its details (multipart form). */
export async function staffFile(env: Env, request: Request, me: Me): Promise<Record<string, unknown>> {
  const maxObject = Math.min(intVar(env.ARCHIVE_MAX_OBJECT_BYTES, 25 * 1024 * 1024), 25 * 1024 * 1024);
  if (Number(request.headers.get('content-length') ?? 0) > maxObject + 64 * 1024) throw new HttpError(413, 'bad_request', `Files can be up to ${Math.round(maxObject / 1048576)} MB.`);
  const budget = await prepare(env);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest('Choose a file to add.');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') throw badRequest('Choose a file to add.');
  if (file.size <= 0) throw badRequest('That file is empty.');
  if (file.size > maxObject) throw new HttpError(413, 'bad_request', `Files can be up to ${Math.round(maxObject / 1048576)} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffFile(bytes, file.name);
  if (!kind) throw new HttpError(415, 'bad_request', 'Only PDF, PNG, JPG, TXT or CSV files.');
  const isText = kind === 'txt' || kind === 'csv';
  if (isText && bytes.byteLength > TEXT_FILE_MAX) throw new HttpError(413, 'bad_request', 'Text and CSV files can be up to 1 MB.');
  const typeKey = String(form.get('type') ?? 'other');
  const docType = STAFF_TYPES[typeKey];
  if (!docType) throw badRequest('Choose a record type.');
  const title = plainLine(form.get('title'), 300) || titleFromName(file.name);
  const body = plainText(form.get('body'), 20_000) || null;
  const docDate = dateOf(form.get('date'));
  const meetingId = await meetingOf(env, form.get('meetingId'));
  const project = await projectOf(env, form.get('projectId'));
  const sha = await sha256Hex(bytes);
  const dup = await env.CATALOG_DB.prepare('SELECT id FROM documents WHERE sha256 = ? LIMIT 1').bind(sha).first<{ id: string }>();
  if (dup) throw new HttpError(409, 'bad_request', 'This file is already in the archive.');
  if (!isText) {
    if (!env.ARCHIVE) throw new HttpError(503, 'backend_unavailable', 'File storage is not available right now.');
    const room = await archiveRoom(env);
    if (room.stored + bytes.byteLength > room.hardStop) throw new HttpError(507, 'quota_exhausted', `The archive is full (${Math.round(room.hardStop / 1e9)} GB). The file was not added.`);
  }
  const id = `upl_${randomHex(8)}`;
  const now = nowIso();
  const fileName = sanitizeName(file.name, kind);
  const fileText = isText ? new TextDecoder().decode(bytes) : null;
  await env.CATALOG_DB.prepare(
    `INSERT INTO uploads (id, account_id, kind, title, doc_type, doc_date, body, meeting_id, project_id, file_name, mime, file_size, sha256, file_text, index_status, created_at, updated_at)
     VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, me.id, title, docType, docDate, body, meetingId, project?.id ?? null, fileName, MIME[kind], bytes.byteLength, sha, fileText, now, now)
    .run();
  const c: Contribution = {
    origin: 'staff', id, kind: 'file', title, docType, docDate, body, url: null, statusText: null, location: null, meetingId,
    projectName: project?.title ?? null, fileKind: kind, fileName, mime: MIME[kind], fileSize: bytes.byteLength, sha256: sha, fileKey: null, fileText,
  };
  try {
    const r = await createRecord(env, c, bytes, budget, kind === 'pdf' && bytes.byteLength > SYNC_PDF_BYTES);
    await env.CATALOG_DB.prepare('UPDATE uploads SET document_id = ?, index_status = ? WHERE id = ?').bind(r.documentId, r.indexStatus, id).run();
    await audit(env, me, 'add', id, r.documentId, title);
    return { ok: true, id, documentId: r.documentId, status: r.indexStatus };
  } catch (e) {
    await env.CATALOG_DB.prepare('DELETE FROM uploads WHERE id = ?').bind(id).run();
    friendly(e);
  }
}

interface FormFields {
  kind: Exclude<ContribKind, 'file'>;
  title: string;
  docType: string;
  body: string | null;
  url: string | null;
  statusText: string | null;
  location: string | null;
  docDate: string | null;
}

/** Validates a project, note or link (shared with the public page, which uses the same rules). */
export function formFields(kind: string, b: Record<string, unknown>): FormFields {
  if (kind === 'project') {
    const title = plainLine(b.name ?? b.title, 200);
    if (!title) throw badRequest('Enter a project name.');
    return { kind, title, docType: 'project', body: plainText(b.description ?? b.body, 20_000) || null, url: null, statusText: plainLine(b.status, 60) || null, location: plainLine(b.location, 200) || null, docDate: dateOf(b.date) };
  }
  if (kind === 'note') {
    const body = plainText(b.text ?? b.body, 20_000);
    if (!body) throw badRequest('Write the note.');
    const title = plainLine(b.title, 200) || plainLine(body.split('\n')[0], 80);
    return { kind, title, docType: 'note', body, url: null, statusText: null, location: null, docDate: dateOf(b.date) };
  }
  if (kind === 'link') {
    const url = webUrl(b.url);
    if (!url) throw badRequest('Enter a web address starting with https://');
    const title = plainLine(b.title, 200) || new URL(url).hostname;
    return { kind, title, docType: 'web_link', body: plainText(b.description ?? b.body, 5000) || null, url, statusText: null, location: null, docDate: dateOf(b.date) };
  }
  throw badRequest('Unknown kind.');
}

/** A project, note or link from the panel forms. */
export async function staffForm(env: Env, kind: string, b: Record<string, unknown>, me: Me): Promise<Record<string, unknown>> {
  const f = formFields(kind, b);
  const budget = await prepare(env);
  const meetingId = await meetingOf(env, b.meetingId);
  const project = f.kind === 'project' ? null : await projectOf(env, b.projectId);
  const id = `upl_${randomHex(8)}`;
  const now = nowIso();
  await env.CATALOG_DB.prepare(
    `INSERT INTO uploads (id, account_id, kind, title, doc_type, doc_date, body, url, status_text, location, meeting_id, project_id, index_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, me.id, f.kind, f.title, f.docType, f.docDate, f.body, f.url, f.statusText, f.location, meetingId, project?.id ?? null, now, now)
    .run();
  const c: Contribution = { origin: 'staff', id, ...f, meetingId, projectName: project?.title ?? null, fileKind: null, fileName: null, mime: null, fileSize: null, sha256: null, fileKey: null, fileText: null };
  try {
    const r = await createRecord(env, c, null, budget, false);
    await env.CATALOG_DB.prepare('UPDATE uploads SET document_id = ?, index_status = ? WHERE id = ?').bind(r.documentId, r.indexStatus, id).run();
    await audit(env, me, 'add', id, r.documentId, f.title);
    return { ok: true, id, documentId: r.documentId, status: r.indexStatus };
  } catch (e) {
    await env.CATALOG_DB.prepare('DELETE FROM uploads WHERE id = ?').bind(id).run();
    friendly(e);
  }
}

async function ownUpload(env: Env, id: unknown, me: Me): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const row = await env.CATALOG_DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(String(id ?? '').slice(0, 64)).first<Record<string, unknown>>();
  if (!row) throw notFound('That upload was not found.');
  if (!canModify(me, row as { account_id: number })) throw new HttpError(403, 'unauthorized', 'You can change only what you added.');
  return row;
}

/** Edits an upload's details (title, type, date, text, links). The file itself is not replaced. */
export async function staffEdit(env: Env, b: Record<string, unknown>, me: Me): Promise<Record<string, unknown>> {
  const row = await ownUpload(env, b.id, me);
  const budget = await prepare(env);
  const kind = String(row.kind) as ContribKind;
  let fields: Partial<FormFields> & { title: string; docType: string };
  if (kind === 'file') {
    const docType = b.type === undefined ? String(row.doc_type) : STAFF_TYPES[String(b.type)];
    if (!docType) throw badRequest('Choose a record type.');
    fields = { title: plainLine(b.title, 300) || String(row.title), docType, body: b.body === undefined ? ((row.body as string | null) ?? null) : plainText(b.body, 20_000) || null, docDate: b.date === undefined ? ((row.doc_date as string | null) ?? null) : dateOf(b.date) };
  } else {
    fields = formFields(kind, { ...b, name: b.name ?? b.title });
  }
  const meetingId = b.meetingId === undefined ? ((row.meeting_id as string | null) ?? null) : await meetingOf(env, b.meetingId);
  const project = kind === 'project' ? null : b.projectId === undefined ? (row.project_id ? await projectOf(env, row.project_id).catch(() => null) : null) : await projectOf(env, b.projectId);
  const next = {
    ...row,
    title: fields.title,
    doc_type: fields.docType,
    doc_date: fields.docDate ?? null,
    body: fields.body ?? null,
    url: kind === 'link' ? fields.url : row.url,
    status_text: kind === 'project' ? (fields.statusText ?? null) : row.status_text,
    location: kind === 'project' ? (fields.location ?? null) : row.location,
    meeting_id: meetingId,
    project_id: project?.id ?? null,
  };
  await env.CATALOG_DB.prepare('UPDATE uploads SET title = ?, doc_type = ?, doc_date = ?, body = ?, url = ?, status_text = ?, location = ?, meeting_id = ?, project_id = ?, updated_at = ? WHERE id = ?')
    .bind(next.title, next.doc_type, next.doc_date, next.body, next.url, next.status_text, next.location, next.meeting_id, next.project_id, nowIso(), row.id)
    .run();
  let status = 'done';
  if (row.document_id) {
    try {
      status = await updateRecord(env, String(row.document_id), contributionFrom('staff', next, project?.title ?? null), budget);
      if (kind === 'link' && next.url) await env.CATALOG_DB.prepare('UPDATE documents SET original_url = ? WHERE id = ?').bind(next.url, row.document_id).run();
    } catch (e) {
      friendly(e);
    }
    await env.CATALOG_DB.prepare('UPDATE uploads SET index_status = ? WHERE id = ?').bind(status, row.id).run();
  }
  await audit(env, me, 'edit', String(row.id), (row.document_id as string | null) ?? null, next.title);
  return { ok: true, status };
}

/** Deletes an upload and its record (and the stored file when no other record uses it). */
export async function staffDelete(env: Env, b: Record<string, unknown>, me: Me): Promise<Record<string, unknown>> {
  const row = await ownUpload(env, b.id, me);
  if (row.document_id) await removeRecord(env, String(row.document_id), 'staff');
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM uploads WHERE id = ?').bind(row.id),
    // Files that named a deleted project no longer do.
    env.CATALOG_DB.prepare('UPDATE uploads SET project_id = NULL WHERE project_id = ?').bind(row.id),
  ]);
  await audit(env, me, 'delete', String(row.id), (row.document_id as string | null) ?? null, String(row.title));
  return { ok: true };
}

/** Every staff upload, newest first, with who added it and whether this account may change it. */
export async function listUploads(env: Env, me: Me, url: URL): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const mine = url.searchParams.get('mine') === '1';
  const r = await env.CATALOG_DB.prepare(
    `SELECT u.id, u.account_id, u.document_id, u.kind, u.title, u.doc_type, u.doc_date, u.body, u.url, u.status_text, u.location, u.meeting_id, u.project_id,
            u.file_name, u.file_size, u.index_status, u.created_at, u.updated_at, a.name AS account_name, p.title AS project_title
     FROM uploads u LEFT JOIN panel_accounts a ON a.id = u.account_id LEFT JOIN uploads p ON p.id = u.project_id
     WHERE (? = 0 OR u.account_id = ?) ORDER BY u.created_at DESC LIMIT 200`,
  )
    .bind(mine ? 1 : 0, me.id)
    .all<Record<string, unknown>>();
  return { items: (r.results ?? []).map((x) => ({ ...x, canEdit: canModify(me, x as { account_id: number }) })) };
}

export async function lookupMeetings(env: Env, q: string): Promise<Record<string, unknown>> {
  const text = q.trim().slice(0, 80);
  const like = `%${text.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const r = await env.CATALOG_DB.prepare(
    `SELECT id, title, meeting_date, government_body_name FROM meetings
     WHERE (? = '' OR id = ? OR meeting_date = ? OR meeting_date LIKE ? OR title LIKE ? ESCAPE '\\')
     ORDER BY meeting_date DESC LIMIT 20`,
  )
    .bind(text, text, text, `${text}%`, like)
    .all();
  return { items: r.results ?? [] };
}

export async function lookupProjects(env: Env): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const r = await env.CATALOG_DB.prepare("SELECT id, title FROM uploads WHERE kind = 'project' ORDER BY title LIMIT 300").all();
  return { items: r.results ?? [] };
}

export async function auditLog(env: Env): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const r = await env.CATALOG_DB.prepare('SELECT * FROM upload_audit ORDER BY id DESC LIMIT 200').all();
  return { items: r.results ?? [] };
}

export type { FileKind };
