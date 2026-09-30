/**
 * Site activity log for the owner's private panel: page visits, questions asked, and thumbs up or
 * down on answers. Stored in the catalog D1 database and kept permanently. The public page footer
 * says visits and questions (with IP address) are logged. Two guards keep the site safe on the free
 * tier: a daily cap on activity writes, and a storage ceiling (logging pauses if the database nears
 * the 500 MB free-tier limit, so the records archive can never be crowded out).
 */
import type { Env } from '../env';
import { PASSKEY_SCHEMA } from './passkey';

const DAILY_EVENT_CAP = 20_000;
export const STORAGE_CEILING_BYTES = 420_000_000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS activity_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, ip TEXT, country TEXT, region TEXT, city TEXT,
    path TEXT, referrer TEXT, user_agent TEXT, device TEXT, is_bot INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS idx_activity_visits_at ON activity_visits(at)',
  `CREATE TABLE IF NOT EXISTS activity_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ask_id TEXT, at TEXT NOT NULL, ip TEXT, country TEXT, city TEXT,
    question TEXT NOT NULL, status TEXT, mode TEXT, engine TEXT, citations INTEGER, latency_ms INTEGER, answer TEXT)`,
  'CREATE INDEX IF NOT EXISTS idx_activity_questions_at ON activity_questions(at)',
  'CREATE INDEX IF NOT EXISTS idx_activity_questions_ask ON activity_questions(ask_id)',
  `CREATE TABLE IF NOT EXISTS activity_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ask_id TEXT NOT NULL, at TEXT NOT NULL, ip TEXT, vote TEXT NOT NULL,
    question TEXT, answer TEXT, UNIQUE(ask_id, ip))`,
  'CREATE INDEX IF NOT EXISTS idx_activity_feedback_at ON activity_feedback(at)',
  `CREATE TABLE IF NOT EXISTS panel_owner (
    id INTEGER PRIMARY KEY CHECK (id = 1), email TEXT NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
    iterations INTEGER NOT NULL, session_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS panel_setup (code_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS panel_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, at TEXT NOT NULL, ok INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_panel_attempts_at ON panel_attempts(at)',
  ...PASSKEY_SCHEMA,
];

export const ACTIVITY_SCHEMA = SCHEMA;

let ready: Promise<void> | null = null;
export function ensureActivityTables(env: Env): Promise<void> {
  ready ??= env.CATALOG_DB.batch(SCHEMA.map((s) => env.CATALOG_DB.prepare(s)))
    .then(() => undefined)
    .catch((e: unknown) => {
      ready = null;
      throw e;
    });
  return ready;
}

// Per-isolate write counter (refreshed from D1 every few minutes) and hourly cleanup.
let counter = { day: '', count: 0, checkedAt: 0 };
let lastCleanup = 0;

async function allowWrite(env: Env): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  if (counter.day !== day || now - counter.checkedAt > 5 * 60_000) {
    const since = `${day}T00:00:00.000Z`;
    const r = await env.CATALOG_DB.prepare(
      'SELECT (SELECT count(*) FROM activity_visits WHERE at >= ?1) + (SELECT count(*) FROM activity_questions WHERE at >= ?1) + (SELECT count(*) FROM activity_feedback WHERE at >= ?1) AS n',
    )
      .bind(since)
      .first<{ n: number }>();
    counter = { day, count: Number(r?.n ?? 0), checkedAt: now };
  }
  if (counter.count >= DAILY_EVENT_CAP) return false;
  counter.count++;
  return true;
}

/** Housekeeping for short-lived security rows only; activity itself is never deleted. */
async function maybeCleanup(env: Env): Promise<void> {
  if (Date.now() - lastCleanup < 3600_000) return;
  lastCleanup = Date.now();
  const now = new Date().toISOString();
  await env.CATALOG_DB.batch([
    env.CATALOG_DB.prepare('DELETE FROM panel_attempts WHERE at < ?').bind(new Date(Date.now() - 2 * 86_400_000).toISOString()),
    env.CATALOG_DB.prepare('DELETE FROM panel_setup WHERE expires_at < ?').bind(now),
    env.CATALOG_DB.prepare('DELETE FROM panel_challenges WHERE expires_at < ?').bind(now),
  ]);
}

let storageFull = false;
let lastSize = 0;
export const databaseBytes = () => lastSize;

export interface Who {
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
}

export function who(request: Request): Who {
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf ?? {};
  const s = (v: unknown, n = 120) => (typeof v === 'string' && v ? v.slice(0, n) : null);
  return {
    ip: s(request.headers.get('cf-connecting-ip'), 64),
    country: s(cf.country, 8),
    region: s(cf.region, 80),
    city: s(cf.city, 80),
    userAgent: s(request.headers.get('user-agent'), 300),
  };
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|python-requests|curl|wget|httpclient|monitor/i;

export function deviceOf(ua: string | null): string {
  if (!ua) return 'Unknown';
  if (BOT.test(ua)) return 'Bot';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const kind = /Mobile|iPhone|Android/.test(ua) ? 'phone' : /iPad|Tablet/.test(ua) ? 'tablet' : 'desktop';
  return `${br} on ${os} (${kind})`;
}

async function write(env: Env, stmt: () => D1PreparedStatement): Promise<void> {
  try {
    await ensureActivityTables(env);
    if (storageFull || !(await allowWrite(env))) return;
    const r = await stmt().run();
    const size = Number((r.meta as { size_after?: number } | undefined)?.size_after ?? 0);
    if (size) {
      lastSize = size;
      storageFull = size > STORAGE_CEILING_BYTES;
    }
    await maybeCleanup(env);
  } catch (e) {
    console.error(JSON.stringify({ event: 'activity_log_failed', message: e instanceof Error ? e.message : String(e) }));
  }
}

export function logVisit(env: Env, w: Who, path: string, referrer: string | null): Promise<void> {
  const ua = w.userAgent;
  return write(env, () =>
    env.CATALOG_DB.prepare(
      'INSERT INTO activity_visits (at, ip, country, region, city, path, referrer, user_agent, device, is_bot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(new Date().toISOString(), w.ip, w.country, w.region, w.city, path.slice(0, 300), referrer?.slice(0, 300) ?? null, ua, deviceOf(ua), ua && BOT.test(ua) ? 1 : 0),
  );
}

export interface QuestionLog {
  askId: string;
  question: string;
  status: string;
  mode: string | null;
  engine: string;
  citations: number;
  latencyMs: number;
  answer: string;
}

export function logQuestion(env: Env, w: Who, q: QuestionLog): Promise<void> {
  return write(env, () =>
    env.CATALOG_DB.prepare(
      'INSERT INTO activity_questions (ask_id, at, ip, country, city, question, status, mode, engine, citations, latency_ms, answer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(q.askId, new Date().toISOString(), w.ip, w.country, w.city, q.question.slice(0, 1000), q.status, q.mode, q.engine, q.citations, q.latencyMs, q.answer.slice(0, 1500)),
  );
}

export function logFeedback(env: Env, w: Who, askId: string, vote: 'up' | 'down', question: string, answer: string): Promise<void> {
  return write(env, () =>
    env.CATALOG_DB.prepare(
      `INSERT INTO activity_feedback (ask_id, at, ip, vote, question, answer) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ask_id, ip) DO UPDATE SET vote = excluded.vote, at = excluded.at`,
    ).bind(askId, new Date().toISOString(), w.ip ?? '', vote, question.slice(0, 1000), answer.slice(0, 1500)),
  );
}
