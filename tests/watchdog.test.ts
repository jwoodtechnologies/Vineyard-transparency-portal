import { describe, expect, it } from 'vitest';
import { MARKER, evaluate, failureStreak, lastNoteAt, plan, type Health, type Run } from '../scripts/watchdog/lib.mjs';

const BASE = 'https://vineyardportal.org';
const REPO = 'owner/repo';
const NOW = Date.parse('2026-10-11T12:41:00Z');

const health = (pmnFailures: number, extra: Partial<Health> = {}): Health => ({
  jobs: [
    { id: 'queue', consecutiveFailures: 0, failing: false, lastRunAt: '2026-10-11T12:35:00Z', lastSuccessAt: '2026-10-11T12:35:00Z', lastErrorAt: null, lastError: null },
    {
      id: 'utah-pmn',
      consecutiveFailures: pmnFailures,
      failing: pmnFailures >= 3,
      lastRunAt: '2026-10-11T12:30:00Z',
      lastSuccessAt: '2026-10-11T11:00:00Z',
      lastErrorAt: '2026-10-11T12:30:00Z',
      lastError: 'HTTP 503 from https://www.utah.gov/pmn/search',
    },
  ],
  sources: [{ id: 'utah-pmn-vineyard', name: 'Utah Public Notice Website', status: 'active', consecutiveFailures: 0, failing: false, lastRunAt: '2026-10-11T12:30:00Z', lastSuccessAt: '2026-10-11T12:30:00Z', lastErrorAt: null, lastError: null }],
  ...extra,
});

const run = (id: number, conclusion: string | null): Run => ({ id, status: 'completed', conclusion, html_url: `https://github.com/${REPO}/actions/runs/${id}`, run_started_at: '2026-10-10T22:53:00Z' });

