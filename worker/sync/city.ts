/**
 * Vineyard City website, read by the Worker (the city's web host refuses GitHub's runner
 * addresses, HTTP 403, so the GitHub job can no longer crawl it).
 *
 *  - Watched pages (transparency portal, construction, RDA, agendas and notices, news) are read on
 *    every five-minute check. A changed page is stored as a new version with its retrieval time,
 *    re-indexed for search and chat, and every document it links is queued.
 *  - The rest of the site is crawled a few pages per check, so a full pass of every page finishes
 *    about once a day. A finished pass is recorded as a crawl run ("last crawl" on the site).
 */
import type { Env } from '../env';
import { Budget, upsertQueue } from '../admin/routes';
import { classifyType } from '../lib/civicclerk';
import { extractHtml, type HtmlExtraction } from './extract';
import { indexRecord, sha256Hex, SYNC_UA } from './ingest';
import { canonicalUrl, categorize, normalizeUrl, urlKey } from './urls';
import { assertRobots } from './robots';

export const CITY = 'https://www.vineyardutah.gov/';
export const CITY_SOURCE = 'vineyard-city-website';
export const PORTAL_SOURCE = 'vineyard-transparency-portal';

export interface WatchedPage {
  id: string;
  url: string;
  label: string;
  sourceId: string;
}

export const WATCHED_PAGES: WatchedPage[] = [
  { id: 'transparency', url: `${CITY}transparency_portal/index.php`, label: 'Transparency Portal', sourceId: PORTAL_SOURCE },
  { id: 'construction', url: `${CITY}government/construction_projects.php`, label: 'Construction Projects', sourceId: CITY_SOURCE },
  { id: 'rda', url: `${CITY}government/redevelopment_agency/index.php`, label: 'Redevelopment Agency', sourceId: CITY_SOURCE },
  { id: 'notices', url: `${CITY}government/agenda_minutes___public_notice.php`, label: 'Agendas, Minutes and Public Notices', sourceId: CITY_SOURCE },
  { id: 'news', url: `${CITY}contact/news.php`, label: 'News', sourceId: CITY_SOURCE },
];

/** Section pages the crawl starts from (ingest/pipeline.py CITY_SECTION_PAGES). */
const SECTION_PAGES = [
  ...'mayors_office request_a_meeting_with_the_mayor moving_vineyard_forward city_council2 conflict_of_interest_forms elections recorder records_request annual_meeting_schedule agenda_minutes___public_notice council_vacancy building resource_documents basement_finish water_meter_request public_works streets water___wastewater construction_projects grounds_maintenance engineering engineering_standards parks_and_recreation events splash_pad recreation parks concessions skatepark_fundraiser community_development planning code_enforcement parking short_term_rental business_licensing_ accessory_dwelling_unit_licensing economic_development utah_county_sheriff_s_office rad_systems_of_self-defense_classes vineyard_citizens_academy finance fee_schedule budget annual_financial_report request_for_proposals_(rfp) city_staff board___commission_members water_quality_reports'
    .split(' ')
    .map((p) => `government/${p}.php`),
  ...'events library_options interlibrary_loan library_reimbursement vineyard_community_garden vineyard_youth_council vineyard_youth_council_candidacy_forms_ safewalk_program boards___commissions arch_commission active_transportation_commission planning_commission library_board vineyard_cares_board development_review_commission newsletters neighborhood_map trails report-a-concern communication_resources plant_walk volunteer city_dump_passes bikemonth fireworks school_safety'
    .split(' ')
    .map((p) => `community_/${p}.php`),
  ...'utility_billing emergency_preparedness utah_county_resources uta_eco_pass'.split(' ').map((p) => `services/${p}.php`),
  'index.php',
  'government/index.php',
  'community_/index.php',
  'services/index.php',
  'government/redevelopment_agency/index.php',
  'contact/news.php',
  'transparency_portal/index.php',
].map((p) => `${CITY}${p}`);

const MAX_DEPTH = 4;
const RDA_HINT = /redevelopment|\/rda|\brda\b/i;

