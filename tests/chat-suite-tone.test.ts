import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evalTurn, normalizeCases, quotedShare, toneChecks, type Officials } from '../scripts/chat-suite/lib.mjs';

const data = JSON.parse(readFileSync(new URL('./chat-suite/cases.json', import.meta.url), 'utf8')) as { officials: Officials; cases: Array<Record<string, unknown>> };
const cases = normalizeCases(data);
const tone = cases.filter((c) => c.category === 'tone');
const healthy = { ai: true, aiNeurons: { tests: { used: 120, cap: 1000 } } };
const ctx = { today: '2026-10-11', officials: data.officials, live: {}, health: healthy };
const spec = (id: string) => cases.find((c) => c.id === id)!.turns[0];

describe('tone cases', () => {
  it('has 30 model-tier tone cases, including the overpass and RDA questions', () => {
    expect(tone).toHaveLength(30);
    expect(tone.every((c) => c.tier === 'model')).toBe(true);
    const qs = tone.map((c) => c.turns[0].question);
    expect(qs).toContain('Is the city building an overpass over the railroad tracks?');
    expect(qs).toContain('What is the RDA and why does it matter?');
    expect(tone.filter((c) => (c.turns[0].tone as { explain?: boolean })?.explain).length).toBeGreaterThanOrEqual(20);
  });
});

describe('toneChecks', () => {
  const rda = spec('tone-rda-why-it-matters');
  const good = {
    answer:
      "The RDA is Vineyard's Redevelopment Agency, the body that runs the Geneva urban renewal project [1]. A redevelopment agency is a separate public body a city creates to renew one area. It matters because the growth in property taxes there pays for the roads and utilities the area needs [2].",
    engine: '@cf/qwen/qwen3-30b-a3b-fp8 + rerank',
    citations: [{ documentId: 'doc_6a0c9a6544266140', page: 6 }],
  };

  it('passes a direct, explaining answer', () => {
    expect(toneChecks(rda, good, ctx)).toEqual([]);
    expect(evalTurn(rda, good, ctx)).toEqual([]);
  });

  it('fails a records-disclaimer opener', () => {
    for (const opener of ['The records show that', 'According to the records,', 'Based on the records,', 'The records closest to your question:'])
      expect(toneChecks(rda, { ...good, answer: `${opener} ${good.answer}` }, ctx).some((f) => f.startsWith('opens with a records disclaimer')), opener).toBe(true);
  });

  it('fails an answer that is only record quotes (the old fallback)', () => {
    const quotes = {
      answer: 'The records closest to your question:\n\n529a-May 08, 2019 CC Agenda (City Council, May 8, 2019), page 17: "The Public Works building will be completed by the end of the year and staff will move in." [1]',
      engine: 'record-quotes (4006: daily neuron cap reached (7999 of 8000))',
      citations: [{ documentId: 'doc_x', page: 17 }],
    };
    expect(toneChecks(spec('tone-overpass-railroad'), quotes, ctx)).toContain('answer is only record quotes');
    expect(quotedShare(quotes.answer)).toBeGreaterThan(0.3);
  });

  it('fails a dodge: a why question answered with a pointer and no explanation', () => {
    const dodge = { answer: 'The full public record archive, searchable by any word, is on the Records page.', engine: 'route (paused after a quota error)', section: { path: '/records' } };
    expect(toneChecks(rda, dodge, ctx)).toContain('dodges a why or what-does-it-mean question: no explanation sentence');
  });

  it('fails the paused line while AI is healthy, and allows it when the tests bucket is spent or AI is down', () => {
    const paused = { answer: 'AI answers are paused until 6 PM Mountain. Here are the best matching records.', engine: 'records (4006)', relatedDocuments: [{ id: 'doc_x' }] };
    expect(toneChecks(spec('tone-overpass-railroad'), paused, ctx)).toContain('paused line while AI is healthy');
    expect(toneChecks(spec('tone-overpass-railroad'), paused, { ...ctx, health: { ai: true, aiNeurons: { tests: { used: 1000, cap: 1000 } } } })).toEqual([]);
    expect(toneChecks(spec('tone-overpass-railroad'), paused, { ...ctx, health: { ai: false } })).toEqual([]);
  });

  it('only runs on turns with tone', () => {
    expect(toneChecks({ question: 'x' }, { answer: 'The records show nothing.' }, ctx)).toEqual([]);
  });
});
