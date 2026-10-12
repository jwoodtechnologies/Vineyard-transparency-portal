/**
 * Events for the staff portal: add a community event, a special meeting or a closure day to the portal's
 * calendar, change it, or take it down. They show on the calendar next to the city's own events at once.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { plainLine, plainText, stripTags, webUrl } from '../lib/contrib';
import { utahToday } from '../lib/coverage';
import { isIsoDate, nowIso } from '../lib/util';
import { EVENT_CATEGORIES, ensureEventTable, type SiteEventRow } from '../api/siteEvents';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

interface Fields {
  title: string;
  startDate: string;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
  category: string;
}

function time(v: unknown, what: string): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (!TIME.test(s)) throw badRequest(`Choose the ${what} time.`);
  return s;
}

function readFields(b: Record<string, unknown>): Fields {
  const title = stripTags(plainLine(b.title, 120));
  if (!title) throw badRequest('Write the name of the event.');
  const startDate = typeof b.date === 'string' ? b.date.trim() : '';
  if (!isIsoDate(startDate)) throw badRequest('Choose the date.');
  const allDay = b.allDay === true;
  const startTime = allDay ? null : time(b.startTime, 'start');
  const endTime = allDay || !startTime ? null : time(b.endTime, 'end');
  const rawEnd = typeof b.endDate === 'string' ? b.endDate.trim() : '';
  if (rawEnd && !isIsoDate(rawEnd)) throw badRequest('Choose the last day from the calendar.');
  const endDate = rawEnd && rawEnd !== startDate ? rawEnd : null;
  if (endDate && endDate < startDate) throw badRequest('The last day is before the first day.');
  if (startTime && endTime && !endDate && endTime < startTime) throw badRequest('The end time is before the start time.');
  const rawUrl = typeof b.url === 'string' ? b.url.trim() : '';
  const url = rawUrl ? webUrl(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`) : null;
  if (rawUrl && !url) throw badRequest('That web address does not look right.');
  const category = EVENT_CATEGORIES.find((c) => c.key === b.category)?.key ?? 'Community';
  return { title, startDate, startTime, endDate, endTime, location: stripTags(plainLine(b.location, 150)) || null, description: stripTags(plainText(b.description, 1000)) || null, url, category };
}

async function eventRow(env: Env, id: unknown): Promise<SiteEventRow> {
  await ensureEventTable(env);
  const row = await env.CATALOG_DB.prepare('SELECT * FROM site_events WHERE id = ?')
    .bind(String(id ?? '').slice(0, 40))
    .first<SiteEventRow>();
  if (!row) throw notFound('That event was not found.');
  return row;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 21, 2026" from "2026-10-21". */
const plainDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const label = (r: Pick<SiteEventRow, 'title' | 'start_date'>) => `${r.title} on ${plainDay(r.start_date)}`;

async function list(env: Env): Promise<Record<string, unknown>> {
  await ensureEventTable(env);
  const today = utahToday();
  const r = await env.CATALOG_DB.prepare("SELECT * FROM site_events ORDER BY start_date DESC, coalesce(start_time, '') DESC LIMIT 300").all<SiteEventRow>();
  const items = (r.results ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    date: e.start_date,
    startTime: e.start_time,
    endDate: e.end_date,
    endTime: e.end_time,
    allDay: !e.start_time,
    location: e.location,
    description: e.description,
    url: e.url,
    category: e.category,
    past: (e.end_date ?? e.start_date) < today,
    createdBy: e.created_by,
    updatedAt: e.updated_at,
  }));
  return { today, items, categories: EVENT_CATEGORIES };
}

const columns = (r: SiteEventRow) => [
  r.id,
  r.title,
  r.start_date,
  r.start_time,
  r.end_date,
  r.end_time,
  r.location,
  r.description,
  r.url,
  r.category,
  r.created_at,
  r.created_by,
  r.updated_at,
  r.updated_by,
];
const INSERT =
  'INSERT INTO site_events (id, title, start_date, start_time, end_date, end_time, location, description, url, category, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

async function add(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureEventTable(env);
  const f = readFields(b);
  const now = nowIso();
  const row: SiteEventRow = {
    id: `evt_${randomHex(6)}`,
    title: f.title,
    start_date: f.startDate,
    start_time: f.startTime,
    end_date: f.endDate,
    end_time: f.endTime,
    location: f.location,
    description: f.description,
    url: f.url,
    category: f.category,
    created_at: now,
    created_by: me.name,
    updated_at: now,
    updated_by: me.name,
  };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(INSERT).bind(...columns(row)),
    auditStatement(env, me, { area: 'notices', action: 'added', entity: 'event', entityId: row.id, summary: `Added the event ${label(row)}`, after: row }),
  ]);
  await published(env);
  return { ok: true, id: row.id };
}

async function edit(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = await eventRow(env, b.id);
  const f = readFields(b);
  const now = nowIso();
  const after: SiteEventRow = {
    ...before,
    title: f.title,
    start_date: f.startDate,
    start_time: f.startTime,
    end_date: f.endDate,
    end_time: f.endTime,
    location: f.location,
    description: f.description,
    url: f.url,
    category: f.category,
    updated_at: now,
    updated_by: me.name,
  };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      'UPDATE site_events SET title = ?, start_date = ?, start_time = ?, end_date = ?, end_time = ?, location = ?, description = ?, url = ?, category = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    ).bind(after.title, after.start_date, after.start_time, after.end_date, after.end_time, after.location, after.description, after.url, after.category, now, me.name, before.id),
    auditStatement(env, me, { area: 'notices', action: 'edited', entity: 'event', entityId: before.id, summary: `Changed the event ${label(after)}`, before, after }),
  ]);
  await published(env);
  return { ok: true };
}

async function remove(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = await eventRow(env, b.id);
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM site_events WHERE id = ?').bind(before.id),
    auditStatement(env, me, { area: 'notices', action: 'removed', entity: 'event', entityId: before.id, summary: `Removed the event ${label(before)}`, before }),
  ]);
  await published(env);
  return { ok: true };
}

export async function events(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route, body } = call;
  if (!route.startsWith('/events/')) return null;
  requireArea(me, 'notices');
  if (request.method === 'GET') return route === '/events/list' ? json(await list(env)) : null;
  const b = body ?? {};
  if (route === '/events/add') return json(await add(env, me, b), { status: 201 });
  if (route === '/events/edit') return json(await edit(env, me, b));
  if (route === '/events/remove') return json(await remove(env, me, b));
  return null;
}

/** Undo: an added event is taken down, a change or a removal is put back as it was. */
registerUndo('event', async (env, _user, entry) => {
  await ensureEventTable(env);
  const id = entry.entity_id ?? '';
  if (entry.action === 'added') {
    const row = await eventRow(env, id);
    await env.CATALOG_DB.prepare('DELETE FROM site_events WHERE id = ?').bind(id).run();
    return `Took down the event ${label(row)}`;
  }
  const before = entry.before_json ? (JSON.parse(entry.before_json) as SiteEventRow) : null;
  if (!before?.id) throw badRequest('The earlier version was not kept.');
  await env.CATALOG_DB.batch([env.CATALOG_DB.prepare('DELETE FROM site_events WHERE id = ?').bind(before.id), env.CATALOG_DB.prepare(INSERT).bind(...columns(before))]);
  return `Put back the event ${label(before)}`;
});