let ensured = false;
async function ensureTables(env: Env): Promise<void> {
  if (ensured) return;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `CREATE TABLE IF NOT EXISTS page_snapshots (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         page_id TEXT NOT NULL,
         url TEXT NOT NULL,
         retrieved_at TEXT NOT NULL,
         sha256 TEXT NOT NULL,
         heading TEXT,
         text TEXT NOT NULL,
         tables_json TEXT NOT NULL DEFAULT '[]',
         links_json TEXT NOT NULL DEFAULT '[]',
         http_status INTEGER
       )`,
    ),
    env.CATALOG_DB.prepare('CREATE INDEX IF NOT EXISTS page_snapshots_page ON page_snapshots (page_id, retrieved_at DESC)'),
    env.CATALOG_DB.prepare(
      `CREATE TABLE IF NOT EXISTS page_watch (
         page_id TEXT PRIMARY KEY, url TEXT NOT NULL, etag TEXT, last_modified TEXT, sha256 TEXT,
         last_checked_at TEXT, last_changed_at TEXT, last_status INTEGER, last_error TEXT
       )`,
    ),
    env.CATALOG_DB.prepare(
      `CREATE TABLE IF NOT EXISTS site_pages (
         url TEXT PRIMARY KEY, depth INTEGER NOT NULL DEFAULT 0, sha256 TEXT, pass_id TEXT,
         last_fetched_at TEXT, last_status INTEGER, discovered_at TEXT NOT NULL
       )`,
    ),
    env.CATALOG_DB.prepare('CREATE INDEX IF NOT EXISTS site_pages_pass ON site_pages (pass_id, depth)'),
    env.CATALOG_DB.prepare(`CREATE TABLE IF NOT EXISTS site_crawl (id INTEGER PRIMARY KEY CHECK (id = 1), pass_id TEXT NOT NULL, started_at TEXT NOT NULL, pages_done INTEGER NOT NULL DEFAULT 0, docs_queued INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0)`),
  ]);
  try {
    await env.CATALOG_DB.prepare('ALTER TABLE page_snapshots ADD COLUMN html TEXT').run();
  } catch {
    /* column exists */
  }
  ensured = true;
}

