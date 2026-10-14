/**
 * Watched websites, for owners and administrators: add a public web page for the portal to check, with a
 * label and how often; pause, edit or delete it. Every change is in the activity log and can be undone.
 * The checking itself is worker/sync/webWatch.ts, run by the five-minute cron.
 */
import { Budget } from '../admin/routes';
import { badRequest, HttpError, json, notFound } from '../lib/http';
import { BUDGET_STOP, checkWatchUrl, ensureWatchTables, FREQUENCIES, frequencyLabel, MAX_PAGE_BYTES, MAX_WATCHED, nextDue, PER_TICK, type WatchRow } from '../sync/webWatch';
import { auditStatement, canManageUsers } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

const OWNED = /^\/watch\//;
const ENTITY = 'web-watch';

/** What a watched page looks like in the log, so an undo can put it back exactly. */
type Kept = Pick<WatchRow, 'label' | 'url' | 'every_min' | 'paused' | 'deleted_at'>;
const kept = (r: WatchRow): Kept => ({ label: r.label, url: r.url, every_min: r.every_min, paused: r.paused, deleted_at: r.deleted_at });

const cleanLabel = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 120) : '');

function minutesOf(v: unknown): number {
  const f = FREQUENCIES.find((x) => x.key === v || x.minutes === Number(v));
  if (!f) throw badRequest('Choose how often to check.');
  return f.minutes;
}

async function rowOf(call: StaffCall, id: unknown): Promise<WatchRow> {
  const r = await call.env.CATALOG_DB.prepare('SELECT * FROM web_watch WHERE id = ?').bind(String(id ?? '')).first<WatchRow>();
  if (!r) throw notFound('That watched page does not exist.');
  return r;
}

