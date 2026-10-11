/**
 * Utah Public Notice Website (utah.gov/pmn): Vineyard's notices. The site's search is a form post
 * with a session token; results list each notice (title, event time, public body, entity) and its
 * attached files. New notices are queued as records (the notice page holds the posted agenda text)
 * and their attachments as documents.
 */
import type { Env } from '../env';
import { Budget, upsertBodies, upsertMeetings, upsertQueue } from '../admin/routes';
import { bodyFor, classifyType } from '../lib/civicclerk';
import { SYNC_UA } from './ingest';
import { urlKey } from './urls';
import { assertRobots } from './robots';
import { parsePmnResults, PMN, type PmnNotice } from './pmnParse';

export { parsePmnResults, type PmnNotice };

export const PMN_SOURCE = 'utah-pmn-vineyard';
const ENTITY = 'Vineyard';
const sumChanges = (results: D1Result[]): number => results.reduce((t, r) => t + Number(r.meta?.rows_written ?? 0), 0);

function cookieHeader(res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (res.headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/);
  return list
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

export async function searchPmn(env: Env, sinceDays = 45): Promise<PmnNotice[]> {
  await assertRobots(env, `${PMN}/search.html`);
  const form = await fetch(`${PMN}/search.html`, { headers: { 'user-agent': SYNC_UA, accept: 'text/html' } });
  if (!form.ok) throw new Error(`PMN form HTTP ${form.status}`);
  const formHtml = await form.text();
  const csrf = /name="_csrf" value="([^"]+)"/.exec(formHtml)?.[1];
  if (!csrf) throw new Error('PMN form has no session token');
  const start = new Date(Date.now() - sinceDays * 86400_000).toISOString().slice(0, 10);
  const body = new URLSearchParams({ entityName: ENTITY, _csrf: csrf, startDate: start });
  const res = await fetch(`${PMN}/search.html`, {
    method: 'POST',
    headers: { 'user-agent': SYNC_UA, 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(form), referer: `${PMN}/search.html` },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`PMN search HTTP ${res.status}`);
  return parsePmnResults(await res.text()).filter((n) => n.entity.toLowerCase() === ENTITY.toLowerCase());
}

let registered = false;
async function registerSource(env: Env): Promise<void> {
  if (registered) return;
  const now = new Date().toISOString();
  await env.CATALOG_DB.prepare(
    `INSERT OR IGNORE INTO sources (id, name, base_url, source_type, authority, crawl_enabled, archive_enabled, document_discovery_enabled, description, notes, status, created_at, updated_at)
     VALUES (?, 'Utah Public Notice Website (Vineyard)', ?, 'public_notice_system', 'State of Utah', 1, 1, 1, ?, ?, 'unknown', ?, ?)`,
  )
    .bind(PMN_SOURCE, `${PMN}/`, 'Notices Vineyard posts to the statewide Public Notice Website: meetings, hearings, agendas and attachments.', 'Read every 15 minutes by the Worker (entity search: Vineyard).', now, now)
    .run();
  registered = true;
}

