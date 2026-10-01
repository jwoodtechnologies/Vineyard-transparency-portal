import { describe, expect, it } from 'vitest';
import { aiText, groundParagraphs, sentenceNumbers, trimNegative } from '../worker/ai/answer';

const src = (text: string, title = 'Agenda packet', documentDate: string | null = '2026-06-23') => ({ text, title, documentDate });
const para = (...segs: Array<[string, number[]]>) => [{ segments: segs.map(([text, citations]) => ({ text, citations })) }];

describe('answer grounding', () => {
  it('keeps sentences whose figures are in the cited source', () => {
    const r = groundParagraphs(para(['The council approved $350,000 for the Geneva Road widening.', [1]]), [src('Total budget $350,000 Impact Fees')]);
    expect(r.removed).toBe(0);
    expect(r.paragraphs[0].segments[0].citations).toEqual([1]);
  });

  it('removes a sentence whose amount is in no source', () => {
    const r = groundParagraphs(para(['The project costs $2.4 million.', [1]], ['Construction starts in 2026.', [1]]), [src('Construction fiscal year 2026, budget $350,000')]);
    expect(r.removed).toBe(1);
    expect(r.paragraphs[0].segments.map((s) => s.text)).toEqual(['Construction starts in 2026.']);
  });

  it('moves the citation to the source that actually has the figure', () => {
    const r = groundParagraphs(para(['Ordinance 2026-14 was adopted.', [1]]), [src('Minutes of the meeting'), src('ORDINANCE 2026-14 adopted 5-0')]);
    expect(r.paragraphs[0].segments[0].citations).toEqual([2]);
    expect(r.recited).toBe(1);
  });

  it('matches millions written out in full', () => {
    expect(groundParagraphs(para(['The fund holds $1.2 million.', [1]]), [src('Fund balance $1,200,000')]).removed).toBe(0);
  });

  it('removes claims that something is not listed', () => {
    const r = groundParagraphs(para(['The project is not listed in the master plan.', [1]], ['It is in Phase 1.', [1]]), [src('Phase 1 projects')]);
    expect(r.removed).toBe(1);
  });

  it('ignores small counts and phase numbers', () => {
    expect(sentenceNumbers('Phase 1 has 3 parts and costs $5,000.')).toEqual([['5000']]);
  });
});

describe('unsupported status claims', () => {
  it('cuts a "has not been approved" clause the source does not state', () => {
    expect(trimNegative('The intersection is a recommended Phase 1 improvement; it has not been approved, funded, or built yet.', ['Recommended Phase 1 improvements'])).toBe('The intersection is a recommended Phase 1 improvement.');
  });
  it('drops a sentence that is only that claim', () => {
    expect(trimNegative('The project has not yet been funded.', ['Project list'])).toBeNull();
  });
  it('keeps it when the source says so', () => {
    expect(trimNegative('The project has not yet been funded.', ['This project has not yet been funded by council.'])).toBe('The project has not yet been funded.');
  });
});

describe('aiText', () => {
  it('reads every result shape', () => {
    expect(aiText({ response: 'a' })).toBe('a');
    expect(aiText({ choices: [{ message: { content: 'b', reasoning_content: 'x' } }] })).toBe('b');
    expect(aiText({ output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'x' }] }, { type: 'message', content: [{ type: 'output_text', text: 'c' }] }] })).toBe('c');
  });
});
