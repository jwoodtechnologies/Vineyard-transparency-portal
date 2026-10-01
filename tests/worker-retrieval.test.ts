import { describe, expect, it } from 'vitest';
import { interleave, parsePlan, relevant } from '../worker/ai/retrieval';
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
