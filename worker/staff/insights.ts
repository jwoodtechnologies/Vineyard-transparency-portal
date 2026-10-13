/**
 * Insights, Coverage and Health for owners and administrators of the staff portal. Nothing here changes
 * public content; the numbers come from the same functions the owner panel reads (worker/panel/routes.ts,
 * worker/lib/coverage.ts, worker/sync/jobHealth.ts, worker/ai/meter.ts). Visitor addresses are left out:
 * staff see counts and questions, not who asked.
 */
import { HttpError, json } from '../lib/http';
import { coverage, refreshCoverage } from '../lib/coverage';
import { neuronUsage } from '../ai/meter';
import { healthReport, recentFeedback, recentQuestions, summary } from '../panel/routes';
import { ensureActivityTables } from '../panel/store';
import { canManageUsers } from './core';
import type { StaffCall } from './modules';

const OWNED = /^\/(insights|coverage|health)\//;

/** How many of the latest questions and ratings the Insights screen lists. */
const LATEST = 30;

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

export async function insights(call: StaffCall): Promise<Response | null> {
  const { env, request, me, route } = call;
  if (!OWNED.test(route)) return null;
  if (!canManageUsers(me)) throw new HttpError(403, 'unauthorized', 'Only owners and administrators can see this.');

  if (request.method === 'GET') {
    if (route === '/insights/summary') {
      await ensureActivityTables(env);
      const [s, q, f] = await Promise.all([summary(env), recentQuestions(env, { before: Number.MAX_SAFE_INTEGER, limit: LATEST }), recentFeedback(env, { before: Number.MAX_SAFE_INTEGER, limit: LATEST })]);
      const questions = (q.items as Array<Record<string, unknown>>).map((r) => ({ id: r.id, at: r.at, question: r.question, status: r.status, up: num(r.up), down: num(r.down) }));
      const ratings = (f.items as Array<Record<string, unknown>>).map((r) => ({ id: r.id, at: r.at, vote: r.vote, question: r.question }));
      return json({ ...(s as Record<string, unknown>), questions, ratings });
    }
    if (route === '/coverage/report') return json(await coverage(env));
    if (route === '/health/report') return json({ ...(await healthReport(env)), ai: await neuronUsage(env).catch(() => null) });
    return null;
  }

  if (route === '/coverage/refresh') return json(await refreshCoverage(env));
  return null;
}
