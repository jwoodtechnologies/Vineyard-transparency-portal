import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { DAILY_ALLOWANCE, SUITE_HEADER, TESTS_SPENT, aiResumesAt, estimateNeurons, meteredRun, neuronCaps, neuronUsage, requestSpender, spenderEnv, type MeterEnv } from '../worker/ai/meter';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
/** About 18 Neurons at the fp8 rates: about 1,000 input tokens and 400 output. */
const INPUT = { messages: [{ role: 'user', content: 'x'.repeat(3500) }], max_tokens: 400 };
const NOW = new Date('2026-10-11T18:00:00Z');
/** The pattern worker/ai/rag.ts uses to open the answer breaker for everyone. */
const BREAKER = /4006|daily free allocation|neuron|quota/i;

function env(extra: Partial<MeterEnv> = {}) {
  let calls = 0;
  const e = { ...testEnv(), AI: { run: async () => ((calls += 1), { response: 'ok' }) }, ...extra } as unknown as MeterEnv & { CATALOG_DB: { prepare: (s: string) => { bind: (...v: unknown[]) => { run: () => Promise<unknown> } } } };
  return { e, calls: () => calls };
}
const tests = (e: MeterEnv): MeterEnv => ({ ...e, AI_SPENDER: 'tests' });
const ask = (headers: Record<string, string> = {}) => new Request('https://portal.test/api/ask', { method: 'POST', headers });

describe('neuron caps', () => {
  it('defaults to 9,000 for residents and 1,000 for the chat suite', () => {
    expect(neuronCaps({})).toEqual({ public: 9000, tests: 1000, total: 10000 });
  });

  it('never lets the caps add up past the 10,000 included', () => {
    expect(neuronCaps({ AI_NEURONS_PUBLIC_PER_DAY: '9800', AI_NEURONS_TESTS_PER_DAY: '1000' })).toEqual({ public: 9000, tests: 1000, total: 10000 });
    expect(neuronCaps({ AI_NEURONS_PUBLIC_PER_DAY: '9000', AI_NEURONS_TESTS_PER_DAY: '50000' })).toEqual({ public: 0, tests: DAILY_ALLOWANCE, total: DAILY_ALLOWANCE });
    expect(neuronCaps({ AI_NEURONS_PUBLIC_PER_DAY: '5000', AI_NEURONS_TESTS_PER_DAY: '500' })).toEqual({ public: 5000, tests: 500, total: 5500 });
    expect(neuronCaps({ AI_NEURONS_PUBLIC_PER_DAY: 'lots', AI_NEURONS_TESTS_PER_DAY: '' })).toEqual({ public: 9000, tests: 1000, total: 10000 });
  });
});

describe('meteredRun by spender', () => {
  it('bills residents and the suite to their own buckets', async () => {
    const { e, calls } = env();
    await meteredRun(e, MODEL, INPUT, NOW);
    await meteredRun(tests(e), MODEL, INPUT, NOW);
    await meteredRun(tests(e), MODEL, INPUT, NOW);
    const u = await neuronUsage(e, NOW);
    expect(calls()).toBe(3);
    const one = estimateNeurons(MODEL, INPUT);
    expect(u.public.used).toBeCloseTo(one, 1);
    expect(u.tests.used).toBeCloseTo(2 * one, 1);
    expect(u.total.used).toBeCloseTo(3 * one, 1);
    expect(u.day).toBe('2026-10-11');
    // The next UTC day starts empty.
    expect((await neuronUsage(e, new Date('2026-10-12T00:00:01Z'))).total.used).toBe(0);
  });

  it('refuses the suite at its cap without opening the breaker, and residents keep answering', async () => {
    const { e, calls } = env({ AI_NEURONS_TESTS_PER_DAY: '40' });
    await meteredRun(tests(e), MODEL, INPUT, NOW);
    await meteredRun(tests(e), MODEL, INPUT, NOW);
    const refused = await meteredRun(tests(e), MODEL, INPUT, NOW).then(
      () => null,
      (err: Error) => err,
    );
    expect(refused?.message).toContain(TESTS_SPENT);
    expect(refused?.message).not.toMatch(BREAKER);
    expect(calls()).toBe(2);
    await meteredRun(e, MODEL, INPUT, NOW);
    expect(calls()).toBe(3);
    const u = await neuronUsage(e, NOW);
    expect(u.tests.used).toBeLessThanOrEqual(40);
    expect(u.public.used).toBeGreaterThan(0);
  });

  it('refuses residents at the public cap with a quota error, and the suite bucket is untouched', async () => {
    const { e, calls } = env({ AI_NEURONS_PUBLIC_PER_DAY: '20' });
    await meteredRun(e, MODEL, INPUT, NOW);
    await expect(meteredRun(e, MODEL, INPUT, NOW)).rejects.toThrow(/^4006: daily neuron cap reached \(18 of 20\)/);
    expect(calls()).toBe(1);
    await meteredRun(tests(e), MODEL, INPUT, NOW);
    expect(calls()).toBe(2);
  });

  it('never records more than the 10,000 included, whatever the spenders', async () => {
    const { e } = env();
    // Both buckets just under their caps (neuronUsage adds the meter columns on first use).
    await neuronUsage(e, NOW);
    await e.CATALOG_DB.prepare('INSERT INTO quota_usage (day, ai_neurons, ai_neurons_tests, updated_at) VALUES (?, 9990, 995, ?)').bind('2026-10-11', NOW.toISOString()).run();
    await expect(meteredRun(e, MODEL, INPUT, NOW)).rejects.toThrow(/4006/);
    await expect(meteredRun(tests(e), MODEL, INPUT, NOW)).rejects.toThrow(TESTS_SPENT);
    const u = await neuronUsage(e, NOW);
    expect(u.total.used).toBe(9990);
    expect(u.total.used).toBeLessThanOrEqual(DAILY_ALLOWANCE);
  });

  it('runs unmetered only when there is no database (unit tests of the answer path)', async () => {
    let n = 0;
    await meteredRun({ AI: { run: async () => (n += 1) } }, MODEL, INPUT, NOW);
    expect(n).toBe(1);
  });
});

