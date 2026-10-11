/**
 * robots.txt for every host the Worker reads (RFC 9309). Rules for our user agent token
 * ("VineyardTransparencyPortal") or "*" are honored; the longest matching rule wins. A missing or
 * refused robots.txt (4xx) means no restrictions; an unreachable one (5xx, network) means wait.
 * Each host's file is cached for 24 hours in D1.
 */
import type { Env } from '../env';
import { allowedBy, parseRobots, type Rule } from './robotsParse';

export { allowedBy, parseRobots };

const memo = new Map<string, { at: number; rules: Rule[] | 'deny' }>();

export async function robotsAllows(env: Env, url: string): Promise<boolean> {
  const u = new URL(url);
  const host = u.host.toLowerCase();
  let entry = memo.get(host);
  if (!entry || Date.now() - entry.at > 24 * 3600_000) {
    let body: string | null = null;
    let deny: boolean;
    try {
      await env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS robots_cache (host TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, status INTEGER, body TEXT)').run();
      const cached = await env.CATALOG_DB.prepare('SELECT fetched_at, status, body FROM robots_cache WHERE host = ?').bind(host).first<{ fetched_at: string; status: number; body: string | null }>();
      if (cached && Date.now() - Date.parse(cached.fetched_at) < 24 * 3600_000) {
        body = cached.body ?? '';
        deny = cached.status >= 500;
      } else {
        const res = await fetch(`${u.protocol}//${host}/robots.txt`, { headers: { 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org; public records archive)' } });
        deny = res.status >= 500;
        body = res.ok ? (await res.text()).slice(0, 200_000) : '';
        await env.CATALOG_DB.prepare('INSERT INTO robots_cache (host, fetched_at, status, body) VALUES (?, ?, ?, ?) ON CONFLICT(host) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, body = excluded.body')
          .bind(host, new Date().toISOString(), res.status, body)
          .run();
      }
    } catch {
      deny = true;
    }
    entry = { at: Date.now(), rules: deny ? 'deny' : parseRobots(body ?? '') };
    memo.set(host, entry);
  }
  if (entry.rules === 'deny') return false;
  return allowedBy(entry.rules, `${u.pathname}${u.search}`);
}

export class RobotsBlocked extends Error {
  constructor(url: string) {
    super(`robots.txt does not allow ${url.slice(0, 160)}`);
  }
}

export async function assertRobots(env: Env, url: string): Promise<void> {
  if (!(await robotsAllows(env, url))) throw new RobotsBlocked(url);
}
