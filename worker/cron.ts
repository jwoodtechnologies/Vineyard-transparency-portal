/**
 * Scheduled checks (Cloudflare Cron Trigger, every five minutes; the :00 tick also reads news):
 *   1. CivicClerk: not called from here. CivicClerk answers Cloudflare's addresses with 403, so its
 *      meetings and files come from the GitHub ingest (vineyard-civicclerk-meetings), which this job
 *      starts every ten minutes (civicclerk-dispatch in worker/sync/run.ts).
 *   2. City website, Utah Public Notice Website and the city events calendar (worker/sync/run.ts).
 *   3. Queue: new files are fetched, their text extracted and indexed for search and chat, and
 *      priority records archived, inside the Worker (worker/sync/ingest.ts).
 *   4. Utah County Sheriff's Office press releases (hourly).
 * The GitHub ingest job keeps OCR, Word/Excel files and the municipal code site. Every write is
 * counted against the same daily D1 budget as ingestion.
 */
import type { Env } from './env';
import { Budget, upsertQueue } from './admin/routes';
import { ensureNewsTables } from './lib/news';
import { UCSO_ARCHIVE, UCSO_SOURCE, cleanText, mentionsVineyard, recent, releaseBody, ucsoPage, type UcsoItem } from './lib/sheriff';
import { processVotes } from './api/votes';
import { track } from './sync/checks';
import { runSync } from './sync/run';
import { drainContribQueue } from './contrib/indexing';
import { refreshCoverageIfStale } from './lib/coverage';
import { bumpDataVersion } from './lib/dataVersion';
import { rebuildPages } from './api/pages';

const UA = { 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org; public records archive)', accept: 'application/json, text/html;q=0.9' };

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
export async function runFrequent(env: Env, scheduledTime = Date.now()): Promise<Record<string, unknown>> {
  const budget = new Budget(env);
  const summary: Record<string, unknown> = {};
  // CivicClerk refuses Cloudflare's network (403); it is tried once an hour (runHourly) to notice if
  // that changes. Meetings arrive meanwhile from the Utah Public Notice Website and the GitHub job.
  Object.assign(summary, await runSync(env, scheduledTime, budget));
  summary.votes = await track(env, 'votes', () => processVotes(env, 6_000, 20));
  // Big PDFs added on the portal: their full text (the title is searchable from the start).
  summary.portalUploads = await track(env, 'portal-uploads', () => drainContribQueue(env, budget, Date.now() + 60_000));
  // The coverage check (owner panel) is recomputed once a day.
  summary.coverage = await track(env, 'coverage', () => refreshCoverageIfStale(env));
  summary.pages = await afterChanges(env, budget, summary);
  return summary;
}

/**
 * When the tick changed public data (rows written, or minutes read into votes): the data version goes up, so
 * edge copies refresh, and the heavy pages' payloads are rebuilt now (worker/api/pages.ts) so a reader's
 * request is one stored row.
 */
async function afterChanges(env: Env, budget: Budget, summary: Record<string, unknown>): Promise<unknown> {
  const votes = summary.votes as { read?: number; motions?: number } | undefined;
  if (!budget.written && !Number(votes?.read ?? 0)) return 'unchanged';
  await bumpDataVersion(env);
  // Voting pages are rebuilt when minutes were read or meetings changed; the construction payload (and any
  // other page) is rebuilt on its next request while the stored copy is served.
  return track(env, 'pages', () => rebuildPages(env, ['council', 'planning', 'rda']));
}

export async function runHourly(env: Env, scheduledTime = Date.now()): Promise<Record<string, unknown>> {
  await ensureNewsTables(env);
  const budget = new Budget(env);
  const started = new Date().toISOString();
  const summary: Record<string, unknown> = {};
  // The hourly check writes only a few rows, so it runs even after the backfill has used the
  // day's ingestion allowance (that allowance sits well under the D1 Free daily limit).
  summary.sheriff = await track(env, 'sheriff', () => refreshSheriff(env, budget));
  // New minutes become voting records within the hour.
  Object.assign(summary, await runSync(env, scheduledTime, budget));
  summary.votes = await track(env, 'votes', () => processVotes(env, 8_000, 40));
  summary.portalUploads = await track(env, 'portal-uploads', () => drainContribQueue(env, budget, Date.now() + 60_000));
  summary.pages = await afterChanges(env, budget, summary);
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('INSERT INTO cron_runs (started_at, finished_at, summary_json) VALUES (?, ?, ?)').bind(started, new Date().toISOString(), JSON.stringify(summary)),
    env.CATALOG_DB.prepare('DELETE FROM cron_runs WHERE id <= (SELECT max(id) - 500 FROM cron_runs)'),
  ]);
  return summary;
}
