/**
 * Utah Public Notice Website (utah.gov/pmn): Vineyard's notices. The site's search is a form post
 * with a session token; results list each notice (title, event time, public body, entity) and its
 * attached files. New notices are queued as records (the notice page holds the posted agenda text)
 * and their attachments as documents.
 */
import type { Env } from '../env';
import { Budget, upsertQueue } from '../admin/routes';
import { classifyType } from '../lib/civicclerk';
import { SYNC_UA } from './ingest';
import { urlKey } from './urls';
import { parsePmnResults, PMN, type PmnNotice } from './pmnParse';

export { parsePmnResults, type PmnNotice };

export const PMN_SOURCE = 'utah-pmn-vineyard';
const ENTITY = 'Vineyard';

function cookieHeader(res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (res.headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/);
  return list
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

export async function searchPmn(sinceDays = 45): Promise<PmnNotice[]> {
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
    notices = await searchPmn();
  } catch (e) {
    await env.CATALOG_DB.prepare(`UPDATE sources SET status = 'unreachable', status_message = ?, last_checked_at = ? WHERE id = ?`).bind(String(e).slice(0, 300), now, PMN_SOURCE).run();
    throw e;
  }
  const items: Record<string, unknown>[] = [];
  for (const n of notices) {
    const base = { documentDate: n.eventDate, governmentBodyName: n.publicBody || null, pmnNoticeId: n.id };
    items.push({
      urlKey: await urlKey(n.url),
      sourceId: PMN_SOURCE,
      url: n.url,
      kind: 'document',
      priority: 15,
      parentUrl: `${PMN}/search.html`,
      metadata: { ...base, kind: 'web_page', title: `${n.title}${n.eventDate ? ` (public notice, ${n.eventDate})` : ' (public notice)'}`, documentType: 'public_notice' },
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
        metadata: { ...base, title: f.name.replace(/\.pdf$/i, ''), linkText: f.name, fileName: f.name, documentType: classifyType(f.name) === 'other' ? 'public_notice' : classifyType(f.name) },
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
