/**
 * Updates: short plain-text notes posted by the owner or an admin from the panel's Updates tab
 * ("We finished the 400 North signal"). Each one is a record of its own (document_type
 * 'staff_update', source portal-staff, the author's account on the upload row), indexed for search
 * and chat the moment it is published, shown as a record page labelled "Update from Vineyard City
 * staff, <date>", listed on the Records page, and, when it names a funded project, shown on that
 * project's card under the map as its latest update. Edits and removals are logged with what was
 * there before.
 */
import type { Env } from '../env';
import { HttpError, badRequest, json, notFound } from '../lib/http';
import { isIsoDate, nowIso } from '../lib/util';
import { plainLine, plainText, UPDATE_TYPE } from '../lib/contrib';
import { utahToday } from '../lib/coverage';
import { fundedProjects } from '../lib/projectMatch';
import { Budget } from '../admin/routes';
import { contributionFrom, createRecord, purgeCached, removeRecord, updateRecord, type Contribution } from './indexing';
import { ensureContribTables, ensurePortalSources } from './schema';
import type { Me } from './staff';

/** Plain topics for updates that are not about one funded project. */
export const UPDATE_TOPICS: Array<{ id: string; label: string }> = [
  { id: 'roads', label: 'Roads and traffic' },
  { id: 'parks', label: 'Parks and trails' },
  { id: 'water', label: 'Water and utilities' },
  { id: 'safety', label: 'Public safety' },
  { id: 'events', label: 'Events' },
  { id: 'development', label: 'Development and planning' },
  { id: 'budget', label: 'Budget and finance' },
  { id: 'services', label: 'City services' },
];

