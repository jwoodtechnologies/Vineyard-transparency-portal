/**
 * Hourly check (Cloudflare Cron Trigger, free plan). Keeps the portal current between the nightly
 * full crawl:
 *   1. CivicClerk: meetings from three weeks back to two months ahead. New or changed meetings are
 *      saved right away (the calendar updates within the hour) and any newly posted agenda, packet,
 *      minutes or attachment is queued for text extraction.
 *   2. Utah County Sheriff's Office: new press releases. Ones that mention Vineyard appear on the
 *      Latest page within the hour and are queued for indexing.
 * Heavy work (downloads, PDF text, OCR) stays in the GitHub Actions ingest job, which drains the
 * queue every few hours. Everything here respects the same daily D1 write budget as ingestion.
 */
import type { Env } from './env';
import { Budget, upsertBodies, upsertMeetings, upsertQueue } from './admin/routes';
import { CC_API, mapEvent, type CcEvent } from './lib/civicclerk';
import { ensureNewsTables } from './lib/news';
import { UCSO_ARCHIVE, UCSO_SOURCE, cleanText, mentionsVineyard, recent, releaseBody, ucsoPage, type UcsoItem } from './lib/sheriff';
import { processVotes } from './api/votes';

const UA = { 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org; public records archive)', accept: 'application/json, text/html;q=0.9' };

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const iso = (d: Date) => d.toISOString().slice(0, 19) + 'Z';

async function refreshCivicClerk(env: Env, budget: Budget): Promise<Record<string, number>> {
  const now = new Date();
  const from = new Date(now.getTime() - 21 * 86400_000);
  const to = new Date(now.getTime() + 60 * 86400_000);
  const flt = `startDateTime ge ${iso(from)} and startDateTime lt ${iso(to)}`;
  let url: string | null = `${CC_API}/Events?$filter=${encodeURIComponent(flt)}&$orderby=${encodeURIComponent('startDateTime desc')}`;
  const events: CcEvent[] = [];
  const seen = new Set<number>();
  for (let page = 0; url && page < 10; page++) {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`CivicClerk ${res.status}`);
    const data = (await res.json()) as { value?: CcEvent[]; '@odata.nextLink'?: string };
    const fresh = (data.value ?? []).filter((e) => e && !seen.has(e.id));
    if (!fresh.length) break;
    fresh.forEach((e) => seen.add(e.id));
    events.push(...fresh);
    const next = data['@odata.nextLink'];
    url = typeof next === 'string' && next.startsWith(`${CC_API}/Events`) ? next : null;
  }

  const meetings: Record<string, unknown>[] = [];
  const bodies = new Map<string, Record<string, unknown>>();
  const items: Record<string, unknown>[] = [];
  for (const ev of events) {
    const m = mapEvent(ev, now);
    if (!m) continue;
    meetings.push(m.meeting);
    if (m.body) bodies.set(m.body.id, m.body);
    for (const f of m.files) {
      // Files for recent and upcoming meetings go to the front of the queue, ahead of the archive backfill.
      items.push({ urlKey: await sha256Hex(f.identifier), sourceId: 'vineyard-civicclerk-meetings', url: f.url, kind: 'document', priority: f.priority - 30, parentUrl: f.parentUrl, metadata: f.metadata, runId: 'hourly' });
    }
  }
  if (bodies.size) await upsertBodies(env, { bodies: [...bodies.values()] }, budget);
  for (let i = 0; i < meetings.length; i += 100) await upsertMeetings(env, { meetings: meetings.slice(i, i + 100) }, budget);
  for (let i = 0; i < items.length; i += 400) await upsertQueue(env, { items: items.slice(i, i + 400) }, budget);
  return { events: events.length, meetings: meetings.length, files: items.length };
}