/** Finds new Vineyard notices and queues them (notice page + attachments). */
export async function syncPmn(env: Env, budget: Budget): Promise<Record<string, number>> {
  await registerSource(env);
  const now = new Date().toISOString();
  let notices: PmnNotice[];
  try {
    notices = await searchPmn(env);
  } catch (e) {
    await env.CATALOG_DB.prepare(`UPDATE sources SET status = 'unreachable', status_message = ?, last_checked_at = ? WHERE id = ?`).bind(String(e).slice(0, 300), now, PMN_SOURCE).run();
    throw e;
  }
  // Meetings: the agenda portal (CivicClerk) refuses Cloudflare's network, so the statewide notice
  // site is how the Worker learns of a meeting within minutes. A notice joins the meeting already on
  // file for that body and day; otherwise a meeting is recorded from the notice.
  const meetingFor = new Map<string, { id: string; hasAgenda: boolean; hasPacket: boolean }>();
  const newMeetings: Record<string, unknown>[] = [];
  const bodies = new Map<string, { id: string; name: string; kind: string }>();
  const today = now.slice(0, 10);
  for (const n of notices) {
    // Only meeting notices make meetings (hearing and other notices are records, not calendar entries).
    if (!n.eventDate || !n.publicBody || !/meeting|session|cancel/i.test(n.title)) continue;
    const body = bodyFor(n.publicBody);
    if (!body) continue;
    const found = await env.CATALOG_DB.prepare(
      `SELECT id, agenda_document_id, packet_document_id FROM meetings WHERE meeting_date = ? AND (government_body_id = ? OR lower(government_body_name) = lower(?))
       ORDER BY CASE WHEN id LIKE 'mtg_cc_%' THEN 0 ELSE 1 END LIMIT 1`,
    )
      .bind(n.eventDate, body.id, body.name)
      .first<{ id: string; agenda_document_id: string | null; packet_document_id: string | null }>();
    if (found) {
      // A notice for the day confirms a meeting the agenda portal listed only as an undated copy.
      await env.CATALOG_DB.prepare(`UPDATE meetings SET status = ? WHERE id = ? AND status = 'unconfirmed'`).bind(n.eventDate < today ? 'held' : 'scheduled', found.id).run();
      meetingFor.set(n.id, { id: found.id, hasAgenda: Boolean(found.agenda_document_id), hasPacket: Boolean(found.packet_document_id) });
      continue;
    }
    const id = `mtg_pmn_${n.id}`;
    bodies.set(body.id, body);
    newMeetings.push({
      id,
      slug: `${body.id}-${n.eventDate}-pmn-${n.id}`,
      title: n.title,
      governmentBodyId: body.id,
      governmentBodyName: body.name,
      meetingType: /special/i.test(n.title) ? 'special' : /work session/i.test(n.title) ? 'work_session' : 'regular',
      date: n.eventDate,
      startTime: n.eventTime,
      location: null,
      status: /cancel/i.test(n.title) ? 'cancelled' : n.eventDate < today ? 'held' : 'scheduled',
      sourceId: PMN_SOURCE,
      sourceUrl: n.url,
      externalId: `pmn:${n.id}`,
      media: [],
    });
    meetingFor.set(n.id, { id, hasAgenda: false, hasPacket: false });
  }
  if (bodies.size) await upsertBodies(env, { bodies: [...bodies.values()] }, budget);
  for (let i = 0; i < newMeetings.length; i += 100) await upsertMeetings(env, { meetings: newMeetings.slice(i, i + 100) }, budget);
  // A meeting recorded from a notice gives way to the agenda portal's record of it once that arrives.
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `UPDATE documents SET meeting_id = (SELECT m2.id FROM meetings m1 JOIN meetings m2 ON m2.meeting_date = m1.meeting_date AND m2.government_body_id = m1.government_body_id AND m2.id LIKE 'mtg_cc_%' WHERE m1.id = documents.meeting_id LIMIT 1)
       WHERE meeting_id LIKE 'mtg_pmn_%' AND EXISTS (SELECT 1 FROM meetings m1 JOIN meetings m2 ON m2.meeting_date = m1.meeting_date AND m2.government_body_id = m1.government_body_id AND m2.id LIKE 'mtg_cc_%' WHERE m1.id = documents.meeting_id)`,
    ),
    env.CATALOG_DB.prepare(
      `DELETE FROM meetings WHERE id LIKE 'mtg_pmn_%' AND EXISTS (SELECT 1 FROM meetings m2 WHERE m2.id LIKE 'mtg_cc_%' AND m2.meeting_date = meetings.meeting_date AND m2.government_body_id = meetings.government_body_id)`,
    ),
  ]);

  // Notices read before their meeting existed: attach the notice page and its files to the meeting,
  // and fill the meeting's agenda and packet links when nothing else supplied them.
  const links: D1PreparedStatement[] = [];
  for (const n of notices) {
    const mtg = meetingFor.get(n.id);
    if (!mtg) continue;
    const body = bodyFor(n.publicBody);
    const urls = JSON.stringify([n.url, ...n.attachments.map((f) => f.url)]);
    links.push(
      env.CATALOG_DB.prepare(`UPDATE documents SET meeting_id = ?, government_body_id = coalesce(government_body_id, ?) WHERE meeting_id IS NULL AND source_id = ? AND original_url IN (SELECT value FROM json_each(?))`).bind(
        mtg.id,
        body?.id ?? null,
        PMN_SOURCE,
        urls,
      ),
    );
    if (!mtg.hasAgenda)
      links.push(
        env.CATALOG_DB.prepare(`UPDATE meetings SET agenda_document_id = (SELECT id FROM documents WHERE source_id = ? AND original_url = ? LIMIT 1) WHERE id = ? AND agenda_document_id IS NULL`).bind(PMN_SOURCE, n.url, mtg.id),
      );
    const packet = n.attachments.find((f) => /packet/i.test(f.name));
    if (packet && !mtg.hasPacket)
      links.push(
        env.CATALOG_DB.prepare(`UPDATE meetings SET packet_document_id = (SELECT id FROM documents WHERE source_id = ? AND original_url = ? LIMIT 1) WHERE id = ? AND packet_document_id IS NULL`).bind(PMN_SOURCE, packet.url, mtg.id),
      );
  }
  if (links.length) await budget.record(sumChanges(await env.CATALOG_DB.batch(links)));

  const items: Record<string, unknown>[] = [];
  for (const n of notices) {
    const mtg = meetingFor.get(n.id);
    const base = { documentDate: n.eventDate, governmentBodyName: n.publicBody || null, governmentBodyId: bodyFor(n.publicBody)?.id ?? null, pmnNoticeId: n.id, meetingId: mtg?.id ?? null, meetingTitle: n.title };
    items.push({
      urlKey: await urlKey(n.url),
      sourceId: PMN_SOURCE,
      url: n.url,
      kind: 'document',
      priority: 15,
      parentUrl: `${PMN}/search.html`,
      // The notice holds the posted agenda; it becomes the meeting's agenda only when none is on file.
      metadata: { ...base, kind: 'web_page', title: `${n.title}${n.eventDate ? ` (public notice, ${n.eventDate})` : ' (public notice)'}`, documentType: 'public_notice', meetingRole: mtg && !mtg.hasAgenda ? 'agenda' : null },
      runId: 'worker',
    });
    for (const f of n.attachments) {
      items.push({
        urlKey: await urlKey(f.url),
        sourceId: PMN_SOURCE,
        url: f.url,
        kind: 'document',
        priority: 25,
        parentUrl: n.url,
        metadata: {
          ...base,
          title: f.name.replace(/\.pdf$/i, ''),
          linkText: f.name,
          fileName: f.name,
          documentType: classifyType(f.name) === 'other' ? 'public_notice' : classifyType(f.name),
          meetingRole: mtg && /packet/i.test(f.name) && !mtg.hasPacket ? 'packet' : null,
        },
        runId: 'worker',
      });
    }
  }
  let added = 0;
  if (items.length) {
    const known = await env.CATALOG_DB.prepare('SELECT url_key FROM crawl_queue WHERE url_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(items.map((i) => i.urlKey))).all<{ url_key: string }>();
    const have = new Set((known.results ?? []).map((r) => r.url_key));
    const fresh = items.filter((i) => !have.has(String(i.urlKey)));
    for (let i = 0; i < fresh.length; i += 400) await upsertQueue(env, { items: fresh.slice(i, i + 400) }, budget);
    added = fresh.length;
  }
  await env.CATALOG_DB.prepare(`UPDATE sources SET status = 'active', status_message = NULL, last_checked_at = ?, last_success_at = ? WHERE id = ?`).bind(now, now, PMN_SOURCE).run();
  return { notices: notices.length, queued: added };
}
