import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { handleAsk, RAG_SYSTEM_PROMPT } from '../worker/ai/rag';
import { SearchRepository } from '../worker/search/SearchRepository';
import { priorPassageScore } from '../worker/ai/followup';
import type { Env } from '../worker/env';

// Type-checked with the Worker project (tsconfig.worker.json): it runs the real ask handler over a real
// (in-memory) search shard, with Workers AI stood in for.

const URA_TITLE = 'RDA Resolution U-2010-05 Adopting The Draft Geneva Urban Renewal Project Area Budget';
// doc_6a0c9a6544266140 page 6, as quoted in tests/chat-suite/cases.json (source "ura-budget").
const URA_P6 = 'PROJECTED TAX INCREMENT REVENUE The Project Area development projections anticipate generating $415 million in tax increment revenues. The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million.';

const TURN1 = 'What share of the Geneva urban renewal tax increment does the Redevelopment Agency capture?';
const convo = [
  { role: 'user', content: TURN1 },
  { role: 'assistant', content: 'The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million [1].', sources: [URA_TITLE] },
];

async function seed() {
  const env = testEnv();
  // The meter adds this column once per isolate; each test here has a fresh database.
  env.CATALOG_DB.db.exec("ALTER TABLE quota_usage ADD COLUMN ai_neurons REAL NOT NULL DEFAULT 0");
  const repo = new SearchRepository(env);
  const doc = (id: string, title: string, date: string) => ({ documentId: id, title, documentType: 'resolution', documentNumber: null, documentDate: date, year: Number(date.slice(0, 4)), governmentBodyId: 'redevelopment-agency', sourceId: 'vineyard-city', meetingId: null, categories: [], currency: 'historical' });
  await repo.replaceDocument(0, doc('doc_6a0c9a6544266140', URA_TITLE, '2010-04-28'), [
    { id: 'doc_6a0c9a6544266140:5', pageStart: 5, pageEnd: 5, sectionTitle: null, text: 'PROJECT AREA DESCRIPTION The project area covers the former Geneva Steel site.' },
    { id: 'doc_6a0c9a6544266140:6', pageStart: 6, pageEnd: 6, sectionTitle: null, text: URA_P6 },
  ]);
  // Records that match the follow-up's words far better than the budget page does, so a plain search
  // never brings that page back.
  for (let i = 0; i < 45; i++) {
    await repo.replaceDocument(0, doc(`doc_decoy${i}`, `Geneva urban renewal share report ${i}`, '2020-01-01'), [
      { id: `doc_decoy${i}:1`, pageStart: 1, pageEnd: 1, sectionTitle: null, text: `Is there a cap on what it can collect? Geneva urban renewal tax increment share Redevelopment Agency capture cap collect share capture collect cap. Item ${i}.` },
    ]);
  }
  return env;
}

/** Workers AI: the rewrite and the search plan fail, the reranker keeps the order, and the answer is `write(sources)`. */
function ai(write: (user: string) => string) {
  return {
    run: async (_model: string, input: Record<string, unknown>) => {
      if (typeof input.query === 'string') return { response: (input.contexts as unknown[]).map((_, i) => ({ id: i, score: 0.9 - i * 0.001 })) };
      const msgs = (input.messages ?? []) as Array<{ role: string; content: string }>;
      if (msgs[0]?.content.startsWith(RAG_SYSTEM_PROMPT.slice(0, 60))) return { response: write(msgs[msgs.length - 1].content) };
      return { response: 'not json' };
    },
  };
}

/** The [n] of the source whose text holds `needle`, or 1. */
const sourceWith = (user: string, needle: string) => {
  for (const m of user.matchAll(/\[(\d+)\][^\n]*\n<<<\n([\s\S]*?)\n>>>/g)) if (m[2].includes(needle)) return Number(m[1]);
  return 1;
};

async function ask(env: Env, body: unknown) {
  const req = new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `t${Math.random()}` }, body: JSON.stringify(body) });
  const res = await handleAsk(env, req);
  return res.json() as Promise<{ answer: string; engine: string; citations: Array<{ documentId: string; page: number | null }>; relatedDocuments: Array<{ id: string }> }>;
}

describe('a follow-up reads the records the previous answer cited', () => {
  it('keeps "a cap of $300 million" on the Geneva URA follow-up, cited to the project area budget page', async () => {
    const env = await seed();
    const r = await ask({ ...env, AI: ai((u) => `Yes. The Redevelopment Agency has a cap of $300 million on the tax increment it can collect [${sourceWith(u, '$300 million')}].`) } as unknown as Env, { question: 'Is there a cap on what it can collect?', conversation: convo });
    expect(r.answer).toContain('$300 million');
    expect(r.answer).not.toMatch(/couldn't find/);
    expect(r.citations).toEqual([expect.objectContaining({ documentId: 'doc_6a0c9a6544266140', page: 6 })]);
  });

  it('still removes a figure no record states, and the fallback carries the closest records as cards', async () => {
    const env = await seed();
    const r = await ask({ ...env, AI: ai(() => 'The Redevelopment Agency has a cap of $900 million on the tax increment [1].') } as unknown as Env, { question: 'Is there a cap on what it can collect?', conversation: convo });
    expect(r.answer).toBe("I couldn't find a record that answers that. The closest records are below.");
    expect(r.answer).not.toContain('$900 million');
    expect(r.relatedDocuments.length).toBeGreaterThan(0);
    expect(r.relatedDocuments.map((d) => d.id)).toContain('doc_6a0c9a6544266140');
  });

  it('scores a passage by the previous answer figures it holds, then the follow-up words', () => {
    const prev = 'The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million [1].';
    expect(priorPassageScore(URA_P6, prev, 'Is there a cap on what it can collect?')).toBeGreaterThanOrEqual(7);
    expect(priorPassageScore('PROJECT AREA DESCRIPTION The project area covers the former Geneva Steel site.', prev, 'Is there a cap on what it can collect?')).toBe(0);
  });
});
