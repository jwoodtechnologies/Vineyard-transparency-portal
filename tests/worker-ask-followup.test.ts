import { describe, expect, it } from 'vitest';
import { handleAsk } from '../worker/ai/rag';
import type { Env } from '../worker/env';
import type { ConvTurn } from '../worker/ai/followup';

// Type-checked with the Worker project (tsconfig.worker.json): it runs the real ask handler.
// The live tester's payload: the frontend sends this with stream: true.
const convo: ConvTurn[] = [
  { role: 'user', content: 'How much is the city spending on police and fire in the FY27 budget?' },
  {
    role: 'assistant',
    content:
      'In the fiscal year 2027 budget, Police is budgeted $4,705,075 and Fire $2,873,462 in the FY 27 Final Budget adopted June 23, 2026 [1]. Neither was changed by the First Budget Amendment of August 25, 2026 [2].',
  },
];

/** A catalog database that holds nothing: every read is empty, every write succeeds. */
function emptyDb() {
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) };
  return { prepare: () => stmt, batch: async () => [], exec: async () => ({}) };
}

async function ask(env: Partial<Env>, body: unknown) {
  const req = new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `t${Math.random()}` }, body: JSON.stringify(body) });
  const res = await handleAsk(env as Env, req);
  return res.json() as Promise<{ question: string; answer: string; engine: string; citations: Array<{ documentId: string }> }>;
}

describe('POST /api/ask with the live follow-up payload', () => {
  it('answers parks spending in FY27 from the budget data, on the streaming path, with no sources', async () => {
    const r = await ask({ CATALOG_DB: emptyDb() as never }, { question: 'and parks?', conversation: convo, stream: true });
    expect(r.question).toBe('How much is the city spending on parks in the FY27 budget?');
    expect(r.engine).toBe('budget-data');
    expect(r.answer).toContain('Parks: $956,369 in the FY 27 Final Budget adopted June 23, 2026, and $952,369 after the First Budget Amendment of August 25, 2026.');
    expect(r.answer).not.toMatch(/master plan/i);
    expect(r.citations.map((c) => c.documentId)).toEqual(['doc_2c248c52cbadfa22', 'doc_3931ec08b88d5fbf']);
  });

  it('does not let a model rewrite override the substitution', async () => {
    const calls: string[] = [];
    const AI = {
      run: async (model: string) => {
        calls.push(model);
        return { response: '{"followUp": true, "standalone": "When was the Parks and Recreation Master Plan adopted?", "facts": []}' };
      },
    };
    const r = await ask({ CATALOG_DB: emptyDb() as never, AI: AI as never }, { question: 'and parks?', conversation: convo, stream: true });
    expect(r.question).toBe('How much is the city spending on parks in the FY27 budget?');
    expect(r.engine).toBe('budget-data');
    expect(calls).toEqual([]);
  });
});
