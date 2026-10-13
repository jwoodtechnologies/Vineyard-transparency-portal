/**
 * Notices: a short message shown at the top of every page of the portal (an office closure, a road
 * closure, a change to a meeting). Staff write them in the staff portal (worker/staff/notices.ts); this
 * file holds the table and the public list.
 *
 *   GET /api/notices   the notices showing today, newest first
 */
import type { Env } from '../env';
import { json } from '../lib/http';
import { utahToday } from '../lib/coverage';

export type NoticeTone = 'info' | 'alert';

export interface NoticeRow {
  id: string;
  tone: NoticeTone;
  message: string;
  link_url: string | null;
  link_label: string | null;
  starts_on: string | null;
  ends_on: string | null;
  shown: number;
  /** 1 when the notice shows in the bar at the top of every page. */
  on_bar: number;
  /** Set when the notice is also drawn on the map: a short name, a kind (see NOTICE_KINDS), and the shape as GeoJSON text. */
  place_title: string | null;
  place_kind: string | null;
  place_geometry: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** What a notice on the map is: the words staff choose from and the word the map shows. */
export const NOTICE_KINDS: Array<{ key: string; label: string }> = [
  { key: 'closure', label: 'Road closure' },
  { key: 'detour', label: 'Detour' },
  { key: 'work', label: 'Construction' },
  { key: 'event', label: 'Event' },
  { key: 'other', label: 'Notice' },
];

let ready: Promise<void> | null = null;
export function ensureNoticeTable(env: Env): Promise<void> {
  ready ??= (async () => {
    await env.CATALOG_DB.prepare(
      `CREATE TABLE IF NOT EXISTS site_notices (
         id TEXT PRIMARY KEY, tone TEXT NOT NULL, message TEXT NOT NULL, link_url TEXT, link_label TEXT, starts_on TEXT, ends_on TEXT,
         shown INTEGER NOT NULL DEFAULT 1, on_bar INTEGER NOT NULL DEFAULT 1, place_title TEXT, place_kind TEXT, place_geometry TEXT,
         created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT)`,
    ).run();
    // A table made before notices could go on the map lacks these columns; adding one that is already there is harmless.
    for (const col of ['on_bar INTEGER NOT NULL DEFAULT 1', 'place_title TEXT', 'place_kind TEXT', 'place_geometry TEXT']) {
      await env.CATALOG_DB.prepare(`ALTER TABLE site_notices ADD COLUMN ${col}`)
        .run()
        .catch(() => undefined);
    }
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** Showing now: turned on, started (or no start date), and not past its last day (or no end date). */
export const SHOWING_SQL = 'shown = 1 AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)';

export async function publicNotices(env: Env): Promise<Response> {
  let items: Array<{ id: string; tone: string; message: string; link_url: string | null; link_label: string | null; updated_at: string }> = [];
  try {
    await ensureNoticeTable(env);
    const today = utahToday();
    const r = await env.CATALOG_DB.prepare(
      `SELECT id, tone, message, link_url, link_label, updated_at FROM site_notices WHERE on_bar = 1 AND ${SHOWING_SQL} ORDER BY CASE tone WHEN 'alert' THEN 0 ELSE 1 END, created_at DESC LIMIT 3`,
    )
      .bind(today, today)
      .all<{ id: string; tone: string; message: string; link_url: string | null; link_label: string | null; updated_at: string }>();
    items = r.results ?? [];
  } catch {
    // No table or no database yet means nothing to show.
  }
  return json(
    { items: items.map((n) => ({ id: n.id, tone: n.tone === 'alert' ? 'alert' : 'info', message: n.message, linkUrl: n.link_url, linkLabel: n.link_label, updatedAt: n.updated_at })) },
    { cache: 'public, max-age=60' },
  );
}
