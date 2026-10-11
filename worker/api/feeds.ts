/**
 * RSS feeds, no accounts:
 *   /feeds/records.xml   the 50 newest records by their date (resident submissions are left out: they are not city records)
 *   /feeds/meetings.xml  meetings in the next 60 days, with the agenda link once it is posted
 * Each is edge cached for 15 minutes, and each query reads only a few rows (indexed by date).
 */
import type { Env } from '../env';
import { API_SECURITY_HEADERS, notFound } from '../lib/http';
import { DOCUMENT_TYPE_LABELS } from '../lib/taxonomy';
import { rssDocument, type RssItem } from '../lib/rss';
import type { DocumentType } from '../../src/types/models';

const TTL_MINUTES = 15;
const CACHE_CONTROL = `public, max-age=${TTL_MINUTES * 60}`;
const SITE = 'Vineyard Transparency Portal';

const day = (offsetDays = 0, now = Date.now()) => new Date(now - 6 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
const typeLabel = (t: unknown) => DOCUMENT_TYPE_LABELS[String(t) as DocumentType] ?? 'Record';

type Row = Record<string, unknown>;

export function recordItems(rows: Row[], origin: string): RssItem[] {
  return rows
    .filter((r) => r.document_type !== 'resident_submission' && r.source_id !== 'resident-submitted')
    .map((r) => {
      const date = (r.document_date as string | null) ?? null;
      const type = typeLabel(r.document_type);
      const body = (r.government_body_name as string | null) ?? null;
      return {
        title: String(r.title ?? 'Untitled record'),
        link: `${origin}/documents/${encodeURIComponent(String(r.id))}`,
        description: `${[type, body, dayLabel(date)].filter(Boolean).join('. ')}.`,
        date,
        categories: [type, body],
      };
    });
}

export function meetingItems(rows: Row[], origin: string): RssItem[] {
  // The same meeting can come from two sources: one item per body, day and start time, keeping the one with an agenda.
  const seen = new Map<string, Row>();
  for (const r of rows) {
    const k = `${String(r.government_body_id ?? r.title)}|${String(r.meeting_date ?? '').slice(0, 10)}|${String(r.start_time ?? '')}`;
    const prev = seen.get(k);
    if (!prev || (!prev.agenda_id && r.agenda_id)) seen.set(k, r);
  }
  return [...seen.values()].map((r) => {
    const date = String(r.meeting_date ?? '').slice(0, 10);
    const canceled = /cancel/i.test(String(r.status ?? '')) || /\bcancel/i.test(String(r.title ?? ''));
    const page = `${origin}/meetings/${encodeURIComponent(String(r.id))}`;
    const agenda = r.agenda_id ? `${origin}/documents/${encodeURIComponent(String(r.agenda_id))}` : null;
    const when = [dayLabel(date), (r.start_time as string | null) ?? null].filter(Boolean).join(', ');
    const parts = [(r.government_body_name as string | null) ?? null, when, (r.location as string | null) ?? null, canceled ? 'Canceled' : agenda ? `Agenda: ${agenda}` : 'Agenda not posted yet'];
    const title = String(r.title ?? 'Meeting');
    return {
      title: canceled && !/cancel/i.test(title) ? `Canceled: ${title}` : title,
      link: page,
      description: `${parts.filter(Boolean).join('. ')}.`,
      date,
      categories: [(r.government_body_name as string | null) ?? null],
      // A new id once the agenda is posted, so readers show the item again with its agenda.
      ...(agenda ? { guid: `${page}#agenda` } : {}),
    };
  });
}

async function build(env: Env, which: 'records' | 'meetings', origin: string, self: string): Promise<string> {
  if (which === 'records') {
    const rows = await env.CATALOG_DB.prepare(
      `SELECT id, title, document_type, document_date, government_body_name, source_id FROM documents
       WHERE document_date IS NOT NULL AND document_date <= ? AND document_type != 'resident_submission' AND source_id != 'resident-submitted'
       ORDER BY document_date DESC LIMIT 50`,
    )
      .bind(day(1))
      .all<Row>();
    return rssDocument({
      title: `${SITE}: newest records`,
      link: `${origin}/records`,
      selfUrl: self,
      description: 'The 50 newest Vineyard, Utah public records in the archive, by record date. Resident submissions are not included.',
      ttl: TTL_MINUTES,
      items: recordItems(rows.results ?? [], origin),
    });
  }
  const rows = await env.CATALOG_DB.prepare(
    `SELECT m.id, m.title, m.government_body_id, m.government_body_name, m.meeting_date, m.start_time, m.location, m.status,
            coalesce(m.agenda_document_id, (SELECT d.id FROM documents d WHERE d.meeting_id = m.id AND d.document_type = 'agenda' LIMIT 1)) AS agenda_id
     FROM meetings m WHERE m.meeting_date >= ? AND m.meeting_date < ? ORDER BY m.meeting_date ASC, m.start_time ASC LIMIT 150`,
  )
    .bind(day(0), day(61))
    .all<Row>();
  return rssDocument({
    title: `${SITE}: upcoming meetings`,
    link: `${origin}/meetings`,
    selfUrl: self,
    description: 'Vineyard, Utah public meetings in the next 60 days, with the agenda link once it is posted.',
    ttl: TTL_MINUTES,
    items: meetingItems(rows.results ?? [], origin),
  });
}

export async function handleFeed(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '');
  const which = path === '/feeds/records.xml' ? 'records' : path === '/feeds/meetings.xml' ? 'meetings' : null;
  if (!which) throw notFound('Unknown feed.');
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${url.origin}${path}`, { method: 'GET' });
  const hit = await cache.match(key).catch(() => undefined);
  const res =
    hit ??
    new Response(await build(env, which, url.origin, `${url.origin}${path}`), {
      headers: { ...API_SECURITY_HEADERS, 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': CACHE_CONTROL, 'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-origin': '*' },
    });
  if (!hit) ctx.waitUntil(cache.put(key, res.clone()).catch(() => undefined));
  return request.method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
}
