/**
 * Editable site wording for the staff portal (worker/lib/siteContent.ts). One set of routes serves every kind of piece:
 * what it is called is the `key`, who may change it comes from its spec, and each save is checked, logged, undoable and
 * live right away. A save carries the `updatedAt` the screen loaded, so two people saving the same piece at once never
 * overwrite each other: the second is told to reload first.
 */
import type { Env } from '../env';
import { HttpError, json, badRequest } from '../lib/http';
import { nowIso } from '../lib/util';
import { ensureContentTable, readContent, specFor, type ContentSpec } from '../lib/siteContent';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

function specOf(me: StaffUser, key: unknown): { key: string; spec: ContentSpec } {
  const spec = specFor(key);
  if (!spec || typeof key !== 'string') throw badRequest('That page content is not editable here.');
  requireArea(me, spec.area);
  return { key, spec };
}

const baseOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function conflict(): HttpError {
  return new HttpError(409, 'bad_request', 'Someone else saved a change a moment ago. Reload this page to see it, then make your change again.');
}

async function save(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { key, spec } = specOf(me, b.key);
  await ensureContentTable(env);
  const value = spec.check(b.value);
  const before = await readContent(env, key);
  if ((before?.updatedAt ?? null) !== baseOf(b.base)) throw conflict();
  const now = nowIso();
  const summary = spec.summarize(before?.value ?? null, value);
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      'INSERT INTO site_content (key, body, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    ).bind(key, JSON.stringify(value), now, me.name),
    auditStatement(env, me, { area: spec.area, action: 'saved', entity: 'content', entityId: key, summary, before: before?.value ?? null, after: value }),
  ]);
  await published(env);
  return { ok: true, value, updatedAt: now, summary };
}

async function reset(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { key, spec } = specOf(me, b.key);
  await ensureContentTable(env);
  const before = await readContent(env, key);
  if ((before?.updatedAt ?? null) !== baseOf(b.base)) throw conflict();
  if (!before) return { ok: true, value: null, updatedAt: null };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM site_content WHERE key = ?').bind(key),
    auditStatement(env, me, { area: spec.area, action: 'reset', entity: 'content', entityId: key, summary: `Put back the original wording for ${spec.label.toLowerCase()}`, before: before.value }),
  ]);
  await published(env);
  return { ok: true, value: null, updatedAt: null };
}

export async function content(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route, body, url } = call;
  if (!route.startsWith('/content/')) return null;
  if (request.method === 'GET') {
    if (route !== '/content/get') return null;
    const { key } = specOf(me, url.searchParams.get('key'));
    const stored = await readContent(env, key);
    return json({ key, value: stored?.value ?? null, updatedAt: stored?.updatedAt ?? null, updatedBy: stored?.updatedBy ?? null });
  }
  const b = body ?? {};
  if (route === '/content/save') return json(await save(env, me, b));
  if (route === '/content/reset') return json(await reset(env, me, b));
  return null;
}

/**
 * Undo: the piece goes back to what it held before the logged change (or back to the original wording, when it held nothing).
 * Only the newest change to a piece can be undone: if it was saved again since, the earlier saves must be undone first, so an
 * undo never throws away somebody else's later work.
 */
registerUndo('content', async (env, user, entry) => {
  const key = entry.entity_id ?? '';
  const spec = specFor(key);
  if (!spec) throw badRequest('That page content is no longer editable.');
  await ensureContentTable(env);
  const now = await readContent(env, key);
  const nowJson = now ? JSON.stringify(now.value) : null;
  const afterJson = entry.after_json ? JSON.stringify(spec.check(JSON.parse(entry.after_json), true)) : null;
  if (nowJson !== afterJson) throw badRequest('This was changed again after that save. Undo the newer changes first.');
  if (entry.before_json) {
    const value = spec.check(JSON.parse(entry.before_json), true);
    await env.CATALOG_DB.prepare(
      'INSERT INTO site_content (key, body, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    )
      .bind(key, JSON.stringify(value), nowIso(), user.name)
      .run();
    return `Put back the earlier ${spec.label.toLowerCase()}`;
  }
  await env.CATALOG_DB.prepare('DELETE FROM site_content WHERE key = ?').bind(key).run();
  return `Put back the original wording for ${spec.label.toLowerCase()}`;
});