describe('spender of a request', () => {
  it('is the suite only with x-vtp-suite: 1', () => {
    expect(SUITE_HEADER).toBe('x-vtp-suite');
    expect(requestSpender(ask({ 'x-vtp-suite': '1' }))).toBe('tests');
    expect(requestSpender(ask({ 'x-vtp-suite': '0' }))).toBe('public');
    expect(requestSpender(ask())).toBe('public');
  });

  it('gives a suite request its own copy of the environment, and leaves residents on the shared one', async () => {
    const { e } = env();
    expect(await spenderEnv(e, ask(), NOW)).toBe(e);
    const t = await spenderEnv(e, ask({ 'x-vtp-suite': '1' }), NOW);
    expect(t).not.toBe(e);
    expect(t.AI_SPENDER).toBe('tests');
    expect(t.AI_ENABLED).toBeUndefined();
    expect(e.AI_SPENDER).toBeUndefined();
  });

  it('turns the model off for a suite request once the suite bucket is spent', async () => {
    const { e, calls } = env({ AI_NEURONS_TESTS_PER_DAY: '0' });
    await expect(meteredRun(tests(e), MODEL, INPUT, NOW)).rejects.toThrow(TESTS_SPENT);
    expect(calls()).toBe(0);
    const t = await spenderEnv(e, ask({ 'x-vtp-suite': '1' }), NOW);
    expect(t.AI_ENABLED).toBe('false');
    expect((await spenderEnv(e, ask(), NOW)).AI_ENABLED).toBeUndefined();
  });
});

describe('aiResumesAt', () => {
  it('is the next 00:00 UTC: 6 PM Mountain in daylight time, 5 PM in standard time', () => {
    expect(aiResumesAt(new Date('2026-10-11T18:00:00Z'))).toEqual({ iso: '2026-10-12T00:00:00.000Z', mountainLabel: '6 PM Mountain' });
    expect(aiResumesAt(new Date('2026-12-03T23:59:59Z'))).toEqual({ iso: '2026-12-04T00:00:00.000Z', mountainLabel: '5 PM Mountain' });
    // Just after the reset, the next one is a day away.
    expect(aiResumesAt(new Date('2026-07-01T00:00:00Z')).iso).toBe('2026-07-02T00:00:00.000Z');
  });

  it('is reported with the usage', async () => {
    const { e } = env();
    const u = await neuronUsage(e, NOW);
    expect(u.resetsAt).toBe('2026-10-12T00:00:00.000Z');
    expect(u.resetsAtMountain).toBe('6 PM Mountain');
    expect(u.public.cap).toBe(9000);
    expect(u.tests.cap).toBe(1000);
    expect(u.total).toEqual({ used: 0, cap: 10000, allowance: 10000 });
  });
});
