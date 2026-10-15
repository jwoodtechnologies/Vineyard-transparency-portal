/**
 * Google Street View mode on the map (a Google map beside a Google panorama, as Google's terms require).
 * The Maps JavaScript API key lives only in the Worker variable GOOGLE_MAPS_KEY (Cloudflare dashboard,
 * kept across deploys by keep_vars), never in the repository. The mode is offered only while the key is set
 * and today's opens are under the cap (GOOGLE_SV_DAILY_CAP, default 150 a day: about 4,650 a month, inside
 * Google's free monthly use of dynamic Street View). Each open is counted here before the key is handed out,
 * so the cap holds even if the config answer is a few minutes old.
 *
 *   GET  /api/streetview/config       → { token, google }   google: true while the mode can be opened
 *   POST /api/streetview/google/open  → { key, used, cap }  or 429 once today's cap is reached
 */
import { HttpError, json } from './http';

export const DEFAULT_GOOGLE_CAP = 150;

interface GoogleEnv {
  CATALOG_DB: D1Database;
  GOOGLE_MAPS_KEY?: string;
  GOOGLE_SV_DAILY_CAP?: string;
}

/** A browser key for the Maps JavaScript API: letters, digits, dashes and underscores (Google's start "AIza"). */
const KEY = /^[A-Za-z0-9_-]{20,100}$/;

export function googleKey(v: string | undefined | null): string | null {
  const k = (v ?? '').trim();
  return KEY.test(k) ? k : null;
}

/** The daily cap from GOOGLE_SV_DAILY_CAP: a whole number from 0 to 10,000, else the default. */
export function googleCap(v: string | undefined | null): number {
  const t = (v ?? '').trim();
  if (!/^\d{1,5}$/.test(t)) return DEFAULT_GOOGLE_CAP;
  const n = Number(t);
  return n <= 10_000 ? n : DEFAULT_GOOGLE_CAP;
}

/** The day the count belongs to (UTC). */
export const capDay = (now: Date) => now.toISOString().slice(0, 10);

async function ensureTable(env: GoogleEnv): Promise<void> {
  await env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS google_sv_usage (day TEXT PRIMARY KEY, opens INTEGER NOT NULL DEFAULT 0)').run();
}

export async function googleOpensOn(env: GoogleEnv, day: string): Promise<number> {
  await ensureTable(env);
  const r = await env.CATALOG_DB.prepare('SELECT opens FROM google_sv_usage WHERE day = ?').bind(day).first<{ opens: number }>();
  return Number(r?.opens ?? 0);
}

/** True while the mode can be opened today. */
export async function googleAvailable(env: GoogleEnv, now = new Date()): Promise<boolean> {
  if (!googleKey(env.GOOGLE_MAPS_KEY)) return false;
  const cap = googleCap(env.GOOGLE_SV_DAILY_CAP);
  if (cap === 0) return false;
  try {
    return (await googleOpensOn(env, capDay(now))) < cap;
  } catch {
    return false;
  }
}

/**
 * Counts one open and hands out the key, or refuses once today's cap is reached. The count and the check
 * are one statement, so two opens at the same moment cannot both take the last place.
 */
export async function openGoogle(env: GoogleEnv, now = new Date()): Promise<Response> {
  const key = googleKey(env.GOOGLE_MAPS_KEY);
  if (!key) throw new HttpError(404, 'not_found', 'Google Street View is not set up.');
  const cap = googleCap(env.GOOGLE_SV_DAILY_CAP);
  await ensureTable(env);
  const day = capDay(now);
  const row =
    cap > 0
      ? await env.CATALOG_DB.prepare(
          'INSERT INTO google_sv_usage (day, opens) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET opens = opens + 1 WHERE opens < ?2 RETURNING opens',
        )
          .bind(day, cap)
          .first<{ opens: number }>()
      : null;
  if (!row) return json({ error: 'cap', message: 'Google Street View has reached its limit for today. It is back tomorrow.', cap }, { status: 429 });
  return json({ key, used: Number(row.opens), cap });
}
