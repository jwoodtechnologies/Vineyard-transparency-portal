/**
 * Every answer that did not come from the first model, counted by reason per UTC day, for the panel's
 * Health tab and /api/health. Counts only: no question or answer text is stored.
 */
import type { Env } from '../env';

/** Why an answer fell back, from its engine string; null when the first model wrote it. */
export function fallbackReason(engine: string | undefined | null): string | null {
  const e = engine ?? '';
  if (/^records \(/.test(e)) {
    if (/4006|neuron|quota|paused|suite allowance/i.test(e)) return 'AI allowance spent';
    if (/source check|no record/i.test(e)) return 'nothing passed the source check';
    if (/timeout/i.test(e)) return 'no model answered in time';
    return 'no model answered';
  }
  if (/\(retry after/.test(e)) return 'quiet retry answered';
  if (/\(after /.test(e)) return /timeout/i.test(e) ? 'first model slow, next model answered' : 'first model failed, next model answered';
  return null;
}

let ready = false;
async function ensure(env: Env): Promise<void> {
  if (ready) return;
  await env.CATALOG_DB.prepare('CREATE TABLE IF NOT EXISTS ai_fallbacks (day TEXT NOT NULL, reason TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, reason))').run();
  ready = true;
}

export async function logFallback(env: Env, reason: string, day = new Date().toISOString().slice(0, 10)): Promise<void> {
  await ensure(env);
  const who = env.AI_SPENDER === 'tests' ? `tests: ${reason}` : reason;
  await env.CATALOG_DB.prepare('INSERT INTO ai_fallbacks (day, reason, n) VALUES (?, ?, 1) ON CONFLICT (day, reason) DO UPDATE SET n = n + 1').bind(day, who).run();
}

/** Today's fallbacks by reason, most first. */
export async function fallbackCounts(env: Env, day = new Date().toISOString().slice(0, 10)): Promise<{ day: string; total: number; byReason: Array<{ reason: string; n: number }> }> {
  await ensure(env);
  const rows = (await env.CATALOG_DB.prepare('SELECT reason, n FROM ai_fallbacks WHERE day = ? ORDER BY n DESC').bind(day).all<{ reason: string; n: number }>()).results ?? [];
  return { day, total: rows.filter((r) => !r.reason.startsWith('tests: ')).reduce((a, r) => a + Number(r.n), 0), byReason: rows.map((r) => ({ reason: r.reason, n: Number(r.n) })) };
}