describe('watchdog', () => {
  it('opens one issue for a job failing three times in a row, with the error and timestamps', () => {
    const items = evaluate({ health: health(3), chatRun: run(9, 'success'), ingestRuns: [run(3, 'success')], repo: REPO, base: BASE });
    const actions = plan(items, [], NOW);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'create', title: 'Watchdog: utah-pmn failing' });
    expect(actions[0].body).toContain('has failed 3 times in a row');
    expect(actions[0].body).toContain('Last error: HTTP 503 from https://www.utah.gov/pmn/search');
    expect(actions[0].body).toContain('Last error at: 2026-10-11 12:30 UTC');
    expect(actions[0].body).toContain('Last success: 2026-10-11 11:00 UTC');
    expect(actions[0].body).toContain(MARKER);
    expect(actions[0].body).not.toMatch(/[–—]/);
  });

  it('does nothing below three failures', () => {
    expect(plan(evaluate({ health: health(2), chatRun: null, ingestRuns: null, repo: REPO, base: BASE }), [], NOW)).toEqual([]);
  });

  it('is idempotent: an open issue gets at most one comment a day while still failing', () => {
    const items = evaluate({ health: health(5), chatRun: null, ingestRuns: null, repo: REPO, base: BASE });
    expect(plan(items, [{ number: 7, title: 'Watchdog: utah-pmn failing', lastNoteAt: '2026-10-11T01:00:00Z' }], NOW)).toEqual([]);
    const later = plan(items, [{ number: 7, title: 'Watchdog: utah-pmn failing', lastNoteAt: '2026-10-10T12:00:00Z' }], NOW);
    expect(later).toHaveLength(1);
    expect(later[0]).toMatchObject({ type: 'comment', number: 7 });
    expect(later[0].body).toContain('Still failing at 2026-10-11 12:41 UTC');
  });

  it('closes the issue with a comment when the job recovers, even if it failed again since', () => {
    for (const n of [0, 1]) {
      const actions = plan(evaluate({ health: health(n), chatRun: null, ingestRuns: null, repo: REPO, base: BASE }), [{ number: 7, title: 'Watchdog: utah-pmn failing', lastNoteAt: '2026-10-11T12:00:00Z' }], NOW);
      expect(actions).toEqual([expect.objectContaining({ type: 'close', number: 7 })]);
      expect(actions[0].body).toContain('Recovered at 2026-10-11 12:41 UTC');
    }
  });

  it('marks sources by title so a source and a job never share an issue', () => {
    const h = health(0);
    h.sources[0] = { ...h.sources[0], status: 'unreachable', consecutiveFailures: 4, failing: true, lastError: 'fetch failed', lastErrorAt: '2026-10-11T12:30:00Z' };
    const actions = plan(evaluate({ health: h, chatRun: null, ingestRuns: null, repo: REPO, base: BASE }), [], NOW);
    expect(actions.map((a) => a.title)).toEqual(['Watchdog: source utah-pmn-vineyard failing']);
    expect(actions[0].body).toContain('Source `utah-pmn-vineyard` (Utah Public Notice Website)');
    expect(actions[0].body).toContain('Status: unreachable');
  });

  it('opens an issue when the nightly chat suite fails and closes it when a later run passes', () => {
    const failing = plan(evaluate({ health: null, chatRun: run(42, 'failure'), ingestRuns: null, repo: REPO, base: BASE }), [], NOW, false);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ type: 'create', title: 'Watchdog: chat suite failing' });
    expect(failing[0].body).toContain(`https://github.com/${REPO}/blob/diagnostics/suite/42/results.json`);
    const open = [{ number: 8, title: 'Watchdog: chat suite failing', lastNoteAt: '2026-10-10T23:00:00Z' }];
    expect(plan(evaluate({ health: null, chatRun: run(43, 'success'), ingestRuns: null, repo: REPO, base: BASE }), open, NOW, false)).toEqual([expect.objectContaining({ type: 'close', number: 8 })]);
    // A cancelled run says nothing either way.
    expect(plan(evaluate({ health: null, chatRun: run(44, 'cancelled'), ingestRuns: null, repo: REPO, base: BASE }), open, NOW, false)).toEqual([]);
  });

  it('counts scheduled ingest failures in a row, skipping cancelled runs', () => {
    const runs = [run(5, 'failure'), run(4, 'cancelled'), run(3, 'failure'), run(2, 'timed_out'), run(1, 'success')];
    expect(failureStreak(runs)).toBe(3);
    expect(failureStreak([run(2, 'failure'), run(1, 'success')])).toBe(1);
    const actions = plan(evaluate({ health: null, chatRun: null, ingestRuns: runs, repo: REPO, base: BASE }), [], NOW, false);
    expect(actions).toEqual([expect.objectContaining({ type: 'create', title: 'Watchdog: ingest workflow failing' })]);
  });

  it('closes an issue for a job no longer listed only when the health list was read', () => {
    const open = [{ number: 9, title: 'Watchdog: old-check failing', lastNoteAt: '2026-10-11T00:00:00Z' }];
    expect(plan(evaluate({ health: health(0), chatRun: null, ingestRuns: null, repo: REPO, base: BASE }), open, NOW, true)).toEqual([expect.objectContaining({ type: 'close', number: 9 })]);
    expect(plan(evaluate({ health: null, chatRun: null, ingestRuns: null, repo: REPO, base: BASE }), open, NOW, false)).toEqual([]);
  });

  it('dates the last note from the newest watchdog comment', () => {
    expect(lastNoteAt({ created_at: '2026-10-01T00:00:00Z' }, [{ body: `${MARKER}\nStill failing`, created_at: '2026-10-05T00:00:00Z' }, { body: 'a person', created_at: '2026-10-06T00:00:00Z' }])).toBe('2026-10-05T00:00:00Z');
    expect(lastNoteAt({ created_at: '2026-10-01T00:00:00Z' }, [])).toBe('2026-10-01T00:00:00Z');
  });
});

describe('quiet checks', () => {
  it('never reports the CivicClerk check refused by Cloudflare, and closes its issue', () => {
    const items = evaluate({ health: { jobs: [{ id: 'civicclerk', consecutiveFailures: 40, failing: true, lastRunAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: 'HTTP 403' }], sources: [] }, chatRun: null, ingestRuns: null, repo: 'o/r', base: 'https://x' });
    expect(items.find((i: { key: string }) => i.key === 'job:civicclerk')?.failing).toBe(false);
    const actions = plan(items, [{ number: 12, title: 'Watchdog: civicclerk failing', lastNoteAt: null }], Date.now(), true);
    expect(actions.some((a: { type: string; number?: number }) => a.type === 'close' && a.number === 12)).toBe(true);
  });
});
