/**
 * Websites staff asked the portal to watch (staff screen Watched websites, worker/staff/watch.ts). The
 * five-minute cron checks the few that are due, the same way it checks the city's own pages: robots.txt is
 * respected, our user agent is sent, the page is read up to MAX_PAGE_BYTES, a changed page gets a new stored
 * version and is indexed for search and chat, and newly linked PDF, Word and Excel files go to the record
 * queue. Safety: http and https only, public host names only (no address literals, localhost or private
 * names), at most MAX_WATCHED pages, PER_TICK checks a tick, and nothing while the day's write budget is
 * nearly used.
 */
import type { Env } from '../env';
import { Budget } from '../admin/routes';
import { ensureTables, indexPage, queueLinkedDocuments } from './city';
import { extractHtml } from './extract';
import { sha256Hex, SYNC_UA } from './ingest';
import { assertRobots } from './robots';
import { normalizeUrl } from './urls';

export const WEB_SOURCE = 'watched-websites';
/** How many websites can be watched at once. */
export const MAX_WATCHED = 25;
/** Checks per five-minute tick. */
export const PER_TICK = 3;
/** The largest page read. */
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Linked files queued from one check. */
export const MAX_FILES_PER_CHECK = 20;
/** Watching pauses for the day once this share of the daily write budget is used. */
export const BUDGET_STOP = 0.9;

export const FREQUENCIES = [
  { key: '10m', minutes: 10, label: 'Every 10 minutes' },
  { key: '1h', minutes: 60, label: 'Hourly' },
  { key: '6h', minutes: 360, label: 'Every 6 hours' },
  { key: '1d', minutes: 1440, label: 'Daily' },
  { key: '1w', minutes: 10080, label: 'Weekly' },
] as const;

export const frequencyLabel = (minutes: number): string => FREQUENCIES.find((f) => f.minutes === minutes)?.label ?? `Every ${minutes} minutes`;

const PRIVATE_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|private|arpa|test|example|invalid|onion)$/;
const OWN_HOSTS = /(^|\.)(vineyardportal\.org|workers\.dev)$/;

/**
 * Whether an address may be watched: http or https, no user name or password, the usual port, and a public
 * host name (letters, with a real top level domain). Address literals (IPv4 in any form, IPv6), localhost,
 * private and reserved names, and the portal itself are refused. Returns the cleaned address or why not.
 */
export function checkWatchUrl(raw: unknown): { ok: true; url: string } | { ok: false; reason: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: false, reason: 'Enter the address of the page.' };
  if (text.length > 2000) return { ok: false, reason: 'That address is too long.' };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, reason: 'That is not a web address.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Only http and https pages can be watched.' };
  if (u.username || u.password) return { ok: false, reason: 'Leave the user name and password out of the address.' };
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, reason: 'Only pages on the usual web ports can be watched.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || host.includes(':')) return { ok: false, reason: 'Use the site name, not a numeric address.' };
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) return { ok: false, reason: 'Use the site name, not a numeric address.' };
  if (!host.includes('.') || PRIVATE_SUFFIX.test(host)) return { ok: false, reason: 'Only public websites can be watched.' };
  if (!/\.([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host)) return { ok: false, reason: 'Only public websites can be watched.' };
  if (OWN_HOSTS.test(host)) return { ok: false, reason: 'This is the portal itself.' };
  const url = normalizeUrl(u.toString());
  return url ? { ok: true, url } : { ok: false, reason: 'That is not a web address.' };
}

export interface WatchRow {
  id: string;
  label: string;
  url: string;
  every_min: number;
  paused: number;
  deleted_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  etag: string | null;
  last_modified: string | null;
  sha256: string | null;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_status: number | null;
  last_error: string | null;
  files_found: number;
}

/** When a page is next due (a minute early counts, since ticks are five minutes apart). */
export function nextDue(row: Pick<WatchRow, 'every_min' | 'last_checked_at'>, now: number): number {
  return row.last_checked_at ? Date.parse(row.last_checked_at) + row.every_min * 60_000 - 60_000 : now;
}

export const isDue = (row: Pick<WatchRow, 'every_min' | 'last_checked_at' | 'paused' | 'deleted_at'>, now: number): boolean => !row.paused && !row.deleted_at && nextDue(row, now) <= now;

/** The pages to check this tick: due ones, longest overdue first, at most `n`. */
export function pickDue<T extends Pick<WatchRow, 'every_min' | 'last_checked_at' | 'paused' | 'deleted_at'>>(rows: T[], now: number, n = PER_TICK): T[] {
  return rows
    .filter((r) => isDue(r, now))
    .sort((a, b) => nextDue(a, now) - nextDue(b, now))
    .slice(0, n);
}

/** A linked file worth queuing from a watched page: PDF, Word or Excel on a public host. */
export function linkedFileType(url: string): string | null {
  if (!checkWatchUrl(url).ok) return null;
  const ext = (new URL(url).pathname.split('.').pop() ?? '').toLowerCase();
  return ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext) ? ext : null;
}

let ready = false;