async function liveCount(call: StaffCall, exceptId = ''): Promise<number> {
  const r = await call.env.CATALOG_DB.prepare('SELECT count(*) AS n FROM web_watch WHERE deleted_at IS NULL AND id != ?').bind(exceptId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

async function sameUrl(call: StaffCall, url: string, exceptId = ''): Promise<boolean> {
  return Boolean(await call.env.CATALOG_DB.prepare('SELECT 1 FROM web_watch WHERE deleted_at IS NULL AND url = ? AND id != ?').bind(url, exceptId).first());
}

function present(r: WatchRow, now: number) {
  return {
    id: r.id,
    label: r.label,
    url: r.url,
    everyMin: r.every_min,
    every: frequencyLabel(r.every_min),
    paused: Boolean(r.paused),
    lastCheckedAt: r.last_checked_at,
    lastChangedAt: r.last_changed_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    filesFound: r.files_found,
    nextCheckAt: r.paused ? null : new Date(Math.max(nextDue(r, now), now)).toISOString(),
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export async function watch(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route } = call;
  if (!OWNED.test(route)) return null;
  if (!canManageUsers(me)) throw new HttpError(403, 'unauthorized', 'Only owners and administrators can change watched websites.');
  await ensureWatchTables(env);

  if (request.method === 'GET') {
    if (route !== '/watch/list') return null;
    const now = Date.now();
    const rows = await env.CATALOG_DB.prepare('SELECT * FROM web_watch WHERE deleted_at IS NULL ORDER BY lower(label)').all<WatchRow>();
    const budget = new Budget(env);
    const day = new Date().toISOString().slice(0, 10);
    const usage = await env.CATALOG_DB.prepare('SELECT checks, rows_written FROM web_watch_usage WHERE day = ?').bind(day).first<{ checks: number; rows_written: number }>();
    return json({
      items: (rows.results ?? []).map((r) => present(r, now)),
      frequencies: FREQUENCIES.map((f) => ({ key: f.key, minutes: f.minutes, label: f.label })),
      limits: { maxWatched: MAX_WATCHED, perTick: PER_TICK, maxPageMb: MAX_PAGE_BYTES / 1024 / 1024, stopShare: BUDGET_STOP },
      budget: { day, usedToday: await budget.used(), limit: budget.limit, watchChecksToday: Number(usage?.checks ?? 0), watchRowsToday: Number(usage?.rows_written ?? 0) },
    });
  }

  const b = call.body ?? {};
  const now = new Date().toISOString();

  if (route === '/watch/add') {
    const label = cleanLabel(b.label);
    if (!label) throw badRequest('Give the page a label.');
    const checked = checkWatchUrl(b.url);
    if (!checked.ok) throw badRequest(checked.reason);
    const every = minutesOf(b.every);
    if ((await liveCount(call)) >= MAX_WATCHED) throw badRequest(`At most ${MAX_WATCHED} websites can be watched. Delete one first.`);
    if (await sameUrl(call, checked.url)) throw badRequest('That page is already watched.');
    const id = `w_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const row: Kept = { label, url: checked.url, every_min: every, paused: 0, deleted_at: null };
    await env.CATALOG_DB.batch([
      env.CATALOG_DB.prepare('INSERT INTO web_watch (id, label, url, every_min, paused, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)').bind(id, label, checked.url, every, now, me.name, now),
      auditStatement(env, me, { area: 'records', action: 'added', entity: ENTITY, entityId: id, summary: `Started watching "${label}" (${frequencyLabel(every).toLowerCase()})`, before: null, after: row }),
    ]);
    return json({ ok: true, id }, { status: 201 });
  }

  const r = await rowOf(call, b.id);
  if (r.deleted_at) throw notFound('That watched page was deleted.');

  if (route === '/watch/edit') {
    const label = cleanLabel(b.label) || r.label;
    const checked = b.url === undefined ? { ok: true as const, url: r.url } : checkWatchUrl(b.url);
    if (!checked.ok) throw badRequest(checked.reason);
    const every = b.every === undefined ? r.every_min : minutesOf(b.every);
    if (checked.url !== r.url && (await sameUrl(call, checked.url, r.id))) throw badRequest('That page is already watched.');
    const after: Kept = { ...kept(r), label, url: checked.url, every_min: every };
    // A new address starts fresh: no stored fingerprint, so the first check reads it in full.
    const moved = checked.url !== r.url;
    await env.CATALOG_DB.batch([
      env.CATALOG_DB.prepare(`UPDATE web_watch SET label = ?, url = ?, every_min = ?, updated_at = ?${moved ? ', etag = NULL, last_modified = NULL, sha256 = NULL, last_checked_at = NULL' : ''} WHERE id = ?`).bind(label, checked.url, every, now, r.id),
      auditStatement(env, me, { area: 'records', action: 'changed', entity: ENTITY, entityId: r.id, summary: `Changed the watched page "${label}"`, before: kept(r), after }),
    ]);
    return json({ ok: true });
  }

  if (route === '/watch/pause') {
    const paused = b.paused === true ? 1 : 0;
    await env.CATALOG_DB.batch([
      env.CATALOG_DB.prepare('UPDATE web_watch SET paused = ?, updated_at = ? WHERE id = ?').bind(paused, now, r.id),
      auditStatement(env, me, { area: 'records', action: paused ? 'paused' : 'resumed', entity: ENTITY, entityId: r.id, summary: `${paused ? 'Paused' : 'Resumed'} watching "${r.label}"`, before: kept(r), after: { ...kept(r), paused } }),
    ]);
    return json({ ok: true });
  }

  if (route === '/watch/delete') {
    await env.CATALOG_DB.batch([
      env.CATALOG_DB.prepare('UPDATE web_watch SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, r.id),
      auditStatement(env, me, { area: 'records', action: 'deleted', entity: ENTITY, entityId: r.id, summary: `Stopped watching "${r.label}"`, before: kept(r), after: { ...kept(r), deleted_at: now } }),
    ]);
    return json({ ok: true });
  }

  return null;
}

// Undo puts the watched page back as it was before the logged change (an add is undone by deleting it).
registerUndo(ENTITY, async (env, user, entry) => {
  if (!canManageUsers(user)) throw new HttpError(403, 'unauthorized', 'Only owners and administrators can change watched websites.');
  await ensureWatchTables(env);
  const id = String(entry.entity_id);
  const now = new Date().toISOString();
  const before = entry.before_json ? (JSON.parse(entry.before_json) as Kept | null) : null;
  const row = await env.CATALOG_DB.prepare('SELECT * FROM web_watch WHERE id = ?').bind(id).first<WatchRow>();
  if (!row) throw notFound('That watched page no longer exists.');
  if (!before) {
    await env.CATALOG_DB.prepare('UPDATE web_watch SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run();
    return `Stopped watching "${row.label}".`;
  }
  if (!before.deleted_at) {
    const live = await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM web_watch WHERE deleted_at IS NULL AND id != ?').bind(id).first<{ n: number }>();
    if (row.deleted_at && Number(live?.n ?? 0) >= MAX_WATCHED) throw badRequest(`At most ${MAX_WATCHED} websites can be watched. Delete one first.`);
  }
  await env.CATALOG_DB.prepare('UPDATE web_watch SET label = ?, url = ?, every_min = ?, paused = ?, deleted_at = ?, updated_at = ? WHERE id = ?')
    .bind(before.label, before.url, before.every_min, before.paused, before.deleted_at, now, id)
    .run();
  return `"${before.label}" is back as it was.`;
});
