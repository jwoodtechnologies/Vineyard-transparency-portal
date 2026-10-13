/**
 * Notices for the staff portal: a short message at the top of every public page (an office closure, a road
 * closure, a change to a meeting), with an optional link, optional first and last days, and a switch to hide it
 * without deleting it. Every change is logged, can be undone, and shows on the portal right away.
 */
import type { Env } from '../env';
import { badRequest, json, notFound } from '../lib/http';
import { plainLine, plainText, stripTags, webUrl } from '../lib/contrib';
import { utahToday } from '../lib/coverage';
import { isIsoDate, nowIso } from '../lib/util';
import { ensureNoticeTable, NOTICE_KINDS, type NoticeRow } from '../api/notices';
import { readPlace, type Place } from '../lib/mapShape';
import { auditStatement, published, requireArea, type StaffUser } from './core';
import type { StaffCall } from './modules';
import { registerUndo } from './undo';

const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const MESSAGE_MAX = 280;

interface Fields {
  tone: 'info' | 'alert';
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  startsOn: string | null;
  endsOn: string | null;
  shown: boolean;
  onBar: boolean;
  /** Set when the notice is also drawn on the map. */
  place: { title: string; kind: string; geometry: Place } | null;
}

function date(v: unknown, what: string): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  if (!isIsoDate(s)) throw badRequest(`Choose the ${what} from the calendar.`);
  return s;
}

function readPlaceFields(v: unknown): Fields['place'] {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  const geometry = readPlace(p.geometry);
  if (typeof geometry === 'string') throw badRequest(geometry);
  const title = stripTags(plainLine(p.title, 80));
  if (!title) throw badRequest('Name the place, such as "Main Street closed".');
  const kind = NOTICE_KINDS.find((k) => k.key === p.kind)?.key ?? 'other';
  return { title, kind, geometry };
}

function readFields(b: Record<string, unknown>): Fields {
  const message = stripTags(plainText(b.message, MESSAGE_MAX + 50).replace(/\s+/g, ' '));
  if (!message) throw badRequest('Write the notice.');
  if (message.length > MESSAGE_MAX) throw badRequest(`Keep the notice under ${MESSAGE_MAX} characters.`);
  const rawLink = typeof b.linkUrl === 'string' ? b.linkUrl.trim() : '';
  const linkUrl = rawLink ? webUrl(rawLink.includes('://') ? rawLink : `https://${rawLink}`) : null;
  if (rawLink && !linkUrl) throw badRequest('That web address does not look right.');
  const startsOn = date(b.startsOn, 'first day');
  const endsOn = date(b.endsOn, 'last day');
  if (startsOn && endsOn && endsOn < startsOn) throw badRequest('The last day is before the first day.');
  const place = readPlaceFields(b.place);
  const onBar = b.onBar !== false;
  if (!onBar && !place) throw badRequest('Choose where the notice shows: the top of every page, the map, or both.');
  return {
    tone: b.tone === 'alert' ? 'alert' : 'info',
    message,
    linkUrl,
    linkLabel: linkUrl ? stripTags(plainLine(b.linkLabel, 40)) || 'Learn more' : null,
    startsOn,
    endsOn,
    shown: b.shown !== false,
    onBar,
    place,
  };
}

async function noticeRow(env: Env, id: unknown): Promise<NoticeRow> {
  await ensureNoticeTable(env);
  const row = await env.CATALOG_DB.prepare('SELECT * FROM site_notices WHERE id = ?')
    .bind(String(id ?? '').slice(0, 40))
    .first<NoticeRow>();
  if (!row) throw notFound('That notice was not found.');
  return row;
}

const label = (r: Pick<NoticeRow, 'message'>) => `"${r.message.length > 60 ? `${r.message.slice(0, 57)}...` : r.message}"`;

export function statusOf(r: Pick<NoticeRow, 'shown' | 'starts_on' | 'ends_on'>, today: string): 'hidden' | 'scheduled' | 'ended' | 'showing' {
  if (!r.shown) return 'hidden';
  if (r.starts_on && r.starts_on > today) return 'scheduled';
  if (r.ends_on && r.ends_on < today) return 'ended';
  return 'showing';
}

/** The notice's place as the staff screen holds it, or null when it is not on the map. */
function placeOf(n: Pick<NoticeRow, 'place_title' | 'place_kind' | 'place_geometry'>): { title: string; kind: string; geometry: unknown } | null {
  if (!n.place_geometry) return null;
  try {
    return { title: n.place_title ?? '', kind: n.place_kind ?? 'other', geometry: JSON.parse(n.place_geometry) as unknown };
  } catch {
    return null;
  }
}

const columns = (r: NoticeRow) => [
  r.id,
  r.tone,
  r.message,
  r.link_url,
  r.link_label,
  r.starts_on,
  r.ends_on,
  r.shown,
  r.on_bar,
  r.place_title,
  r.place_kind,
  r.place_geometry,
  r.created_at,
  r.created_by,
  r.updated_at,
  r.updated_by,
];
const INSERT =
  'INSERT INTO site_notices (id, tone, message, link_url, link_label, starts_on, ends_on, shown, on_bar, place_title, place_kind, place_geometry, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