export async function ensureWatchTables(env: Env): Promise<void> {
  if (ready) return;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `CREATE TABLE IF NOT EXISTS web_watch (
         id TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, every_min INTEGER NOT NULL, paused INTEGER NOT NULL DEFAULT 0,
         deleted_at TEXT, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL,
         etag TEXT, last_modified TEXT, sha256 TEXT, last_checked_at TEXT, last_changed_at TEXT, last_status INTEGER, last_error TEXT,
         files_found INTEGER NOT NULL DEFAULT 0)`,
    ),
    // Checks and rows written each day, for the budget line on the staff screen.
    env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS web_watch_usage (day TEXT PRIMARY KEY, checks INTEGER NOT NULL DEFAULT 0, rows_written INTEGER NOT NULL DEFAULT 0)'),
    env.CATALOG_DB.prepare(
      `INSERT OR IGNORE INTO sources (id, name, base_url, source_type, authority, crawl_enabled, archive_enabled, document_discovery_enabled, description, notes, status, created_at, updated_at)
       VALUES ('${WEB_SOURCE}', 'Watched websites', 'https://vineyardportal.org/staff/watch', 'website', 'other', 0, 1, 1, 'Pages staff asked the portal to watch for changes and new files.', 'Checked by the Worker cron (worker/sync/webWatch.ts), not the nightly crawl.', 'active', datetime('now'), datetime('now'))`,
    ),
  ]);
  ready = true;
}

/** Reads a page up to MAX_PAGE_BYTES, after robots.txt; a redirect must also land on a public host. */
async function readPage(url: string, etag: string | null, lastModified: string | null): Promise<{ status: number; html: string | null; finalUrl: string; etag: string | null; lastModified: string | null }> {
  const headers: Record<string, string> = { 'user-agent': SYNC_UA, accept: 'text/html,application/xhtml+xml' };
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  const res = await fetch(url, { headers, redirect: 'follow' });
  const finalUrl = res.url || url;
  if (!checkWatchUrl(finalUrl).ok) {
    void res.body?.cancel();
    throw new Error('The page moved to an address that cannot be watched.');
  }
  const out = { status: res.status, html: null as string | null, finalUrl, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  if (res.status !== 200 || !res.body) {
    void res.body?.cancel();
    return out;
  }
  if (!/html|xml|text\/plain/i.test(res.headers.get('content-type') ?? 'text/html')) {
    void res.body.cancel();
    throw new Error('That address is not a web page.');
  }
  if (Number(res.headers.get('content-length') ?? 0) > MAX_PAGE_BYTES) {
    void res.body.cancel();
    throw new Error('The page is larger than 2 MB.');
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) {
      void reader.cancel();
      throw new Error('The page is larger than 2 MB.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  out.html = new TextDecoder().decode(all);
  return out;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/** One check of one watched page. Returns what happened, for the cron summary. */
export async function checkWatched(env: Env, w: WatchRow, budget: Budget): Promise<{ id: string; status: number | string; changed: boolean; files?: number }> {
  const now = new Date().toISOString();
  try {
    await assertRobots(env, w.url);
    const r = await readPage(w.url, w.etag, w.last_modified);
    if (r.status === 304 || !r.html) {
      const err = r.status === 304 ? null : `HTTP ${r.status}`;
      await env.CATALOG_DB.prepare('UPDATE web_watch SET last_checked_at = ?, last_status = ?, last_error = ? WHERE id = ?').bind(now, r.status, err, w.id).run();
      return { id: w.id, status: r.status, changed: false };
    }
    const page = extractHtml(r.html, r.finalUrl);
    const sha = await sha256Hex(`${page.text}\n${JSON.stringify(page.tables)}`);
    const changed = sha !== w.sha256;
    let files = 0;
    if (changed) {
      await ensureTables(env);
      await env.CATALOG_DB.prepare('INSERT INTO page_snapshots (page_id, url, retrieved_at, sha256, heading, text, tables_json, links_json, http_status, html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(`web:${w.id}`, r.finalUrl, now, sha, page.heading, page.text.slice(0, 200_000), JSON.stringify(page.tables).slice(0, 200_000), JSON.stringify(page.links.slice(0, 400)), r.status, r.html.slice(0, 500_000))
        .run();
      await budget.record(1);
      await indexPage(env, r.finalUrl, page, sha, WEB_SOURCE, w.label, budget);
      files = await queueLinkedDocuments(env, page, r.finalUrl, 20, budget, WEB_SOURCE, linkedFileType, MAX_FILES_PER_CHECK);
    }
    await env.CATALOG_DB.prepare(
      'UPDATE web_watch SET last_checked_at = ?, last_status = ?, last_error = NULL, etag = ?, last_modified = ?, sha256 = ?, last_changed_at = CASE WHEN ? THEN ? ELSE last_changed_at END, files_found = files_found + ? WHERE id = ?',
    )
      .bind(now, r.status, r.etag, r.lastModified, sha, changed ? 1 : 0, now, files, w.id)
      .run();
    return { id: w.id, status: r.status, changed, files };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).slice(0, 200);
    await env.CATALOG_DB.prepare('UPDATE web_watch SET last_checked_at = ?, last_error = ? WHERE id = ?').bind(now, msg, w.id).run();
    return { id: w.id, status: msg, changed: false };
  }
}

/** The cron step: the few watched pages that are due, while the day's write budget allows. */
export async function runWebWatch(env: Env, budget: Budget): Promise<Record<string, unknown>> {
  await ensureWatchTables(env);
  if ((await budget.used()) >= budget.limit * BUDGET_STOP) return { skipped: 'daily write budget nearly used' };
  const rows = await env.CATALOG_DB.prepare('SELECT * FROM web_watch WHERE deleted_at IS NULL AND paused = 0').all<WatchRow>();
  const due = pickDue(rows.results ?? [], Date.now());
  if (!due.length) return { due: 0 };
  const before = budget.written;
  const checks = [];
  for (const w of due) checks.push(await checkWatched(env, w, budget));
  await env.CATALOG_DB.prepare(
    'INSERT INTO web_watch_usage (day, checks, rows_written) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET checks = checks + excluded.checks, rows_written = rows_written + excluded.rows_written',
  )
    .bind(utcDay(), checks.length, budget.written - before + checks.length)
    .run();
  return { due: due.length, checks };
}
