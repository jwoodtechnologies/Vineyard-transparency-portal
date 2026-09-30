/** Short news items for the Latest page (Sheriff's Office releases about Vineyard). */
import type { Env } from '../env';

let ready = false;

export async function ensureNewsTables(env: Env): Promise<void> {
  if (ready) return;
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare(
      `CREATE TABLE IF NOT EXISTS news_items (
         id TEXT PRIMARY KEY,
         source TEXT NOT NULL,
         title TEXT NOT NULL,
         url TEXT NOT NULL,
         published_at TEXT NOT NULL,
         summary TEXT,
         mentions_vineyard INTEGER NOT NULL DEFAULT 0,
         checked INTEGER NOT NULL DEFAULT 0,
         fetched_at TEXT NOT NULL
       )`,
    ),
    env.CATALOG_DB.prepare('CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(source, published_at)'),
    env.CATALOG_DB.prepare(
      `CREATE TABLE IF NOT EXISTS cron_runs (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         started_at TEXT NOT NULL,
         finished_at TEXT,
         summary_json TEXT
       )`,
    ),
  ]);
  ready = true;
}
