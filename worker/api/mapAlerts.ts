/**
 * Notices staff place on the map (a road closure, a detour, a work zone, an event): the "Closures and notices"
 * layer. They are the notices of the staff portal (worker/staff/notices.ts) that have a place, shown only while
 * they are showing, and drawn next to the city's own GIS layers.
 *
 *   GET /api/map/layers/alerts   GeoJSON, one feature per notice
 */
import type { Env } from '../env';
import { json } from '../lib/http';
import { utahToday } from '../lib/coverage';
import { ensureNoticeTable, NOTICE_KINDS, SHOWING_SQL, type NoticeRow } from './notices';

export const ALERTS_KEY = 'alerts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Oct 14, 2026" from "2026-10-14". */
const plainDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

type Row = Pick<NoticeRow, 'id' | 'message' | 'link_url' | 'starts_on' | 'ends_on' | 'place_title' | 'place_kind' | 'place_geometry'>;

async function rows(env: Env): Promise<Row[]> {
  try {
    await ensureNoticeTable(env);
    const today = utahToday();
    const r = await env.CATALOG_DB.prepare(
      `SELECT id, message, link_url, starts_on, ends_on, place_title, place_kind, place_geometry FROM site_notices
       WHERE place_geometry IS NOT NULL AND ${SHOWING_SQL} ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(today, today)
      .all<Row>();
    return r.results ?? [];
  } catch {
    // No table or no database yet means nothing on the map.
    return [];
  }
}

/** True when at least one notice is on the map now (the layer is listed only then). */
export async function hasMapNotices(env: Env): Promise<boolean> {
  return (await rows(env)).length > 0;
}

export async function alertsLayer(env: Env): Promise<Response> {
  const features = (await rows(env)).flatMap((n) => {
    let geometry: unknown;
    try {
      geometry = JSON.parse(n.place_geometry ?? '');
    } catch {
      return [];
    }
    const kind = NOTICE_KINDS.find((k) => k.key === n.place_kind) ?? NOTICE_KINDS[NOTICE_KINDS.length - 1];
    const when =
      n.starts_on && n.ends_on
        ? n.starts_on === n.ends_on
          ? plainDay(n.starts_on)
          : `${plainDay(n.starts_on)} to ${plainDay(n.ends_on)}`
        : n.starts_on
          ? `From ${plainDay(n.starts_on)}`
          : n.ends_on
            ? `Until ${plainDay(n.ends_on)}`
            : null;
    return [
      {
        type: 'Feature',
        id: n.id,
        geometry,
        properties: { Title: n.place_title || n.message.slice(0, 60), Type: kind.label, Details: n.message, When: when, More: n.link_url },
      },
    ];
  });
  // A short browser copy: a closure staff just posted should be on the map for the next visitor, not in an hour.
  return json({ type: 'FeatureCollection', features }, { cache: 'public, max-age=60', headers: { 'content-type': 'application/geo+json; charset=utf-8' } });
}
