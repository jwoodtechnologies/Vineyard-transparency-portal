import { describe, expect, it } from 'vitest';
import { chunkPages, estimateTokens, isHeading } from '../scripts/lib/chunk';
import type { DocumentPageText } from '../src/types/models';

function sentence(i: number): string {
  return `Sentence number ${i} describes a fictional procedural step in plain words for testing purposes.`;
}

function page(n: number, body: string): DocumentPageText {
  return { page: n, text: body, ocr: false };
}

describe('chunkPages', () => {
  it('produces a single chunk for short documents', () => {
    const chunks = chunkPages('doc_0000000000000001', [page(1, 'SECTION 1. PURPOSE\nShort text.')]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ id: 'doc_0000000000000001:c0000', documentId: 'doc_0000000000000001', pageStart: 1, pageEnd: 1, sectionTitle: 'SECTION 1. PURPOSE' });
  });

  it('keeps chunks within the token limit, with overlap, and tracks page ranges', () => {
    const pages = [1, 2, 3, 4].map((n) => page(n, Array.from({ length: 30 }, (_, i) => sentence(n * 100 + i)).join(' ')));
    const chunks = chunkPages('doc_x', pages, { targetTokens: 300, maxTokens: 400, overlapTokens: 60 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenEstimate).toBeLessThanOrEqual(400);
      expect(c.pageStart).toBeLessThanOrEqual(c.pageEnd);
      expect(c.documentId).toBe('doc_x');
    }
    // Overlap: the start of chunk n+1 repeats text from the end of chunk n.
    const firstSentenceOfSecond = chunks[1].text.split(/(?<=\.)\s/)[0];
    expect(chunks[0].text).toContain(firstSentenceOfSecond);
    // Page ranges cover all pages, in order.
    expect(chunks[0].pageStart).toBe(1);
    expect(chunks[chunks.length - 1].pageEnd).toBe(4);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it('never splits words and splits oversized paragraphs by sentence', () => {
    const giant = Array.from({ length: 200 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkPages('doc_y', [page(1, giant)], { targetTokens: 200, maxTokens: 260, overlapTokens: 0 });
    const words = new Set(giant.split(/\s+/));
    for (const c of chunks) for (const w of c.text.split(/\s+/)) expect(words.has(w)).toBe(true);
    expect(chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ')).toBe(giant);
  });

  it('attaches the most recent heading as the section title', () => {
    const text = `ARTICLE 1 DEFINITIONS\n\n${Array.from({ length: 40 }, (_, i) => sentence(i)).join(' ')}\n\nARTICLE 2 PROCEDURES\n\n${Array.from({ length: 40 }, (_, i) => sentence(i + 50)).join(' ')}`;
    const chunks = chunkPages('doc_z', [page(1, text)], { targetTokens: 400, maxTokens: 600, overlapTokens: 0 });
    expect(chunks[0].sectionTitle).toBe('ARTICLE 1 DEFINITIONS');
    expect(chunks.some((c) => c.sectionTitle === 'ARTICLE 2 PROCEDURES')).toBe(true);
  });

  it('splits out headings that appear mid-paragraph (common in PDF text)', () => {
    const body = Array.from({ length: 30 }, (_, i) => sentence(i)).join('\n');
    const text = `ORDINANCE NO. 2099-01\nAdopted January 5, 2099\nSECTION 1. PURPOSE\n${body}\nSECTION 2. EFFECTIVE DATE\n${body}`;
    const chunks = chunkPages('doc_m', [page(1, text)], { targetTokens: 300, maxTokens: 400, overlapTokens: 0 });
    expect(chunks[0].text.startsWith('ORDINANCE NO. 2099-01\n\nAdopted January 5, 2099\n\nSECTION 1. PURPOSE\n\n')).toBe(true);
    expect(chunks.some((c) => c.sectionTitle === 'SECTION 2. EFFECTIVE DATE')).toBe(true);
  });

  it('returns no chunks for documents without text', () => {
    expect(chunkPages('doc_e', [page(1, '   ')])).toEqual([]);
  });
});

describe('heading detection and token estimate', () => {
  it.each([
    ['SECTION 2. DEFINITIONS', true],
    ['Chapter 15.04 General Provisions', true],
    ['§ 15.04.010', true],
    ['4. Consent Agenda', true],
    ['A. Public Hearing', true],
    ['PUBLIC COMMENT', true],
    ['This is an ordinary sentence that ends with a period.', false],
    ['ok', false],
  ])('%s → %s', (line, expected) => {
    expect(isHeading(line)).toBe(expected);
  });

  it('estimates ~4 characters per token', () => {
    expect(estimateTokens('abcd'.repeat(100))).toBe(100);
  });
});
