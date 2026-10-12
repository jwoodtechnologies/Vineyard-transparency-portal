/**
 * Records and meetings for the staff portal: add a file, note or link, change its details, take it down.
 * The storage, search indexing and size rules are the ones the owner panel already uses
 * (worker/contrib/staff.ts); this module adds who may use them (the "records" area), the activity log
 * with one-tap undo, and the public refresh after every change.
 *
 * Minutes added here are read for votes by the same cron that reads the city's own minutes, so the
 * Votes page follows within minutes.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { STAFF_TYPES } from '../lib/contrib';
import { staffDelete, staffEdit, staffFile, staffForm, lookupMeetings, lookupProjects, type Me } from '../contrib/staff';
import { ensureContribTables } from '../contrib/schema';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

/** What staff can call a file, in the order they are offered. Keys are the ones worker/lib/contrib.ts accepts. */
export const RECORD_TYPES: Array<{ key: string; label: string }> = [
  { key: 'agenda', label: 'Agenda' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'staff_report', label: 'Staff report' },
  { key: 'ordinance', label: 'Ordinance' },
  { key: 'resolution', label: 'Resolution' },
  { key: 'contract', label: 'Contract' },
  { key: 'bid_award', label: 'Bid award' },
  { key: 'budget', label: 'Budget' },
  { key: 'notice', label: 'Public notice' },
  { key: 'other', label: 'Other' },
];

/** The upload code the panel stores is the catalog's word ("procurement"); the form uses the staff word ("bid_award"). */
const KEY_OF_TYPE = new Map(Object.entries(STAFF_TYPES).map(([key, type]) => [type, key]));

/** The panel's code for "an account that is not a panel account"; the person is named in the activity log. */
const PORTAL_ACCOUNT = 0;

/** The panel functions take a panel-style actor. Staff with the records area may change any upload, like an administrator. */
const actor = (u: Pick<StaffUser, 'name'>): Me => ({ id: PORTAL_ACCOUNT, name: u.name, role: 'admin' });

interface UploadRow {
  id: string;
  kind: string;
  title: string;
  doc_type: string;
  doc_date: string | null;
  body: string | null;
  url: string | null;
  status_text: string | null;
  location: string | null;
  meeting_id: string | null;
  project_id: string | null;
  document_id: string | null;
  file_name: string | null;
}

/** The details an edit can change, as they were. */
interface Details {
  kind: string;
  title: string;
  type: string | null;
  date: string | null;
  body: string | null;
  url: string | null;
  status: string | null;
  location: string | null;
  meetingId: string | null;
  projectId: string | null;
}

const KIND_WORD: Record<string, string> = { file: 'file', note: 'note', link: 'link', project: 'project' };

async function rowOf(env: Env, id: unknown): Promise<UploadRow> {
  await ensureContribTables(env);
  const row = await env.CATALOG_DB.prepare('SELECT id, kind, title, doc_type, doc_date, body, url, status_text, location, meeting_id, project_id, document_id, file_name FROM uploads WHERE id = ?')
    .bind(String(id ?? '').slice(0, 64))
    .first<UploadRow>();
  if (!row) throw notFound('That record was not found.');
  return row;
}

const detailsOf = (r: UploadRow): Details => ({
  kind: r.kind,
  title: r.title,
  type: r.kind === 'file' ? (KEY_OF_TYPE.get(r.doc_type) ?? null) : null,
  date: r.doc_date,
  body: r.body,
  url: r.url,
  status: r.status_text,
  location: r.location,
  meetingId: r.meeting_id,
  projectId: r.project_id,
});

/** A saved set of details as the body the panel's edit function reads. */
const editBody = (id: string, d: Details): Record<string, unknown> => ({
  id,
  title: d.title,
  ...(d.type ? { type: d.type } : {}),
  date: d.date ?? '',
  body: d.body ?? '',
  text: d.body ?? '',
  description: d.body ?? '',
  url: d.url ?? '',
  status: d.status ?? '',
  location: d.location ?? '',
  meetingId: d.meetingId ?? '',
  projectId: d.projectId ?? '',
});

const word = (kind: string) => KIND_WORD[kind] ?? 'record';

/** The meetings to pick from: with no search, the latest 60 up to two weeks ahead (a record is added after or just before its meeting). */
async function meetingChoices(env: Env, q: string): Promise<Record<string, unknown>> {
  if (q.trim()) return lookupMeetings(env, q);
  const until = `${new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)}T23:59:59`;
  const r = await env.CATALOG_DB.prepare('SELECT id, title, meeting_date, government_body_name FROM meetings WHERE meeting_date IS NOT NULL AND meeting_date <= ? ORDER BY meeting_date DESC LIMIT 60')
    .bind(until)
    .all();
  return { items: r.results ?? [] };
}

