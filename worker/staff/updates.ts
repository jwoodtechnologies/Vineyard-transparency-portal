/**
 * Updates for the staff portal: a short note such as "We finished the 400 North signal". An update is a
 * record of its own, searchable and shown on the Records page and, when it names a funded project, on that
 * project's card under the map. The storage and indexing are the owner panel's (worker/contrib/updates.ts);
 * this module adds who may use them (the "notices" area), the activity log with one-tap undo, and the public
 * refresh after every change.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { utahToday } from '../lib/coverage';
import { UPDATE_TOPICS, createUpdate, deleteUpdate, editUpdate, updateProjects } from '../contrib/updates';
import { ensureContribTables } from '../contrib/schema';
import type { Me } from '../contrib/staff';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

/** The panel's code for "an account that is not a panel account"; the person is named in the activity log. */
const PORTAL_ACCOUNT = 0;
const actor = (u: Pick<StaffUser, 'name'>): Me => ({ id: PORTAL_ACCOUNT, name: u.name, role: 'admin' });

interface UpdateRow {
  id: string;
  document_id: string | null;
  title: string;
  doc_date: string | null;
  body: string | null;
  topic: string | null;
  topic_label: string | null;
  created_at: string;
  updated_at: string;
}

/** The details a change can restore, as they were. */
interface Details {
  title: string;
  date: string;
  text: string;
  topic: string;
}

const detailsOf = (r: UpdateRow): Details => ({ title: r.title, date: r.doc_date ?? '', text: r.body ?? '', topic: r.topic ?? '' });

async function rowOf(env: Env, id: unknown): Promise<UpdateRow> {
  await ensureContribTables(env);
  const row = await env.CATALOG_DB.prepare("SELECT id, document_id, title, doc_date, body, topic, topic_label, created_at, updated_at FROM uploads WHERE id = ? AND kind = 'update'")
    .bind(String(id ?? '').slice(0, 64))
    .first<UpdateRow>();
  if (!row) throw notFound('That update was not found.');
  return row;
}

async function list(env: Env): Promise<Record<string, unknown>> {
  await ensureContribTables(env);
  const r = await env.CATALOG_DB.prepare(
    `SELECT u.id, u.document_id, u.title, u.doc_date, u.body, u.topic, u.topic_label, u.created_at, u.updated_at,
            coalesce(a.name, (SELECT x.account_name FROM upload_audit x WHERE x.upload_id = u.id AND x.action = 'add' ORDER BY x.id LIMIT 1)) AS posted_by
     FROM uploads u LEFT JOIN panel_accounts a ON a.id = u.account_id AND u.account_id > 0
     WHERE u.kind = 'update' ORDER BY u.doc_date DESC, u.created_at DESC LIMIT 200`,
  ).all<UpdateRow & { posted_by: string | null }>();
  const items = (r.results ?? []).map((u) => ({
    id: u.id,
    documentId: u.document_id,
    title: u.title,
    date: u.doc_date,
    text: u.body ?? '',
    topic: u.topic ?? '',
    topicLabel: u.topic_label,
    postedBy: u.posted_by,
    updatedAt: u.updated_at,
  }));
  return { items, today: utahToday(), projects: updateProjects().map(({ key, name }) => ({ key, name })), topics: UPDATE_TOPICS };
}

/** The activity-log entry for one change, written in the same breath as the public refresh. */
async function log(env: Env, me: StaffUser, entry: { action: string; id: string; summary: string; before?: Details; after?: Details }): Promise<void> {
  await env.CATALOG_DB.batch([
    auditStatement(env, me, { area: 'notices', action: entry.action, entity: 'update', entityId: entry.id, summary: entry.summary, before: entry.before, after: entry.after }),
  ]);
  await published(env);
}

/** The headline in quotes for a log line, cut at a word when long. */
const quoted = (title: string) => {
  if (title.length <= 70) return `"${title}"`;
  const cut = title.slice(0, 70);
  return `"${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}..."`;
};

export async function updates(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route, body } = call;
  if (!route.startsWith('/updates/')) return null;
  requireArea(me, 'notices');
  if (request.method === 'GET') return route === '/updates/list' ? json(await list(env)) : null;

  const b = body ?? {};
  const who = actor(me);

  if (route === '/updates/add') {
    const r = (await createUpdate(env, b, who)) as { id: string; documentId: string | null };
    const row = await rowOf(env, r.id);
    await log(env, me, { action: 'added', id: row.id, summary: `Posted the update ${quoted(row.title)}`, after: detailsOf(row) });
    return json({ ok: true, id: row.id, documentId: row.document_id }, { status: 201 });
  }

  if (route === '/updates/edit') {
    const before = await rowOf(env, b.id);
    await editUpdate(env, b, who);
    const after = await rowOf(env, before.id);
    await log(env, me, { action: 'edited', id: before.id, summary: `Changed the update ${quoted(after.title)}`, before: detailsOf(before), after: detailsOf(after) });
    return json({ ok: true });
  }

  if (route === '/updates/remove') {
    const before = await rowOf(env, b.id);
    await deleteUpdate(env, b, who);
    await log(env, me, { action: 'removed', id: before.id, summary: `Removed the update ${quoted(before.title)}`, before: detailsOf(before) });
    return json({ ok: true });
  }

  return null;
}

/** Undo: a posted update is taken down; a change is put back; a removed update is posted again (as a new record, with the same words). */
registerUndo('update', async (env, user, entry) => {
  const id = entry.entity_id ?? '';
  const before = entry.before_json ? (JSON.parse(entry.before_json) as Details) : null;
  if (entry.action === 'added') {
    const row = await rowOf(env, id);
    await deleteUpdate(env, { id }, actor(user));
    return `Took down the update ${quoted(row.title)}`;
  }
  if (!before?.text) throw badRequest('The earlier words were not kept.');
  if (entry.action === 'edited') {
    await rowOf(env, id);
    await editUpdate(env, { id, ...before }, actor(user));
    return `Put back the earlier wording of ${quoted(before.title)}`;
  }
  if (/^upl_[0-9a-f]{16}$/.test(id) && !(await env.CATALOG_DB.prepare('SELECT 1 AS x FROM uploads WHERE id = ?').bind(id).first())) {
    await createUpdate(env, before as unknown as Record<string, unknown>, actor(user), id);
  } else {
    throw badRequest('That update is already posted.');
  }
  return `Put back the update ${quoted(before.title)}`;
});
