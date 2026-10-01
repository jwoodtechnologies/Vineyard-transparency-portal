import { describe, expect, it } from 'vitest';
import { aiText, groundParagraphs, sentenceNumbers, trimNegative } from '../worker/ai/answer';

const src = (text: string, title = 'Agenda packet', documentDate: string | null = '2026-06-23') => ({ text, title, documentDate });
const para = (...segs: Array<[string, number[]]>) => [{ segments: segs.map(([text, citations]) => ({ text, citations })) }];

describe('answer grounding', () => {
  it('keeps sentences whose figures are in the cited source', () => {
    const r = groundParagraphs(para(['The council approved $350,000 for the Geneva Road widening.', [1]]), [src('Geneva Road widening. Total budget $350,000 Impact Fees')]);
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

import { attributeCitations } from '../worker/ai/answer';

describe('citation repair', () => {
  it('attaches an uncited sentence to the source it matches', () => {
    const ev = [
      { title: 'Budget', text: 'The general fund totals $10,270,489 for fiscal 2026.' },
      { title: '9.8.26 APPROVED CC Minutes', text: 'Council Member McCumber moved to approve the 300 West parking and striping plan option 3. Motion carried 4-0 (Holdaway, Lauret, McCumber, Wood).' },
    ];
    const out = attributeCitations('Jacob Wood voted for the 300 West parking and striping plan; the motion carried 4-0 with Holdaway, Lauret, McCumber and Wood in favor.', ev);
    expect(out).toContain('[2]');
  });
  it('leaves unmatched sentences uncited', () => {
    expect(attributeCitations('The weather was sunny and everyone enjoyed the parade downtown.', [{ title: 'Budget', text: 'General fund totals' }])).not.toContain('[');
  });
  it('keeps answers that already cite', () => {
    expect(attributeCitations('Approved [1].', [])).toBe('Approved [1].');
  });
});

describe('meta talk about sources', () => {
  it('drops sentences about the sources themselves', async () => {
    const { groundParagraphs } = await import('../worker/ai/answer');
    const ev = [{ title: 'Resolution 2020-20 Appoint City Attorney', documentDate: null, text: 'Jayme Blakesley is appointed city attorney.' }];
    const out = groundParagraphs(
      [{ segments: [{ text: 'The city appointed Jayme Blakesley as city attorney.', citations: [1] }, { text: 'The current status is not explicitly stated in the provided sources.', citations: [1] }] }],
      ev,
    );
    expect(out.paragraphs[0].segments.map((s) => s.text)).toEqual(['The city appointed Jayme Blakesley as city attorney.']);
  });
});

describe('decimals', () => {
  it('keeps a tax rate in one sentence', async () => {
    const { segmentAnswer } = await import('../worker/ai/answer');
    const out = segmentAnswer('The certified tax rate for fiscal year 2026 is 0.001234 [1]. It was adopted in June [1].', 1);
    expect(out.paragraphs[0].segments.map((s) => s.text)).toEqual(['The certified tax rate for fiscal year 2026 is 0.001234.', 'It was adopted in June.']);
  });
});

describe('names must be in the source', () => {
  it('removes a sentence naming someone the source does not mention', async () => {
    const { groundParagraphs } = await import('../worker/ai/answer');
    const ev = [{ title: 'City leadership and department heads (current)', documentDate: '2026-09-30', text: 'City Manager: Brian Voeks.' }, { title: 'Municipal Code: 2.08.020 Powers', documentDate: null, text: 'The city manager shall supervise departments.' }];
    const out = groundParagraphs([{ segments: [{ text: 'The current city manager of Vineyard is Eric Ellis.', citations: [2] }, { text: 'The city manager is Brian Voeks.', citations: [2] }] }], ev);
    expect(out.paragraphs[0].segments).toEqual([{ text: 'The city manager is Brian Voeks.', citations: [1] }]);
  });
  it('keeps initials inside a sentence', async () => {
    const { segmentAnswer, attributeCitations } = await import('../worker/ai/answer');
    const raw = attributeCitations('It was presented by Mayor J. Rulon Gammon [1]. Passed [1].', [{ title: 't', text: 'x' }]);
    expect(segmentAnswer(raw, 1).paragraphs[0].segments[0].text).toBe('It was presented by Mayor J. Rulon Gammon.');
  });
});

describe('dates in words', () => {
  it('rewrites ISO dates', async () => {
    const { segmentAnswer } = await import('../worker/ai/answer');
    expect(segmentAnswer('The list is current as of 2026-10-01 [1].', 1).paragraphs[0].segments[0].text).toBe('The list is current as of October 1, 2026.');
  });
});

describe('tidyOpeners', () => {
  it('drops a dangling connective at the start of a paragraph', async () => {
    const { tidyOpeners } = await import('../worker/ai/answer');
    const out = tidyOpeners([{ segments: [{ text: 'However, there are references to traffic at Center Street and Mill Road.', citations: [1] }, { text: 'However, it continues.', citations: [1] }] }]);
    expect(out[0].segments[0].text).toBe('There are references to traffic at Center Street and Mill Road.');
    expect(out[0].segments[1].text).toBe('However, it continues.');
  });
});

describe('U. S. Mail', () => {
  it('stays in one sentence', async () => {
    const { segmentAnswer, attributeCitations } = await import('../worker/ai/answer');
    const raw = attributeCitations('You can submit the request by email, U. S. Mail, or in person [2].', [{ title: 't', text: 'x' }, { title: 'u', text: 'y' }]);
    expect(segmentAnswer(raw, 2).paragraphs[0].segments.map((s) => s.text)).toEqual(['You can submit the request by email, U. S. Mail, or in person.']);
  });
});
