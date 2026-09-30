import { describe, expect, it } from 'vitest';
import { fnv1a, parseQuery, parseSnippet } from '../worker/search/query';

describe('parseQuery (FTS5 expression builder)', () => {
  it('quotes every term so user text can never become FTS5 syntax', () => {
    const q = parseQuery('title:" OR 1=1 -- ) NEAR( *');
    expect(q.fts).not.toMatch(/NEAR\(|\)\s*$|:/);
    for (const part of (q.fts ?? '').split(' AND ')) expect(part).toMatch(/^"[^"]*"\*?$/);
  });

  it('joins terms with AND by default and OR for match=any, dropping stopwords', () => {
    expect(parseQuery('what did the council decide about parking').fts).toBe('"council" AND "decide" AND "parking"');
    expect(parseQuery('parking permits', { match: 'any' }).fts).toBe('"parking" OR "permits"');
  });

  it('keeps quoted phrases and hyphenated numbers adjacent', () => {
    const q = parseQuery('"detention basin" 2026-07');
    expect(q.fts).toBe('"detention basin" AND "2026 07"');
    expect(q.interpretation.phrases).toEqual(['detention basin', '2026 07']);
  });

  it('detects document numbers, years and document types without filtering on them', () => {
    const q = parseQuery('Ordinance No. 2026-07 budget 2025');
    expect(q.interpretation.documentNumber).toBe('Ordinance 2026-07');
    expect(q.interpretation.detectedYear).toBe(2026);
    expect(q.interpretation.detectedDocumentType).toBe('ordinance');
  });

  it('supports title-only search and user prefix markers', () => {
    expect(parseQuery('budg*', { titleOnly: true }).fts).toBe('doc_title : ("budg"*)');
  });

  it('returns null for input with nothing searchable', () => {
    expect(parseQuery('   ').fts).toBeNull();
    expect(parseQuery('"" ()').fts).toBeNull();
  });

  it('builds a single phrase in phrase mode', () => {
    expect(parseQuery('stormwater detention basin', { match: 'phrase' }).fts).toBe('"stormwater detention basin"');
  });
});

describe('parseSnippet', () => {
  it('converts snippet() markers into highlight ranges', () => {
    const r = parseSnippet('the \u0002pickleball\u0003 court \u0002lighting\u0003 study');
    expect(r.text).toBe('the pickleball court lighting study');
    expect(r.highlights).toEqual([
      [4, 14],
      [21, 29],
    ]);
  });
});

describe('shard assignment', () => {
  it('is deterministic', () => {
    expect(fnv1a('doc_0123456789abcdef')).toBe(fnv1a('doc_0123456789abcdef'));
    const spread = new Set(Array.from({ length: 200 }, (_, i) => fnv1a(`doc_${i.toString(16).padStart(16, '0')}`) % 4));
    expect(spread.size).toBe(4);
  });
});
