/**
 * Resident submissions for the staff portal: what residents sent from the public "Submit a public record"
 * page (/add). Pending items are approved (made public, labelled "Resident submitted. Not a city record.")
 * or rejected (deleted); public ones can be hidden, put back or removed for good, and new submissions can
 * be paused. The rules and storage are the owner panel's (worker/contrib/resident.ts); this module adds who
 * may use them (the "submissions" area), the activity log with one-tap undo where nothing was deleted, and
 * the public refresh after every change.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import {
  approveSubmission,
  hideSubmission,
  listSubmissions,
  rejectSubmission,
  removeSubmission,
  restoreSubmission,
  setSubmissionsOpen,
  submissionFile,
  submissionLog,
  submissionsOpen,
} from '../contrib/resident';
import { ensureContribTables } from '../contrib/schema';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

interface SubRow {
  id: string;
  kind: string;
  title: string;
  status: string;
  hidden_at: string | null;
  removed_at: string | null;
}

async function rowOf(env: Env, id: unknown): Promise<SubRow> {
  await ensureContribTables(env);
  const row = await env.CATALOG_DB.prepare('SELECT id, kind, title, status, hidden_at, removed_at FROM resident_submissions WHERE id = ?')
    .bind(String(id ?? '').slice(0, 64))
    .first<SubRow>();
  if (!row) throw notFound('That submission was not found. It may have been handled already.');
  return row;
}

/** The resident log names who acted; the panel's own entries say "by owner". */
const by = (u: Pick<StaffUser, 'name'>) => `by ${u.name}`;

/** The title in quotes for a log line, cut at a word when long. */
const quoted = (title: string) => {
  if (title.length <= 70) return `"${title}"`;
  const cut = title.slice(0, 70);
  return `"${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}..."`;
};

/** The activity-log entry for one change, then the public refresh. */
async function log(env: Env, me: StaffUser, entry: { action: string; entity: string; id: string | null; summary: string; before?: unknown; after?: unknown }): Promise<void> {
  await env.CATALOG_DB.batch([
    auditStatement(env, me, { area: 'submissions', action: entry.action, entity: entry.entity, entityId: entry.id, summary: entry.summary, before: entry.before, after: entry.after }),
  ]);
  await published(env);
}

/*
 * Entities in the activity log. Only the ones with an undo are registered:
 *   submission         hidden or restored (undo puts it back the other way)
 *   submissions-switch paused or resumed (undo flips it back)
 *   submission-review  approved or rejected (a rejection deletes the file, so neither is undone here)
 *   submission-removed removed for good (the file is deleted)
 */
export async function submissions(call: StaffCall): Promise<Response | null> {
  const { env, request, url, me, route, body } = call;
  if (!route.startsWith('/submissions/')) return null;
  requireArea(me, 'submissions');

  if (request.method === 'GET') {
    if (route === '/submissions/list') return json(await listSubmissions(env));
    if (route === '/submissions/log') return json(await submissionLog(env));
    // The stored file of a submission, pending ones included: sandboxed, never cached.
    if (route === '/submissions/file') return submissionFile(env, url.searchParams.get('id'));
    return null;
  }

  const b = body ?? {};

  if (route === '/submissions/approve') {
    const sub = await rowOf(env, b.id);
    const r = await approveSubmission(env, sub.id, by(me));
    await log(env, me, { action: 'approved', entity: 'submission-review', id: sub.id, summary: `Approved the resident submission ${quoted(sub.title)}`, after: { documentId: r.documentId } });
    return json({ ok: true, documentId: r.documentId });
  }

  if (route === '/submissions/reject') {
    const sub = await rowOf(env, b.id);
    await rejectSubmission(env, sub.id, by(me));
    await log(env, me, { action: 'rejected', entity: 'submission-review', id: sub.id, summary: `Rejected the resident submission ${quoted(sub.title)}`, before: { title: sub.title, kind: sub.kind } });
    return json({ ok: true });
  }

  if (route === '/submissions/hide') {
    const sub = await rowOf(env, b.id);
    if (sub.removed_at) throw badRequest('That item was removed for good.');
    if (sub.hidden_at) return json({ ok: true });
    await hideSubmission(env, sub.id, by(me));
    await log(env, me, { action: 'hidden', entity: 'submission', id: sub.id, summary: `Hid the resident submission ${quoted(sub.title)}` });
    return json({ ok: true });
  }

  if (route === '/submissions/restore') {
    const sub = await rowOf(env, b.id);
    if (!sub.hidden_at) return json({ ok: true });
    await restoreSubmission(env, sub.id, by(me));
    await log(env, me, { action: 'restored', entity: 'submission', id: sub.id, summary: `Put back the resident submission ${quoted(sub.title)}` });
    return json({ ok: true });
  }

  if (route === '/submissions/remove') {
    const sub = await rowOf(env, b.id);
    if (sub.status === 'pending') throw badRequest('Approve or reject this item first.');
    if (sub.removed_at) return json({ ok: true });
    await removeSubmission(env, sub.id, by(me));
    await log(env, me, { action: 'removed', entity: 'submission-removed', id: sub.id, summary: `Removed the resident submission ${quoted(sub.title)} for good`, before: { title: sub.title, kind: sub.kind } });
    return json({ ok: true });
  }

  if (route === '/submissions/switch') {
    if (typeof b.open !== 'boolean') throw badRequest('Choose whether submissions are open or paused.');
    await ensureContribTables(env);
    const was = await submissionsOpen(env);
    if (was === b.open) return json({ ok: true, open: was });
    await setSubmissionsOpen(env, b.open, by(me));
    await log(env, me, {
      action: b.open ? 'resumed' : 'paused',
      entity: 'submissions-switch',
      id: null,
      summary: b.open ? 'Opened resident submissions again' : 'Paused resident submissions',
      before: { open: was },
      after: { open: b.open },
    });
    return json({ ok: true, open: b.open });
  }

  return null;
}

// Undo: a hidden item is put back, a put-back item is hidden again.
registerUndo('submission', async (env, user, entry) => {
  const sub = await rowOf(env, entry.entity_id);
  if (sub.removed_at) throw badRequest('That item was removed for good, so this cannot be undone.');
  if (entry.action === 'hidden') {
    if (!sub.hidden_at) throw badRequest('That item is already showing.');
    await restoreSubmission(env, sub.id, by(user));
    return `Put back the resident submission ${quoted(sub.title)} (undid the hide)`;
  }
  if (entry.action === 'restored') {
    if (sub.hidden_at) throw badRequest('That item is already hidden.');
    await hideSubmission(env, sub.id, by(user));
    return `Hid the resident submission ${quoted(sub.title)} again (undid the restore)`;
  }
  throw badRequest('This change cannot be undone automatically.');
});

// Undo: the switch goes back to how it was.
registerUndo('submissions-switch', async (env, user, entry) => {
  const before = entry.before_json ? (JSON.parse(entry.before_json) as { open?: unknown }) : null;
  if (typeof before?.open !== 'boolean') throw badRequest('The earlier setting was not kept.');
  await setSubmissionsOpen(env, before.open, by(user));
  return before.open ? 'Opened resident submissions again (undid the pause)' : 'Paused resident submissions again (undid the change)';
});