async function refreshSheriff(env: Env, budget: Budget): Promise<Record<string, number>> {
  const res = await fetch(UCSO_ARCHIVE, { headers: UA });
  if (!res.ok) throw new Error(`Sheriff archive ${res.status}`);
  const all = (await res.json()) as UcsoItem[];
  const fresh = recent(Array.isArray(all) ? all : [], new Date(Date.now() - 60 * 86400_000)).slice(0, 40);
  if (!fresh.length) return { recent: 0, added: 0, checked: 0 };

  const ids = fresh.map((i) => `ucso:${Math.trunc(i.id)}`);
  const known = await env.CATALOG_DB.prepare('SELECT id FROM news_items WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ id: string }>();
  const have = new Set((known.results ?? []).map((r) => r.id));
  const add = fresh.filter((i) => !have.has(`ucso:${Math.trunc(i.id)}`));
  const now = new Date().toISOString();
  let rows = 0;
  if (add.length) {
    const stmts = add.map((i) => {
      const summary = cleanText(i.body_short ?? '').slice(0, 600);
      return env.CATALOG_DB.prepare(
        `INSERT OR IGNORE INTO news_items (id, source, title, url, published_at, summary, mentions_vineyard, checked, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).bind(`ucso:${Math.trunc(i.id)}`, UCSO_SOURCE, cleanText(i.headline ?? 'Press release').slice(0, 300), ucsoPage(i.id), String(i.entered_date), summary, mentionsVineyard(`${i.headline} ${summary}`) ? 1 : 0, now);
    });
    rows += (await env.CATALOG_DB.batch(stmts)).reduce((t, r) => t + Number(r.meta?.rows_written ?? 0), 0);
    // Every new release is queued; the indexer keeps only the ones whose full text mentions Vineyard.
    const items = await Promise.all(
      add.map(async (i) => ({
        urlKey: await sha256Hex(`ucso:press:${Math.trunc(i.id)}`),
        sourceId: UCSO_SOURCE,
        url: ucsoPage(i.id),
        kind: 'document',
        priority: 40,
        parentUrl: 'https://sheriff.utahcounty.gov/media/pressArchive',
        metadata: { kind: 'press_release', title: cleanText(i.headline ?? 'Press release').slice(0, 300), documentType: 'public_notice', documentDate: String(i.entered_date).slice(0, 10), requireMention: 'vineyard', governmentBodyName: "Utah County Sheriff's Office" },
        runId: 'hourly',
      })),
    );
    await upsertQueue(env, { items }, budget);
  }

  // Read up to three unchecked releases in full to see whether they mention Vineyard.
  const pending = await env.CATALOG_DB.prepare('SELECT id, url FROM news_items WHERE source = ? AND checked = 0 ORDER BY published_at DESC LIMIT 3').bind(UCSO_SOURCE).all<{ id: string; url: string }>();
  let checked = 0;
  for (const p of pending.results ?? []) {
    const page = await fetch(p.url, { headers: UA }).catch(() => null);
    if (!page?.ok) continue;
    const body = releaseBody(await page.text());
    const r = await env.CATALOG_DB.prepare('UPDATE news_items SET checked = 1, mentions_vineyard = max(mentions_vineyard, ?), summary = coalesce(?, summary) WHERE id = ?')
      .bind(mentionsVineyard(body) ? 1 : 0, body ? body.slice(0, 600) : null, p.id)
      .run();
    rows += Number(r.meta?.rows_written ?? 0);
    checked++;
  }
  await budget.record(rows);
  return { recent: fresh.length, added: add.length, checked };
}

/**
 * Every five minutes: the city's agenda portal is checked for new or changed meetings and newly
 * posted files (agendas, packets, minutes). Meetings show on the calendar right away; files are
 * queued and read by the ingest job on its next pass. Writes happen only when something changed.
 */
export async function runFrequent(env: Env): Promise<Record<string, unknown>> {
  const budget = new Budget(env);
  const summary: Record<string, unknown> = {};
  summary.civicclerk = await refreshCivicClerk(env, budget).catch((e) => String(e).slice(0, 300));
  summary.votes = await processVotes(env, 6_000, 20).catch((e) => String(e).slice(0, 200));
  return summary;
}

export async function runHourly(env: Env): Promise<Record<string, unknown>> {
  await ensureNewsTables(env);
  const budget = new Budget(env);
  const started = new Date().toISOString();
  const summary: Record<string, unknown> = {};
  // The hourly check writes only a few rows, so it runs even after the backfill has used the
  // day's ingestion allowance (that allowance sits well under the D1 Free daily limit).
  const [cc, ucso] = await Promise.allSettled([refreshCivicClerk(env, budget), refreshSheriff(env, budget)]);
  summary.civicclerk = cc.status === 'fulfilled' ? cc.value : String(cc.reason).slice(0, 300);
  summary.sheriff = ucso.status === 'fulfilled' ? ucso.value : String(ucso.reason).slice(0, 300);
  // New minutes become voting records within the hour.
  summary.votes = await processVotes(env, 8_000, 40).catch((e) => String(e).slice(0, 200));
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('INSERT INTO cron_runs (started_at, finished_at, summary_json) VALUES (?, ?, ?)').bind(started, new Date().toISOString(), JSON.stringify(summary)),
    env.CATALOG_DB.prepare('DELETE FROM cron_runs WHERE id <= (SELECT max(id) - 500 FROM cron_runs)'),
  ]);
  return summary;
}