async function listUploads(env: Env, url: URL): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const r = await env.CATALOG_DB.prepare(
    `SELECT u.id, u.document_id, u.kind, u.title, u.doc_type, u.doc_date, u.body, u.url, u.status_text, u.location, u.meeting_id, u.project_id,
            u.file_name, u.file_size, u.index_status, u.created_at, u.updated_at,
            coalesce(a.name, (SELECT x.account_name FROM upload_audit x WHERE x.upload_id = u.id AND x.action = 'add' ORDER BY x.id LIMIT 1)) AS added_by,
            m.title AS meeting_title, m.meeting_date AS meeting_date
     FROM uploads u
     LEFT JOIN panel_accounts a ON a.id = u.account_id AND u.account_id > 0
     LEFT JOIN meetings m ON m.id = u.meeting_id
     WHERE u.kind != 'update' AND (? = '' OR u.title LIKE ? ESCAPE '\\' OR u.file_name LIKE ? ESCAPE '\\')
     ORDER BY u.created_at DESC LIMIT 100`,
  )
    .bind(q, like, like)
    .all<Record<string, unknown>>();
  const items = (r.results ?? []).map((x) => ({ ...x, typeKey: x.kind === 'file' ? (KEY_OF_TYPE.get(String(x.doc_type)) ?? 'other') : null }));
  return { items, types: RECORD_TYPES };
}

/** The activity-log entry for one change, written in the same breath as the public refresh. */
async function log(env: Env, me: StaffUser, entry: { action: string; entity?: string; id: string; summary: string; before?: unknown; after?: unknown }): Promise<void> {
  await env.CATALOG_DB.batch([auditStatement(env, me, { area: 'records', action: entry.action, entity: entry.entity ?? 'upload', entityId: entry.id, summary: entry.summary, before: entry.before, after: entry.after })]);
  await published(env);
}

export async function records(call: StaffCall): Promise<Response | null> {
  const { env, request, url, me, route, body } = call;
  if (!route.startsWith('/records/')) return null;
  requireArea(me, 'records');

  if (request.method === 'GET') {
    if (route === '/records/uploads') return json(await listUploads(env, url));
    if (route === '/records/meetings') return json(await meetingChoices(env, url.searchParams.get('q') ?? ''));
    if (route === '/records/projects') return json(await lookupProjects(env));
    return null;
  }

  const who = actor(me);

  if (route === '/records/file') {
    // Multipart: the file and its details (the router leaves the body unread for this route).
    const r = (await staffFile(env, request, who)) as { id: string; documentId: string; status: string };
    const row = await rowOf(env, r.id);
    await log(env, me, { action: 'added', id: r.id, summary: `Added the file "${row.title}"`, after: detailsOf(row) });
    return json({ ok: true, id: r.id, documentId: r.documentId, status: r.status }, { status: 201 });
  }

  const b = body ?? {};

  if (route === '/records/note' || route === '/records/link') {
    const kind = route === '/records/note' ? 'note' : 'link';
    const r = (await staffForm(env, kind, b, who)) as { id: string; documentId: string; status: string };
    const row = await rowOf(env, r.id);
    await log(env, me, { action: 'added', id: r.id, summary: `Added the ${word(kind)} "${row.title}"`, after: detailsOf(row) });
    return json({ ok: true, id: r.id, documentId: r.documentId, status: r.status }, { status: 201 });
  }

  if (route === '/records/edit') {
    const before = await rowOf(env, b.id);
    await staffEdit(env, b, who);
    const after = await rowOf(env, before.id);
    await log(env, me, { action: 'edited', id: before.id, summary: `Changed the ${word(before.kind)} "${after.title}"`, before: detailsOf(before), after: detailsOf(after) });
    return json({ ok: true });
  }

  if (route === '/records/delete') {
    const before = await rowOf(env, b.id);
    await staffDelete(env, b, who);
    // A removed file cannot be brought back, so this entry has no Undo (the entity name is not registered).
    await log(env, me, { action: 'removed', entity: 'upload-removed', id: before.id, summary: `Removed the ${word(before.kind)} "${before.title}"`, before: detailsOf(before) });
    return json({ ok: true });
  }

  return null;
}

// Undo: adding takes the record back down; an edit puts the earlier details back.
registerUndo('upload', async (env, user, entry) => {
  const id = entry.entity_id ?? '';
  if (entry.action === 'added') {
    const row = await rowOf(env, id);
    await staffDelete(env, { id }, actor(user));
    return `Removed "${row.title}" (undid the add)`;
  }
  if (entry.action === 'edited') {
    const before = entry.before_json ? (JSON.parse(entry.before_json) as Details) : null;
    if (!before) throw badRequest('The earlier details were not kept.');
    await rowOf(env, id);
    await staffEdit(env, editBody(id, before), actor(user));
    return `Put back the earlier details of "${before.title}"`;
  }
  throw badRequest('This change cannot be undone automatically.');
});