export async function fetchCityPage(env: Env, url: string, etag?: string | null, lastModified?: string | null): Promise<{ status: number; html: string | null; finalUrl: string; etag: string | null; lastModified: string | null }> {
  await assertRobots(env, url);
  const headers: Record<string, string> = { 'user-agent': SYNC_UA, accept: 'text/html,application/xhtml+xml' };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  const res = await fetch(url, { headers, redirect: 'follow' });
  const html = res.status === 200 ? await res.text() : null;
  return { status: res.status, html, finalUrl: res.url || url, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
}

/** Queues every document a page links (PDF, Word, Excel...). Returns how many links were offered. */
async function queueLinkedDocuments(env: Env, page: HtmlExtraction, pageUrl: string, priority: number, budget: Budget, sourceId = CITY_SOURCE): Promise<number> {
  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const link of page.links) {
    const url = normalizeUrl(link.url);
    if (!url) continue;
    const cat = categorize(url);
    if (cat.category !== 'document') continue;
    const key = await urlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    const rda = RDA_HINT.test(pageUrl) || RDA_HINT.test(link.text);
    const fileName = decodeURIComponent(url.split('?')[0].split('/').pop() ?? '');
    items.push({
      urlKey: key,
      sourceId,
      url,
      kind: 'document',
      priority,
      parentUrl: pageUrl,
      metadata: {
        linkText: link.text || null,
        title: link.text || null,
        pageTitle: page.heading,
        fileName,
        extension: cat.ext,
        documentType: classifyType(link.text, fileName),
        governmentBodyId: rda ? 'redevelopment-agency' : null,
        governmentBodyName: rda ? 'Vineyard Redevelopment Agency' : null,
      },
      runId: 'worker',
    });
  }
  if (!items.length) return 0;
  // Only links the queue has never seen are added; known ones keep their state and metadata.
  const known = await env.CATALOG_DB.prepare('SELECT url_key FROM crawl_queue WHERE url_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(items.map((i) => i.urlKey))).all<{ url_key: string }>();
  const have = new Set((known.results ?? []).map((r) => r.url_key));
  const fresh = items.filter((i) => !have.has(String(i.urlKey)));
  for (let i = 0; i < fresh.length; i += 400) await upsertQueue(env, { items: fresh.slice(i, i + 400) }, budget);
  return fresh.length;
}

/** Indexes a page's own text as a record (a new version when its text changed). */
async function indexPage(env: Env, url: string, page: HtmlExtraction, sha: string, sourceId: string, label: string | null, budget: Budget): Promise<string | null> {
  if (page.text.length < 80) return null;
  const r = await indexRecord(
    env,
    {
      key: await urlKey(url),
      sourceId,
      url,
      parentUrl: null,
      meta: { kind: 'web_page', documentType: 'other', title: page.heading ?? label },
      title: (page.heading ?? label ?? url).slice(0, 300),
      documentType: 'other',
      mime: 'text/html',
      fileName: `${(page.heading ?? label ?? 'page').replace(/[^A-Za-z0-9._ ()-]+/g, '_').slice(0, 120)}.html`,
      bytes: null,
      ext: 'html',
      sha,
      pages: [{ number: null, text: page.text }],
      pageCount: null,
      textStatus: 'extracted',
      ocrStatus: 'not_required',
    },
    budget,
  );
  return r.documentId;
}

export interface PageCheck {
  id: string;
  status: number | string;
  changed: boolean;
  queued?: number;
}

/** Reads every watched page once. Changed pages are versioned, indexed and their documents queued. */
export async function watchPages(env: Env, budget: Budget, onlyIds?: string[]): Promise<PageCheck[]> {
  await ensureTables(env);
  const out: PageCheck[] = [];
  const now = new Date().toISOString();
  for (const w of WATCHED_PAGES) {
    if (onlyIds && !onlyIds.includes(w.id)) continue;
    const prev = await env.CATALOG_DB.prepare('SELECT * FROM page_watch WHERE page_id = ?').bind(w.id).first<Record<string, string | null>>();
    try {
      const r = await fetchCityPage(env, w.url, prev?.etag, prev?.last_modified);
      if (r.status === 304 || !r.html) {
        await env.CATALOG_DB.prepare(
          `INSERT INTO page_watch (page_id, url, last_checked_at, last_status, last_error) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(page_id) DO UPDATE SET last_checked_at = excluded.last_checked_at, last_status = excluded.last_status, last_error = excluded.last_error`,
        )
          .bind(w.id, w.url, now, r.status, r.status === 304 ? null : `HTTP ${r.status}`)
          .run();
        if (r.status !== 304) throw new Error(`HTTP ${r.status} for ${w.url}`);
        out.push({ id: w.id, status: r.status, changed: false });
        continue;
      }
      const page = extractHtml(r.html, r.finalUrl);
      const sha = await sha256Hex(`${page.text}\n${JSON.stringify(page.tables)}`);
      const changed = sha !== prev?.sha256;
      let queued = 0;
      if (changed) {
        await env.CATALOG_DB.prepare('INSERT INTO page_snapshots (page_id, url, retrieved_at, sha256, heading, text, tables_json, links_json, http_status, html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(w.id, r.finalUrl, now, sha, page.heading, page.text.slice(0, 200_000), JSON.stringify(page.tables).slice(0, 200_000), JSON.stringify(page.links.slice(0, 400)), r.status, r.html.slice(0, 1_500_000))
          .run();
        await indexPage(env, r.finalUrl, page, sha, w.sourceId, w.label, budget);
        queued = await queueLinkedDocuments(env, page, r.finalUrl, 10, budget, w.sourceId);
      }
      await env.CATALOG_DB.prepare(
        `INSERT INTO page_watch (page_id, url, etag, last_modified, sha256, last_checked_at, last_changed_at, last_status, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(page_id) DO UPDATE SET url = excluded.url, etag = excluded.etag, last_modified = excluded.last_modified, sha256 = excluded.sha256,
           last_checked_at = excluded.last_checked_at, last_changed_at = coalesce(excluded.last_changed_at, page_watch.last_changed_at), last_status = excluded.last_status, last_error = NULL`,
      )
        .bind(w.id, r.finalUrl, r.etag, r.lastModified, sha, now, changed ? now : null, r.status)
        .run();
      out.push({ id: w.id, status: r.status, changed, queued });
    } catch (e) {
      out.push({ id: w.id, status: String(e instanceof Error ? e.message : e).slice(0, 200), changed: false });
    }
  }
  return out;
}

/** Recent stored versions of a watched page, newest first (with HTML when it was kept). */
export async function recentSnapshots(env: Env, pageId: string, limit = 10): Promise<Array<Record<string, unknown>>> {
  await ensureTables(env);
  const r = await env.CATALOG_DB.prepare('SELECT * FROM page_snapshots WHERE page_id = ? ORDER BY retrieved_at DESC LIMIT ?').bind(pageId, limit).all<Record<string, unknown>>();
  return r.results ?? [];
}

/** Latest stored version of a watched page, plus the retrieval times of earlier versions. */
/** The stored HTML of the latest version of a watched page (the city's own markup, for checking extraction). */
export async function snapshotHtml(env: Env, pageId: string): Promise<{ url: string; retrievedAt: string; html: string } | null> {
  await ensureTables(env);
  const r = await env.CATALOG_DB.prepare('SELECT url, retrieved_at, html FROM page_snapshots WHERE page_id = ? AND html IS NOT NULL ORDER BY retrieved_at DESC LIMIT 1').bind(pageId).first<{ url: string; retrieved_at: string; html: string }>();
  return r ? { url: r.url, retrievedAt: r.retrieved_at, html: r.html } : null;
}

export async function latestSnapshot(env: Env, pageId: string): Promise<{ current: Record<string, unknown> | null; versions: Array<{ retrievedAt: string; sha256: string }>; lastCheckedAt: string | null }> {
  await ensureTables(env);
  const [cur, versions, watch] = await Promise.all([
    env.CATALOG_DB.prepare('SELECT * FROM page_snapshots WHERE page_id = ? ORDER BY retrieved_at DESC LIMIT 1').bind(pageId).first<Record<string, unknown>>(),
    env.CATALOG_DB.prepare('SELECT retrieved_at, sha256 FROM page_snapshots WHERE page_id = ? ORDER BY retrieved_at DESC LIMIT 50').bind(pageId).all<{ retrieved_at: string; sha256: string }>(),
    env.CATALOG_DB.prepare('SELECT last_checked_at FROM page_watch WHERE page_id = ?').bind(pageId).first<{ last_checked_at: string | null }>(),
  ]);
  return { current: cur, versions: (versions.results ?? []).map((v) => ({ retrievedAt: v.retrieved_at, sha256: v.sha256 })), lastCheckedAt: watch?.last_checked_at ?? null };
}

/**
 * Crawls up to `maxPages` city pages not yet read in the current pass. When the frontier is empty
 * the pass is complete: it is recorded in crawl_runs and the next pass starts after 20 hours.
 */
export async function crawlCitySite(env: Env, budget: Budget, maxPages: number, deadline: number): Promise<Record<string, unknown>> {
  await ensureTables(env);
  const db = env.CATALOG_DB;
  const now = new Date().toISOString();
  let state = await db.prepare('SELECT * FROM site_crawl WHERE id = 1').first<{ pass_id: string; started_at: string; pages_done: number; docs_queued: number; errors: number }>();
  if (!state) {
    const passId = `site_${now.slice(0, 19).replace(/[-:T]/g, '')}`;
    await db.prepare('INSERT INTO site_crawl (id, pass_id, started_at) VALUES (1, ?, ?)').bind(passId, now).run();
    state = { pass_id: passId, started_at: now, pages_done: 0, docs_queued: 0, errors: 0 };
  }
  // Seed the frontier for this pass (new seeds are added; known pages are kept).
  const seedStmts = SECTION_PAGES.map((u) => db.prepare('INSERT OR IGNORE INTO site_pages (url, depth, discovered_at) VALUES (?, 0, ?)').bind(canonicalUrl(u), now));
  for (let i = 0; i < seedStmts.length; i += 50) await db.batch(seedStmts.slice(i, i + 50));

  const due = await db
    .prepare('SELECT url, depth, sha256 FROM site_pages WHERE coalesce(pass_id, \'\') <> ? AND depth <= ? ORDER BY depth, discovered_at LIMIT ?')
    .bind(state.pass_id, MAX_DEPTH, maxPages)
    .all<{ url: string; depth: number; sha256: string | null }>();
  const pages = due.results ?? [];
  if (!pages.length) {
    // Pass complete: record it once, then wait 20 hours before starting the next one.
    const ageHours = (Date.now() - Date.parse(state.started_at)) / 3600_000;
    const recorded = await db.prepare('SELECT 1 FROM crawl_runs WHERE id = ?').bind(state.pass_id).first();
    if (!recorded) {
      await db
        .prepare(`INSERT INTO crawl_runs (id, trigger, started_at, finished_at, status, sources_json, fetched, discovered, errors, message) VALUES (?, 'worker-site-pass', ?, ?, 'completed', ?, ?, ?, ?, ?)`)
        .bind(state.pass_id, state.started_at, now, JSON.stringify([CITY_SOURCE]), state.pages_done, state.docs_queued, state.errors, 'Full pass of the city website by the five-minute check.')
        .run();
      await db.prepare(`UPDATE sources SET status = 'active', status_message = NULL, last_checked_at = ?, last_success_at = ? WHERE id IN (?, ?)`).bind(now, now, CITY_SOURCE, PORTAL_SOURCE).run();
    }
    if (ageHours >= 20) {
      const passId = `site_${now.slice(0, 19).replace(/[-:T]/g, '')}`;
      await db.prepare('UPDATE site_crawl SET pass_id = ?, started_at = ?, pages_done = 0, docs_queued = 0, errors = 0 WHERE id = 1').bind(passId, now).run();
    }
    return { pass: state.pass_id, complete: true, pages: state.pages_done };
  }

  let done = 0;
  let queued = 0;
  let errors = 0;
  for (const p of pages) {
    if (Date.now() > deadline) break;
    let status = 0;
    try {
      const r = await fetchCityPage(env, p.url);
      status = r.status;
      if (r.html) {
        const page = extractHtml(r.html, r.finalUrl);
        const sha = await sha256Hex(page.text);
        if (sha !== p.sha256) {
          const cat = categorize(r.finalUrl);
          if (cat.category === 'city_page') await indexPage(env, r.finalUrl, page, sha, CITY_SOURCE, null, budget);
        }
        queued += await queueLinkedDocuments(env, page, r.finalUrl, 100 + p.depth * 10, budget);
        if (p.depth < MAX_DEPTH) {
          const next = page.links
            .map((l) => normalizeUrl(l.url))
            .filter((u): u is string => Boolean(u))
            .filter((u) => {
              const c = categorize(u);
              return c.category === 'city_page' && c.crawlable;
            })
            .map((u) => canonicalUrl(u));
          const stmts = [...new Set(next)].slice(0, 120).map((u) => db.prepare('INSERT OR IGNORE INTO site_pages (url, depth, discovered_at) VALUES (?, ?, ?)').bind(u, p.depth + 1, now));
          for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
        }
        await db.prepare('UPDATE site_pages SET sha256 = ?, pass_id = ?, last_fetched_at = ?, last_status = ? WHERE url = ?').bind(sha, state.pass_id, now, status, p.url).run();
      } else {
        errors++;
        await db.prepare('UPDATE site_pages SET pass_id = ?, last_fetched_at = ?, last_status = ? WHERE url = ?').bind(state.pass_id, now, status, p.url).run();
      }
    } catch {
      errors++;
      await db.prepare('UPDATE site_pages SET pass_id = ?, last_fetched_at = ?, last_status = ? WHERE url = ?').bind(state.pass_id, now, status || -1, p.url).run();
    }
    done++;
  }
  await db.prepare('UPDATE site_crawl SET pages_done = pages_done + ?, docs_queued = docs_queued + ?, errors = errors + ? WHERE id = 1').bind(done, queued, errors).run();
  return { pass: state.pass_id, pages: done, queued, errors };
}