const TEXT_MAX = 20_000;
const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A funded project's name as residents read it (a dash between words becomes a space, "&" becomes "and"). */
const plainName = (s: string) =>
  s
    .replace(/\s*[\u2013\u2014]\s*/g, ' ')
    .replace(/\s&\s/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();

/** The funded projects drawn on the map (each has a card under it), for the picker. */
export function updateProjects(): Array<{ key: string; name: string; gis: string }> {
  return fundedProjects()
    .filter((p) => p.gis)
    .map((p) => ({ key: p.key, name: plainName(p.name), gis: p.gis! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface Topic {
  topic: string;
  line: string;
  gis: string | null;
}

/** "project:<key>" or "topic:<id>", checked against the lists; "" is none. */
export function topicOf(v: unknown): Topic | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const [kind, id] = v.trim().split(':', 2);
  if (kind === 'project') {
    const p = updateProjects().find((x) => x.key === id);
    if (p) return { topic: `project:${p.key}`, line: `Project: ${p.name}`, gis: p.gis };
  }
  if (kind === 'topic') {
    const t = UPDATE_TOPICS.find((x) => x.id === id);
    if (t) return { topic: `topic:${t.id}`, line: `Topic: ${t.label}`, gis: null };
  }
  throw badRequest('Choose a project or topic from the list.');
}

interface Fields {
  title: string;
  text: string;
  date: string;
  topic: Topic | null;
}

function fieldsOf(b: Record<string, unknown>): Fields {
  const text = plainText(b.text ?? b.body, TEXT_MAX);
  if (!text) throw badRequest('Write the update.');
  const title = plainLine(b.title, 200) || plainLine(text.split('\n')[0], 90);
  const raw = typeof b.date === 'string' ? b.date.trim() : '';
  if (raw && !isIsoDate(raw)) throw badRequest('Use a date like 2026-10-12.');
  return { title, text, date: raw || utahToday(), topic: topicOf(b.topic) };
}

async function prepare(env: Env): Promise<Budget> {
  await ensureContribTables(env);
  await ensurePortalSources(env);
  const budget = new Budget(env);
  await budget.check(20);
  return budget;
}

function staffOnly(me: Me): void {
  if (me.role !== 'owner' && me.role !== 'admin') throw new HttpError(403, 'unauthorized', 'Only the owner or an admin can post updates.');
}

async function log(env: Env, me: Me, action: 'add' | 'edit' | 'delete', row: { id: string; document_id: string | null; title: string }, before: Record<string, unknown> | null): Promise<void> {
  await env.CATALOG_DB.prepare('INSERT INTO upload_audit (at, account_id, account_name, action, upload_id, document_id, title, before_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(nowIso(), me.id, me.name, action, row.id, row.document_id, row.title.slice(0, 300), before ? JSON.stringify(before) : null)
    .run();
}

const contribution = (id: string, f: Fields): Contribution => ({
  origin: 'staff',
  id,
  kind: 'update',
  title: f.title,
  docType: UPDATE_TYPE,
  docDate: f.date,
  body: f.text,
  url: null,
  statusText: null,
  location: null,
  meetingId: null,
  projectName: null,
  fileKind: null,
  fileName: null,
  mime: null,
  fileSize: null,
  sha256: null,
  fileKey: null,
  fileText: null,
  topicLine: f.topic?.line ?? null,
});

/** Publishes an update: stored, made a record and indexed for search and chat at once. */
export async function createUpdate(env: Env, b: Record<string, unknown>, me: Me, restoreId?: string): Promise<Record<string, unknown>> {
  staffOnly(me);
  const f = fieldsOf(b);
  const budget = await prepare(env);
  // The staff portal's undo posts a removed update again under the id it had, so earlier log entries still find it.
  const id = restoreId ?? `upl_${randomHex(8)}`;
  const now = nowIso();
  await env.CATALOG_DB.prepare(
    `INSERT INTO uploads (id, account_id, kind, title, doc_type, doc_date, body, topic, topic_label, index_status, created_at, updated_at)
     VALUES (?, ?, 'update', ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, me.id, f.title, UPDATE_TYPE, f.date, f.text, f.topic?.topic ?? null, f.topic?.line ?? null, now, now)
    .run();
  try {
    const r = await createRecord(env, contribution(id, f), null, budget, false);
    await env.CATALOG_DB.prepare('UPDATE uploads SET document_id = ?, index_status = ? WHERE id = ?').bind(r.documentId, r.indexStatus, id).run();
    await log(env, me, 'add', { id, document_id: r.documentId, title: f.title }, null);
    return { ok: true, id, documentId: r.documentId };
  } catch (e) {
    await env.CATALOG_DB.prepare('DELETE FROM uploads WHERE id = ?').bind(id).run();
    console.error(JSON.stringify({ event: 'update_publish_failed', message: String(e instanceof Error ? e.message : e).slice(0, 300) }));
    throw new HttpError(500, 'server', 'The update could not be published. Try again.');
  }
}

async function updateRow(env: Env, id: unknown): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const row = await env.CATALOG_DB.prepare("SELECT * FROM uploads WHERE id = ? AND kind = 'update'").bind(String(id ?? '').slice(0, 64)).first<Record<string, unknown>>();
  if (!row) throw notFound('That update was not found.');
  return row;
}

const snapshot = (r: Record<string, unknown>) => ({ title: r.title, date: r.doc_date, text: r.body, topic: r.topic_label ?? null });

/** Edits an update (any owner or admin). The record is indexed again; the log keeps what it said before. */
export async function editUpdate(env: Env, b: Record<string, unknown>, me: Me): Promise<Record<string, unknown>> {
  staffOnly(me);
  const row = await updateRow(env, b.id);
  const f = fieldsOf({ text: b.text, title: b.title, date: b.date ?? row.doc_date, topic: b.topic === undefined ? (row.topic ?? '') : b.topic });
  const budget = await prepare(env);
  await env.CATALOG_DB.prepare('UPDATE uploads SET title = ?, doc_date = ?, body = ?, topic = ?, topic_label = ?, updated_at = ? WHERE id = ?')
    .bind(f.title, f.date, f.text, f.topic?.topic ?? null, f.topic?.line ?? null, nowIso(), row.id)
    .run();
  const documentId = (row.document_id as string | null) ?? null;
  if (documentId) {
    const next = { ...row, title: f.title, doc_date: f.date, body: f.text, topic_label: f.topic?.line ?? null };
    await updateRecord(env, documentId, contributionFrom('staff', next), budget);
    await purgeCached(documentId);
  }
  await log(env, me, 'edit', { id: String(row.id), document_id: documentId, title: f.title }, snapshot(row));
  return { ok: true };
}

/** Removes an update and its record (any owner or admin). The log keeps its last text. */
export async function deleteUpdate(env: Env, b: Record<string, unknown>, me: Me): Promise<Record<string, unknown>> {
  staffOnly(me);
  const row = await updateRow(env, b.id);
  if (row.document_id) await removeRecord(env, String(row.document_id), 'staff');
  await env.CATALOG_DB.prepare('DELETE FROM uploads WHERE id = ?').bind(row.id).run();
  await log(env, me, 'delete', { id: String(row.id), document_id: (row.document_id as string | null) ?? null, title: String(row.title) }, snapshot(row));
  return { ok: true };
}

/** The panel's list: every update, newest first, with its author and its history. */
export async function listUpdates(env: Env): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const db = env.CATALOG_DB;
  const r = await db
    .prepare(
      `SELECT u.id, u.document_id, u.title, u.doc_date, u.body, u.topic, u.topic_label, u.created_at, u.updated_at, a.name AS account_name
       FROM uploads u LEFT JOIN panel_accounts a ON a.id = u.account_id WHERE u.kind = 'update' ORDER BY u.doc_date DESC, u.created_at DESC LIMIT 200`,
    )
    .all<Record<string, unknown>>();
  const h = await db
    .prepare(
      `SELECT l.at, l.action, l.account_name, l.upload_id, l.title, l.before_json FROM upload_audit l
       WHERE l.upload_id IN (SELECT id FROM uploads WHERE kind = 'update') OR (l.action = 'delete' AND l.before_json IS NOT NULL) ORDER BY l.id DESC LIMIT 400`,
    )
    .all<{ at: string; action: string; account_name: string | null; upload_id: string; title: string; before_json: string | null }>();
  const history = new Map<string, unknown[]>();
  const removed: unknown[] = [];
  for (const x of h.results ?? []) {
    const entry = { at: x.at, action: x.action, by: x.account_name, title: x.title, before: x.before_json ? (JSON.parse(x.before_json) as unknown) : null };
    if (x.action === 'delete') removed.push(entry);
    else history.set(x.upload_id, [...(history.get(x.upload_id) ?? []), entry]);
  }
  return {
    items: (r.results ?? []).map((u) => ({ ...u, history: history.get(String(u.id)) ?? [] })),
    removed: removed.slice(0, 20),
    projects: updateProjects().map(({ key, name }) => ({ key, name })),
    topics: UPDATE_TOPICS,
    today: utahToday(),
  };
}

/**
 * GET /api/updates?project=<funded project key>&limit=<1..100>: published updates, newest first, for
 * the Records page and the project cards under the map. Read straight from the catalog (no edge copy),
 * so a new update shows at once.
 */
export async function publicUpdates(env: Env, url: URL): Promise<Response> {
  const n = Number(url.searchParams.get('limit'));
  const limit = Number.isInteger(n) && n > 0 && n <= 100 ? n : 20;
  const project = url.searchParams.get('project');
  const topic = project && /^[a-z0-9-]{1,100}$/.test(project) ? `project:${project}` : null;
  let rows: Array<Record<string, unknown>>;
  try {
    await ensureContribTables(env);
    const r = await env.CATALOG_DB.prepare(
      `SELECT u.document_id, u.title, u.doc_date, substr(u.body, 1, 400) AS body, u.topic, u.topic_label, u.updated_at
       FROM uploads u JOIN documents d ON d.id = u.document_id
       WHERE u.kind = 'update' AND (? IS NULL OR u.topic = ?) ORDER BY u.doc_date DESC, u.created_at DESC LIMIT ?`,
    )
      .bind(topic, topic, limit)
      .all<Record<string, unknown>>();
    rows = r.results ?? [];
  } catch {
    // Before the panel tables exist there are no updates.
    rows = [];
  }
  const gisByKey = new Map(updateProjects().map((p) => [p.key, p.gis]));
  const items = rows.map((u) => {
    const t = typeof u.topic === 'string' ? u.topic : '';
    const key = t.startsWith('project:') ? t.slice(8) : null;
    return {
      id: u.document_id,
      title: u.title,
      date: u.doc_date,
      text: u.body,
      topic: (u.topic_label as string | null) ?? null,
      projectKey: key,
      projectGis: key ? (gisByKey.get(key) ?? null) : null,
      updatedAt: u.updated_at,
    };
  });
  return json({ items }, { cache: 'public, max-age=30' });
}
