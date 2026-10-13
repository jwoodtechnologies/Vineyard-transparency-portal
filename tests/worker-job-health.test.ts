import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { track } from '../worker/sync/checks';
import { countSource, jobHealth, publicError } from '../worker/sync/jobHealth';
import { handleHealthJobs } from '../worker/api/misc';

// Type-checked with the Worker project (tsconfig.worker.json): real schema, in-memory D1.

const fail = (msg: string) => async () => {
  throw new Error(msg);
};

describe('job health for the watchdog', () => {
  it('reports the old Worker CivicClerk check as covered by the GitHub ingest, never failing', async () => {
    const env = testEnv();
    for (let i = 0; i < 5; i++) await track(env, 'civicclerk', fail('CivicClerk 403 Forbidden'));
    const r = await jobHealth(env);
    expect(r.jobs.find((j) => j.id === 'civicclerk')).toMatchObject({ failing: false, consecutiveFailures: 0, status: 'covered', lastError: null });
  });

  it('counts failures in a row per check and resets on success', async () => {
    const env = testEnv();
    await track(env, 'utah-pmn', fail('fetch failed'));
    await track(env, 'utah-pmn', fail('fetch failed'));
    let r = await jobHealth(env);
    expect(r.jobs.find((j) => j.id === 'utah-pmn')).toMatchObject({ consecutiveFailures: 2, failing: false, lastError: 'fetch failed', lastSuccessAt: null });
    await track(env, 'utah-pmn', fail('HTTP 503 from https://www.utah.gov/pmn/search?token=abc123&x=1'));
    r = await jobHealth(env);
    const j = r.jobs.find((x) => x.id === 'utah-pmn')!;
    expect(j).toMatchObject({ consecutiveFailures: 3, failing: true });
    expect(j.lastError).toBe('HTTP 503 from https://www.utah.gov/pmn/search');
    expect(j.lastRunAt).toBe(j.lastErrorAt);
    await track(env, 'utah-pmn', async () => ({ notices: 2 }));
    r = await jobHealth(env);
    expect(r.jobs.find((x) => x.id === 'utah-pmn')).toMatchObject({ consecutiveFailures: 0, failing: false });
    expect(r.threshold).toBe(3);
  });

  it('counts source failures from status reports and the Worker syncs', async () => {
    const env = testEnv();
    const now = new Date().toISOString();
    env.CATALOG_DB.db
      .prepare(`INSERT INTO sources (id, name, base_url, source_type, authority, status, status_message, last_checked_at, created_at, updated_at) VALUES ('utah-pmn-vineyard', 'Utah Public Notice Website', 'https://www.utah.gov/pmn/', 'public_notice_system', 'State of Utah', 'unreachable', 'Error: connect ETIMEDOUT at /home/runner/work/ingest/gis.py:12', ?, ?, ?)`)
      .run(now, now, now);
    for (let i = 0; i < 3; i++) await countSource(env, 'utah-pmn-vineyard', false);
    let s = (await jobHealth(env)).sources[0];
    expect(s).toMatchObject({ id: 'utah-pmn-vineyard', consecutiveFailures: 3, failing: true, status: 'unreachable', lastErrorAt: now });
    expect(s.lastError).toBe('Error: connect ETIMEDOUT at [path]');
    await countSource(env, 'utah-pmn-vineyard', true);
    s = (await jobHealth(env)).sources[0];
    expect(s.consecutiveFailures).toBe(0);
  });

  it('serves the list publicly with a short cache time', async () => {
    const env = testEnv();
    await track(env, 'queue', async () => 1);
    const res = await handleHealthJobs(env);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await res.json()) as { jobs: Array<{ id: string }>; sources: unknown[] };
    expect(body.jobs.map((j) => j.id)).toEqual(['queue']);
  });

  it('keeps tokens, keys and paths out of error text', () => {
    expect(publicError('Bearer abcdefghijklmnop failed')).toBe('Bearer [hidden] failed');
    expect(publicError('bad api_key=sk-12345 and password: hunter22')).toBe('bad api_key=[hidden] and password: [hidden]');
    expect(publicError('ghp_abcdefghijklmnopqrstuvwxyz0123 leaked')).toBe('[hidden] leaked');
    expect(publicError('TypeError: x is undefined\n    at run (worker/sync/pmn.ts:12:3)')).toBe('TypeError: x is undefined');
    expect(publicError('failed reading worker/sync/pmn.ts:12')).toBe('failed reading [path]');
    expect(publicError('x'.repeat(400))!.length).toBe(302);
    expect(publicError(null)).toBeNull();
  });
});