async function list(env: Env): Promise<Record<string, unknown>> {
  await ensureNoticeTable(env);
  const today = utahToday();
  const r = await env.CATALOG_DB.prepare('SELECT * FROM site_notices ORDER BY created_at DESC LIMIT 100').all<NoticeRow>();
  return {
    today,
    kinds: NOTICE_KINDS,
    items: (r.results ?? []).map((n) => ({
      id: n.id,
      tone: n.tone,
      message: n.message,
      linkUrl: n.link_url,
      linkLabel: n.link_label,
      startsOn: n.starts_on,
      endsOn: n.ends_on,
      shown: Number(n.shown) === 1,
      onBar: Number(n.on_bar) === 1,
      place: placeOf(n),
      status: statusOf(n, today),
      createdAt: n.created_at,
      createdBy: n.created_by,
      updatedAt: n.updated_at,
      updatedBy: n.updated_by,
    })),
  };
}

async function add(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureNoticeTable(env);
  const f = readFields(b);
  const now = nowIso();
  const row: NoticeRow = {
    id: `ntc_${randomHex(6)}`,
    tone: f.tone,
    message: f.message,
    link_url: f.linkUrl,
    link_label: f.linkLabel,
    starts_on: f.startsOn,
    ends_on: f.endsOn,
    shown: f.shown ? 1 : 0,
    on_bar: f.onBar ? 1 : 0,
    place_title: f.place?.title ?? null,
    place_kind: f.place?.kind ?? null,
    place_geometry: f.place ? JSON.stringify(f.place.geometry) : null,
    created_at: now,
    created_by: me.name,
    updated_at: now,
    updated_by: me.name,
  };
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(INSERT).bind(...columns(row)),
    auditStatement(env, me, { area: 'notices', action: 'added', entity: 'notice', entityId: row.id, summary: `Posted the notice ${label(row)}`, after: row }),
  ]);
  await published(env);
  return { ok: true, id: row.id };
}

async function edit(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = await noticeRow(env, b.id);
  const f = readFields(b);
  const now = nowIso();
  const after: NoticeRow = {
    ...before,
    tone: f.tone,
    message: f.message,
    link_url: f.linkUrl,
    link_label: f.linkLabel,
    starts_on: f.startsOn,
    ends_on: f.endsOn,
    shown: f.shown ? 1 : 0,
    on_bar: f.onBar ? 1 : 0,
    place_title: f.place?.title ?? null,
    place_kind: f.place?.kind ?? null,
    place_geometry: f.place ? JSON.stringify(f.place.geometry) : null,
    updated_at: now,
    updated_by: me.name,
  };
  const hiding = Number(before.shown) === 1 && !f.shown;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      'UPDATE site_notices SET tone = ?, message = ?, link_url = ?, link_label = ?, starts_on = ?, ends_on = ?, shown = ?, on_bar = ?, place_title = ?, place_kind = ?, place_geometry = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    ).bind(
      after.tone,
      after.message,
      after.link_url,
      after.link_label,
      after.starts_on,
      after.ends_on,
      after.shown,
      after.on_bar,
      after.place_title,
      after.place_kind,
      after.place_geometry,
      now,
      me.name,
      before.id,
    ),
    auditStatement(env, me, { area: 'notices', action: 'edited', entity: 'notice', entityId: before.id, summary: `${hiding ? 'Hid' : 'Changed'} the notice ${label(after)}`, before, after }),
  ]);
  await published(env);
  return { ok: true };
}

async function remove(env: Env, me: StaffUser, b: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = await noticeRow(env, b.id);
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM site_notices WHERE id = ?').bind(before.id),
    auditStatement(env, me, { area: 'notices', action: 'removed', entity: 'notice', entityId: before.id, summary: `Removed the notice ${label(before)}`, before }),
  ]);
  await published(env);
  return { ok: true };
}

export async function notices(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route, body } = call;
  if (!route.startsWith('/notices/')) return null;
  requireArea(me, 'notices');
  if (request.method === 'GET') return route === '/notices/list' ? json(await list(env)) : null;
  const b = body ?? {};
  if (route === '/notices/add') return json(await add(env, me, b), { status: 201 });
  if (route === '/notices/edit') return json(await edit(env, me, b));
  if (route === '/notices/remove') return json(await remove(env, me, b));
  return null;
}

/** Undo: a posted notice is taken down, a change or a removal is put back as it was. */
registerUndo('notice', async (env, _user, entry) => {
  await ensureNoticeTable(env);
  const id = entry.entity_id ?? '';
  if (entry.action === 'added') {
    const row = await noticeRow(env, id);
    await env.CATALOG_DB.prepare('DELETE FROM site_notices WHERE id = ?').bind(id).run();
    return `Took down the notice ${label(row)}`;
  }
  const before = entry.before_json ? (JSON.parse(entry.before_json) as NoticeRow) : null;
  if (!before?.id) throw badRequest('The earlier version was not kept.');
  await env.CATALOG_DB.batch([env.CATALOG_DB.prepare('DELETE FROM site_notices WHERE id = ?').bind(before.id), env.CATALOG_DB.prepare(INSERT).bind(...columns(before))]);
  return `Put back the notice ${label(before)}`;
});
