/**
 * GET /api/latest : what is new around Vineyard, in one call.
 *   - upcoming: the next public meetings, with whether an agenda is posted
 *   - posted:   agendas, packets, minutes and other records posted recently
 *   - sheriff:  Utah County Sheriff's Office releases that mention Vineyard
 *   - updatedAt: when the hourly check last ran
 * City community events come from /api/events, which the page loads alongside.
 */
import type { Env } from '../env';
import { json } from '../lib/http';
import { ensureNewsTables } from '../lib/news';

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));

function denverToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function shiftDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function getLatest(env: Env): Promise<Response> {
  await ensureNewsTables(env);
  const today = denverToday();
  const db = env.CATALOG_DB;
  const [upcoming, posted, sheriff, cron] = await Promise.all([
    db
      .prepare(
        `SELECT id, slug, title, government_body_name, meeting_date, start_time, location, status, agenda_document_id, packet_document_id
         FROM meetings WHERE meeting_date >= ? AND meeting_date <= ? AND status != 'cancelled' ORDER BY meeting_date, start_time LIMIT 8`,
      )
      .bind(today, shiftDays(today, 21))
      .all<Row>(),
    db
      .prepare(
        `SELECT d.id, d.title, d.document_type, d.document_date, d.page_count, d.government_body_name, d.meeting_id, d.source_id, d.first_seen_at,
                m.title AS meeting_title, m.meeting_date
         FROM documents d LEFT JOIN meetings m ON m.id = d.meeting_id
         WHERE d.source_id NOT IN ('vineyard-gis', 'ucso-press-releases') AND d.mime_type NOT LIKE 'text/html%'
           AND coalesce(d.currency, '') <> 'current' AND d.mime_type NOT LIKE 'text/plain%'
           -- Only records the city dated in the last 45 days (or upcoming), never old files just indexed.
           AND d.document_date >= ? AND d.document_date <= ?
         ORDER BY d.document_date DESC, d.first_seen_at DESC LIMIT 24`,
      )
      .bind(shiftDays(today, -45), shiftDays(today, 60))
      .all<Row>(),
    db.prepare(`SELECT id, title, url, published_at, summary FROM news_items WHERE source = 'ucso-press-releases' AND mentions_vineyard = 1 ORDER BY published_at DESC LIMIT 8`).all<Row>(),
    db.prepare('SELECT finished_at FROM cron_runs ORDER BY id DESC LIMIT 1').first<Row>(),
  ]);

  return json(
    {
      today,
      upcoming: (upcoming.results ?? []).map((m) => ({
        id: String(m.id),
        slug: str(m.slug),
        title: String(m.title),
        body: str(m.government_body_name),
        date: str(m.meeting_date),
        time: str(m.start_time),
        location: str(m.location),
        agendaPosted: Boolean(m.agenda_document_id || m.packet_document_id),
      })),
      posted: (posted.results ?? []).map((d) => ({
        id: String(d.id),
        title: String(d.title),
        type: String(d.document_type ?? 'other'),
        date: str(d.document_date),
        pages: d.page_count == null ? null : Number(d.page_count),
        body: str(d.government_body_name),
        meetingId: str(d.meeting_id),
        meetingTitle: str(d.meeting_title),
        source: String(d.source_id),
      })),
      sheriff: (sheriff.results ?? []).map((n) => ({ id: String(n.id), title: String(n.title), url: String(n.url), date: str(n.published_at), summary: str(n.summary) })),
      follow: [
        { name: 'Vineyard City', handle: 'VineyardCity', url: 'https://www.facebook.com/VineyardCity/' },
        { name: "Utah County Sheriff's Office, Vineyard", handle: 'VineyardUCSO', url: 'https://www.facebook.com/VineyardUCSO' },
      ],
      updatedAt: str(cron?.finished_at),
    },
    { headers: { 'cache-control': 'public, max-age=300' } },
  );
}
