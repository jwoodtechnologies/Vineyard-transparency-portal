import { describe, expect, it } from 'vitest';
import { interleave, parsePlan, recencyWeighted, relevant } from '../worker/ai/retrieval';
import type { ChunkHit } from '../worker/search/types';

const hit = (id: string): ChunkHit => ({ shard: 0, chunkId: id, documentId: id.split(':')[0], pageStart: 1, pageEnd: 1, sectionTitle: null, score: 1, excerpt: '', highlights: [], title: id, documentType: 'minutes', documentNumber: null, documentDate: null, year: null, governmentBodyId: null, sourceId: 's', categoriesJson: '[]' });

describe('parsePlan', () => {
  it('reads the JSON plan and keeps only known types', () => {
    const p = parsePlan('{"queries":["certified tax rate","property tax rate 2026"],"types":["budget","resolution","bogus"],"from":2026,"to":2026}', 'What is the property tax rate for 2026?');
    expect(p?.queries).toEqual(['certified tax rate', 'property tax rate 2026']);
    expect(p?.types).toEqual(['budget', 'resolution']);
    expect(p?.dateFrom).toBe('2026-01-01');
    expect(p?.dateTo).toBe('2026-12-31');
  });
  it('ignores years the question does not name, and thinking text', () => {
    const p = parsePlan('<think>hmm</think>```json\n{"queries":["city attorney appoint"],"types":[],"from":2019,"to":null}\n```', 'Who is the city attorney?');
    expect(p?.dateFrom).toBeUndefined();
    expect(p?.queries).toEqual(['city attorney appoint']);
  });
  it('fails soft', () => {
    expect(parsePlan('no json here', 'q')).toBeNull();
    expect(parsePlan('{"queries":[]}', 'q')).toBeNull();
  });
});

describe('interleave', () => {
  it('takes each list best-first without repeats', () => {
    const out = interleave([[hit('a:1'), hit('a:2')], [hit('b:1'), hit('a:1')]], 10).map((h) => h.chunkId);
    expect(out).toEqual(['a:1', 'b:1', 'a:2']);
  });
});

describe('relevant', () => {
  it('drops passages far below the best but keeps a few', () => {
    const r = [0.9, 0.5, 0.2, 0.05, 0.01, 0.001].map((rel, i) => ({ rel, i }));
    expect(relevant(r).map((x) => x.i)).toEqual([0, 1, 2, 3]);
    expect(relevant([{ rel: 0.9 }, { rel: 0.001 }], 4).length).toBe(2);
  });
});

describe('recencyWeighted', () => {
  const h = (id: string, date: string | null, rel: number, documentType = 'minutes') => ({ ...hit(id), documentDate: date, rel, documentType });
  it('puts this year first for present-tense questions', () => {
    const r = recencyWeighted([h('old:1', '2022-03-01', 0.9), h('new:1', '2026-08-01', 0.7)], 'What is the city doing about parking?', 2026);
    expect(r.map((x) => x.chunkId)).toEqual(['new:1', 'old:1']);
  });
  it('leaves history questions alone', () => {
    const r = recencyWeighted([h('old:1', '2022-03-01', 0.9), h('new:1', '2026-08-01', 0.7)], 'What did the council decide about parking in 2022?', 2026);
    expect(r.map((x) => x.chunkId)).toEqual(['old:1', 'new:1']);
  });
});

describe('isScheduleQuestion', () => {
  it('spots when-is-the-next-meeting questions only', async () => {
    const { isScheduleQuestion } = await import('../worker/ai/scheduleIntent');
    expect(isScheduleQuestion('When is our next city council meeting?')).toBe(true);
    expect(isScheduleQuestion('when is the next planning commission meeting')).toBe(true);
    expect(isScheduleQuestion("What's on the agenda for the next council meeting?")).toBe(false);
    expect(isScheduleQuestion('What happened at the last council meeting?')).toBe(false);
  });
});

describe('knowledge-base intents', () => {
  it('spots remaining-meeting and count questions', async () => {
    const { isRemainingQuestion, countQuestion } = await import('../worker/ai/scheduleIntent');
    expect(isRemainingQuestion('How many city council meetings do we have left this year?')).toBe(true);
    expect(isRemainingQuestion('What happened at the last meeting?')).toBe(false);
    expect(countQuestion('How many resolutions did the council pass in 2025?')).toEqual({ type: 'resolution', year: 2025 });
    expect(countQuestion('How many ordinances in 1999?')).toEqual({ type: 'ordinance', year: 1999 });
  });
});
