import { describe, expect, it } from 'vitest';
import { cleanText, safeFileName, safeUrl } from '@/lib/safety';
import { paramsToSearchRequest, searchRequestToParams } from '@/lib/searchParams';
import { findHighlights, makeSnippet, normalizeIdentifier, parseQuery } from '@/lib/text';

describe('safety helpers', () => {
  it('only allows http(s) and same-origin paths', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>')).toBeNull();
    expect(safeUrl('//evil.example/x')).toBeNull();
    expect(safeUrl('/demo-files/a.pdf')).toBe('/demo-files/a.pdf');
    expect(safeUrl('https://www.utah.gov/pmn/')).toBe('https://www.utah.gov/pmn/');
  });

  it('sanitizes download file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('a<b>:"c|?*.pdf')).toBe('abc.pdf');
    expect(safeFileName('...hidden.pdf')).toBe('hidden.pdf');
    expect(safeFileName('')).toBe('document');
  });

  it('strips bidi overrides and control characters', () => {
    expect(cleanText('abc‮gpj.exe\u0000')).toBe('abcgpj.exe');
  });
});

describe('search URL state', () => {
  it('round-trips shareable search URLs', () => {
    const req = { query: 'parking', filters: { documentTypes: ['resolution' as const], years: [2026] }, match: 'any' as const, page: 2, pageSize: 10 };
    const params = searchRequestToParams(req);
    expect(params.toString()).toBe('q=parking&type=resolution&year=2026&match=any&page=2');
    const back = paramsToSearchRequest(params);
    expect(back.query).toBe('parking');
    expect(back.filters?.documentTypes).toEqual(['resolution']);
    expect(back.filters?.years).toEqual([2026]);
    expect(back.page).toBe(2);
  });

  it('rejects malformed values', () => {
    const r = paramsToSearchRequest(new URLSearchParams('year=abc&from=2026-99&sort=drop&match=evil&page=-3'));
    expect(r.filters?.years).toBeUndefined();
    expect(r.filters?.dateFrom).toBeUndefined();
    expect(r.sort).toBeUndefined();
    expect(r.match).toBe('all');
    expect(r.page).toBe(1);
  });
});

describe('query parsing and highlighting', () => {
  it('extracts phrases and identifiers', () => {
    const q = parseQuery('"parking enforcement" Resolution 2026-14 towing');
    expect(q.phrases).toEqual(['parking enforcement']);
    expect(q.identifiers).toContain('2026-14');
    expect(q.stems).toContain('towing');
  });

  it('normalizes identifiers', () => {
    expect(normalizeIdentifier('Res. No. DEMO-RES-2026-04')).toBe('RESNODEMORES202604');
  });

  it('highlights and snippets without breaking offsets', () => {
    const text = `${'x '.repeat(200)}the parking permit program`;
    const hl = findHighlights(text, ['parking']);
    const snip = makeSnippet(text, hl, 80);
    const [a, b] = snip.highlights[0];
    expect(snip.text.slice(a, b)).toBe('parking');
  });
});
