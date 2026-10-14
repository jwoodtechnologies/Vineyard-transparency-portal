import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { describeCron, describeMinutes, nextCronRun, nextIntervalRun, workflowSchedule, wranglerCrons } from '../worker/lib/scheduleSources';
import { WORKER_CRONS, WORKFLOW_SCHEDULES } from '../worker/lib/schedules.generated';

describe('schedules read from the real settings', () => {
  it('match wrangler.jsonc and the workflows (run node scripts/gen-schedules.mjs after changing them)', () => {
    expect(WORKER_CRONS).toEqual(wranglerCrons(readFileSync('wrangler.jsonc', 'utf8')));
    const live = readdirSync('.github/workflows')
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => workflowSchedule(f, readFileSync(`.github/workflows/${f}`, 'utf8')))
      .filter(Boolean);
    expect(WORKFLOW_SCHEDULES).toEqual(live);
  });

  it('reads a schedule block with the comment above each cron', () => {
    const yml = `name: Ingest\non:\n  schedule:\n    # Nightly crawl\n    - cron: "17 9 * * *"\n    - cron: '*/10 * * * *'\n  workflow_dispatch:\n`;
    expect(workflowSchedule('x.yml', yml)).toEqual({ file: 'x.yml', name: 'Ingest', crons: [{ cron: '17 9 * * *', note: 'Nightly crawl' }, { cron: '*/10 * * * *', note: '' }] });
    expect(workflowSchedule('y.yml', 'name: CI\non:\n  push:\n')).toBeNull();
    expect(wranglerCrons('{ // x\n "triggers": { "crons": ["*/5 * * * *", "0 3 * * *"] } }')).toEqual(['*/5 * * * *', '0 3 * * *']);
  });
});

describe('cron in plain words', () => {
  it('says how often', () => {
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minutes');
    expect(describeCron('41 * * * *')).toBe('Hourly at :41');
    expect(describeCron('17 9 * * *')).toBe('Daily at 09:17 UTC');
    expect(describeCron('37 10 * * 1')).toBe('Weekly on Monday at 10:37 UTC');
    expect(describeCron('0 0 1 * *')).toBe('0 0 1 * *');
    expect(describeMinutes(15)).toBe('Every 15 minutes');
    expect(describeMinutes(60)).toBe('Hourly');
    expect(describeMinutes(360)).toBe('Every 6 hours');
    expect(describeMinutes(1440)).toBe('Daily');
  });

  it('finds the next run', () => {
    const from = new Date('2026-10-14T09:16:30Z');
    expect(nextCronRun('17 9 * * *', from)?.toISOString()).toBe('2026-10-14T09:17:00.000Z');
    expect(nextCronRun('17 9 * * *', new Date('2026-10-14T09:17:00Z'))?.toISOString()).toBe('2026-10-15T09:17:00.000Z');
    expect(nextCronRun('*/5 * * * *', from)?.toISOString()).toBe('2026-10-14T09:20:00.000Z');
    // 2026-10-14 is a Wednesday: the next Monday is the 19th.
    expect(nextCronRun('37 10 * * 1', from)?.toISOString()).toBe('2026-10-19T10:37:00.000Z');
    expect(nextIntervalRun(15, new Date('2026-10-14T09:16:00Z')).toISOString()).toBe('2026-10-14T09:30:00.000Z');
    expect(nextIntervalRun(60, new Date('2026-10-14T09:16:00Z')).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });
});
