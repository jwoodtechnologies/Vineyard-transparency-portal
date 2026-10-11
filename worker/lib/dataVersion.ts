/**
 * The archive's data version: one counter row that goes up whenever the five-minute check, the votes reader,
 * the ingest job (admin writes) or the owner's panel changes what the public pages show. Edge cache keys and
 * the stored page payloads (page_cache) carry it, so a cached copy is served until the data behind it changes,
 * and then refreshed in the background while the older copy is still served (stale-while-revalidate).
 *
 * Reading it costs no D1 read on most requests: the value is kept in the isolate for 30 seconds and in the
 * edge cache (free) for 30 seconds; D1 is read at most once per 30 seconds per location.
 */
import type { Env } from '../env';

const TTL_MS = 30_000;
const EDGE_KEY = 'https://edge.vineyardportal.internal/__data_version';
let memo: { v: number; at: number } | null = null;
let tableReady = false;

async function ensureTables(env: Env): Promise<void> {
  if (tableReady) return;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS data_version (id INTEGER PRIMARY KEY CHECK (id = 1), v INTEGER NOT NULL, changed_at TEXT NOT NULL)'),
    env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS page_cache (key TEXT PRIMARY KEY, version INTEGER NOT NULL, built_at TEXT NOT NULL, body TEXT NOT NULL, build TEXT)'),
  ]);
  // Tables made before payloads were keyed to the build gain the column (an error means it is already there).
  await env.CATALOG_DB.prepare('ALTER TABLE page_cache ADD COLUMN build TEXT')
    .run()
    .catch(() => undefined);
  tableReady = true;
}

const edge = (): Cache | null => {
  try {
    return (caches as unknown as { default: Cache }).default;
  } catch {
    return null;
  }
};

/** The current data version (0 before the first change is recorded). */
export async function dataVersion(env: Env): Promise<number> {
  const now = Date.now();
  if (memo && now - memo.at < TTL_MS) return memo.v;
  const cache = edge();
  const hit = cache ? await cache.match(EDGE_KEY).catch(() => undefined) : undefined;
  if (hit) {
    const v = Number(await hit.text());
    if (Number.isFinite(v)) {
      memo = { v, at: now };
      return v;
    }
  }
  // The table is created by the first change (bumpDataVersion); until then the version is 0.
  const row = await env.CATALOG_DB.prepare('SELECT v FROM data_version WHERE id = 1')
    .first<{ v: number }>()
    .catch(() => null);
  const v = Number(row?.v ?? 0);
  memo = { v, at: now };
  await cache?.put(EDGE_KEY, new Response(String(v), { headers: { 'cache-control': `public, max-age=${TTL_MS / 1000}` } })).catch(() => undefined);
  return v;
}

/** Records that public data changed. One row write. */
export async function bumpDataVersion(env: Env): Promise<number> {
  await ensureTables(env);
  const at = new Date().toISOString();
  const row = await env.CATALOG_DB.prepare('INSERT INTO data_version (id, v, changed_at) VALUES (1, 1, ?) ON CONFLICT(id) DO UPDATE SET v = v + 1, changed_at = excluded.changed_at RETURNING v')
    .bind(at)
    .first<{ v: number }>();
  const v = Number(row?.v ?? 0);
  memo = { v, at: Date.now() };
  await edge()?.put(EDGE_KEY, new Response(String(v), { headers: { 'cache-control': `public, max-age=${TTL_MS / 1000}` } })).catch(() => undefined);
  return v;
}

export interface StoredPage {
  version: number;
  builtAt: string;
  body: string;
  /** The Worker build that computed it (worker/lib/edgeCache.ts buildId); null for a payload stored before builds were recorded. */
  build: string | null;
}

/** A stored page payload (one row read), or null. */
export async function readPage(env: Env, key: string): Promise<StoredPage | null> {
  try {
    const row = await env.CATALOG_DB.prepare('SELECT version, built_at, body, build FROM page_cache WHERE key = ?').bind(key).first<{ version: number; built_at: string; body: string; build: string | null }>();
    return row ? { version: Number(row.version), builtAt: row.built_at, body: row.body, build: row.build ?? null } : null;
  } catch {
    return null;
  }
}

/** Stores a page payload for a data version and build (one row write). */
export async function writePage(env: Env, key: string, version: number, body: string, build: string | null = null): Promise<void> {
  await ensureTables(env);
  await env.CATALOG_DB.prepare(
    'INSERT INTO page_cache (key, version, built_at, body, build) VALUES (?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET version = excluded.version, built_at = excluded.built_at, body = excluded.body, build = excluded.build',
  )
    .bind(key, version, new Date().toISOString(), body, build)
    .run();
}
