import { describe, expect, it } from 'vitest';
import {
  FALLBACK_AI_MODEL,
  LITE_AI_MODEL,
  RAG_SYSTEM_PROMPT,
  attributeCitations,
  briefAnswer,
  dropRestatement,
  generalQuestion,
  groundParagraphs,
  modelChain,
  needsCitation,
  segmentAnswer,
  stripRecordsOpener,
  tidyOpeners,
} from '../worker/ai/answer';
import { noModelLine, noModelReason, relevanceFloor, relevantRecords, resumeLabel } from '../worker/ai/fallback';
import { estimateNeurons } from '../worker/ai/meter';

const src = (text: string, title = 'Agenda packet', documentDate: string | null = '2026-06-23') => ({ text, title, documentDate });

/** The answer pipeline of worker/ai/rag.ts finish(), on model text and its sources. */
function ground(raw: string, evidence: Array<{ text: string; title: string; documentDate: string | null }>) {
  const first = segmentAnswer(briefAnswer(attributeCitations(raw, evidence)), evidence.length);
  const g = groundParagraphs(first.paragraphs, evidence);
  return dropRestatement(tidyOpeners(g.paragraphs));
}
const texts = (ps: Array<{ segments: Array<{ text: string; citations: number[] }> }>) => ps.flatMap((p) => p.segments.map((s) => `${s.text}${s.citations.length ? ` [${s.citations.join(',')}]` : ''}`));

describe('which sentences need a source', () => {
  // Sentences from answers the portal gave (chat suite run 38165126923) and the kind the new prompt asks for.
  it.each([
    'The Redevelopment Agency captures 75% of the tax increment from the Geneva Urban Renewal Area.',
    'This is a cap of $300 million.',
    'The motion was made by Council Member Wood and seconded by Council Member Lauret.',
    'Steffani Winder was appointed to the Vineyard Library Board in September 2026.',
    'The council approved the minutes of the meeting where the amendment was approved on October 13, 2026.',
    'The taxing entities include Utah County, Vineyard City, Alpine School District, Central Utah Water District and Timpanogos SSD.',
    'The council voted to deny the rezone.',
    'Vineyard approved a new parks plan.',
    'The city is widening Geneva Road.',
    'It was adopted unanimously.',
    'The next City Council meeting is Tuesday, October 13, 2026 at 6:00 pm.',
    'Gammon Park will have pickleball courts.',
  ])('needs a citation: %s', (s) => {
    expect(needsCitation(s)).toBe(true);
  });

  it.each([
    'A redevelopment agency is a separate public body that a city creates to help redevelop a specific area.',
    'It pays for roads, utilities and cleanup with tax increment, the growth in property taxes that new development brings.',
    'That matters because the money stays in the project area instead of going to the general fund.',
    'In general, a budget amendment is how a city council changes the budget it adopted, after a public hearing.',
    'You can speak during the public comment period near the start of most regular meetings.',
    'Most Utah cities ask speakers to give their name and keep comments to a few minutes.',
    'Here is how it works.',
    'If you want more detail, the cards below open each record.',
    'A public hearing is a time set aside on an agenda for anyone to comment before the body decides.',
    'An overpass would carry the road over the tracks, so trains and traffic never cross at the same level.',
  ])('stands without a citation: %s', (s) => {
    expect(needsCitation(s)).toBe(false);
  });
});

describe('uncited explanation is kept, uncited Vineyard facts are not', () => {
  it('keeps general and connective sentences and drops an uncited figure no record holds', () => {
    const r = segmentAnswer('A redevelopment agency is a separate public body a city creates to renew one area. The Agency proposes capturing 75 percent of the tax increment [1]. The RDA also approved a $900 million bond.', 1);
    const g = groundParagraphs(r.paragraphs, [src('The Agency proposes capturing 75 percent of the tax increment.')]);
    expect(g.paragraphs[0].segments.map((s) => s.text)).toEqual(['A redevelopment agency is a separate public body a city creates to renew one area.', 'The Agency proposes capturing 75 percent of the tax increment.']);
    expect(g.removed).toBe(1);
  });

  it('never deletes the lead: a plain explanation with no citation stays first', () => {
    const r = segmentAnswer('Yes, the Redevelopment Agency (RDA) in Vineyard, Utah is a special entity created to help the city improve its neighborhoods. This can lead to increased property values and job creation [1].', 1);
    const g = groundParagraphs(r.paragraphs, [src('Redevelopment raises property values and creates jobs.')]);
    expect(g.paragraphs[0].segments[0].text).toMatch(/^Yes, the Redevelopment Agency/);
  });

  it('a lead with a figure no record holds keeps its other clauses', () => {
    const r = segmentAnswer('The RDA, created in 1999, funds roads and utilities in the Geneva area.', 1);
    const g = groundParagraphs(r.paragraphs, [src('The Agency funds roads and utilities in the Geneva project area.')]);
    expect(g.paragraphs[0].segments[0].text).toBe('The RDA funds roads and utilities in the Geneva area.');
  });

  it('keeps a paragraph of general explanation with no citation, but not a bare lead-in', () => {
    const paras = [
      { segments: [{ text: 'In general, a budget amendment changes a budget the council already adopted.', citations: [] }, { text: 'It needs a public hearing first.', citations: [] }] },
      { segments: [{ text: 'Here is what the records hold:', citations: [] }] },
    ];
    const r = groundParagraphs(paras, [src('Budget amendment')]);
    expect(r.paragraphs).toHaveLength(1);
    expect(r.paragraphs[0].segments).toHaveLength(2);
  });
});

describe('records-disclaimer openers', () => {
  it.each([
    ['The records show that the council approved the plan.', 'The council approved the plan.'],
    ['According to the records, the splash pad opens on Memorial Day.', 'The splash pad opens on Memorial Day.'],
    ['Based on the provided documents, the RDA captures 75 percent.', 'The RDA captures 75 percent.'],
    ['The available records indicate the road will be widened.', 'The road will be widened.'],
    ['From the records, the meeting starts at 6:00 pm.', 'The meeting starts at 6:00 pm.'],
  ])('%s', (input, out) => {
    expect(stripRecordsOpener(input)).toBe(out);
  });

  it('keeps a named record ("According to the June 23, 2026 budget, ...")', () => {
    expect(stripRecordsOpener('According to the June 23, 2026 budget, police receives $4,705,075.')).toBe('According to the June 23, 2026 budget, police receives $4,705,075.');
  });

  it('tidyOpeners strips it from the answer', () => {
    const out = tidyOpeners([{ segments: [{ text: 'The records show that the council met on June 5, 2026.', citations: [1] }] }]);
    expect(out[0].segments[0].text).toBe('The council met on June 5, 2026.');
  });
});

describe('general questions', () => {
  it.each(['What is the RDA and why does it matter?', 'How does a budget amendment work?', 'How do I speak at a city council meeting?', 'What does a planning commission do?', 'Why do cities hold public hearings?'])('general: %s', (q) => {
    expect(generalQuestion(q)).toBe(true);
  });
  it.each(['Why did the council approve the Holdaway Fields amendment?', 'What is the 2026 property tax rate?', 'What are the plans for Main Street?', 'When is the next city election?', 'Who is the mayor?'])('specific: %s', (q) => {
    expect(generalQuestion(q)).toBe(false);
  });
});

describe('the new prompt', () => {
  it('asks for the direct answer, explanation, and general knowledge marked apart from Vineyard records', () => {
    expect(RAG_SYSTEM_PROMPT).toContain('Your first sentence is the direct answer');
    expect(RAG_SYSTEM_PROMPT).toContain('Never open with talk about sources');
    expect(RAG_SYSTEM_PROMPT).toContain('"In general,"');
    expect(RAG_SYSTEM_PROMPT).toContain('"In Vineyard\'s records,"');
    expect(RAG_SYSTEM_PROMPT).toContain('reply with exactly NO_RECORD');
    expect(RAG_SYSTEM_PROMPT).not.toMatch(/[–—]/);
  });
});

describe('model chain', () => {
  it('tries the larger model (or the small one), then the cheaper lite model', () => {
    expect(modelChain('@cf/qwen/qwen3-30b-a3b-fp8', true)).toEqual(['@cf/qwen/qwen3-30b-a3b-fp8', LITE_AI_MODEL]);
    expect(modelChain('@cf/qwen/qwen3-30b-a3b-fp8', false)).toEqual([FALLBACK_AI_MODEL, LITE_AI_MODEL]);
    expect(modelChain(LITE_AI_MODEL, true)).toEqual([LITE_AI_MODEL]);
  });

  it('the lite model with five sources costs well under half a Qwen answer', () => {
    const chars = 'x'.repeat(6400 + 10 * 1600);
    const qwen = estimateNeurons('@cf/qwen/qwen3-30b-a3b-fp8', { messages: [{ content: chars }], max_tokens: 900 });
    const lite = estimateNeurons(LITE_AI_MODEL, { messages: [{ content: 'x'.repeat(6400 + 5 * 1600) }], max_tokens: 380 });
    expect(lite).toBeLessThan(qwen / 3);
  });
});

describe('when no model answers', () => {
  it('names the reset time in Mountain time: 6 PM in daylight time, 5 PM in standard time', () => {
    expect(resumeLabel(new Date('2026-10-11T21:00:00Z'))).toBe('6 PM Mountain');
    expect(resumeLabel(new Date('2026-12-11T21:00:00Z'))).toBe('5 PM Mountain');
  });

  it('writes one plain line per reason', () => {
    const now = new Date('2026-10-11T21:00:00Z');
    expect(noModelLine(noModelReason('4006: daily neuron cap reached (7999 of 8000)'), true, now)).toBe('AI answers are paused until 6 PM Mountain. Here are the best matching records.');
    expect(noModelLine(noModelReason('paused after a quota error'), false, now)).toBe('AI answers are paused until 6 PM Mountain.');
    expect(noModelLine(noModelReason('daily answer limit reached'), true, now)).toMatch(/^AI answers are paused/);
    expect(noModelLine(noModelReason('suite allowance spent for today (1000 of 1000)'), true, now)).toMatch(/^AI answers are paused/);
    expect(noModelLine(noModelReason('no sentence passed the source check: x'), true, now)).toBe('Nothing in the archive answers that directly. These records come closest.');
    expect(noModelLine(noModelReason('AI timeout'), true, now)).toBe('The AI answer did not finish. Here are the best matching records.');
    for (const line of ['4006', 'AI timeout', 'no record', 'AI not configured'].map((w) => noModelLine(noModelReason(w), true, now))) expect(line).not.toMatch(/[–—]|couldn'?t find|unavailable|unable to/i);
  });

  it('never shows a record that only shares a word with the question', () => {
    const hits = [
      { documentId: 'doc_pw', chunkId: 'a', title: '2019 CC Minutes', text: 'The Public Works building will be completed by the end of the year and staff will move in the following month.' },
      { documentId: 'doc_rail', chunkId: 'b', title: 'Transportation Master Plan', text: 'A grade separated overpass over the Union Pacific railroad at 400 South is listed as a long range project.' },
    ];
    expect(relevantRecords('Is the city building an overpass over the railroad?', hits).map((h) => h.documentId)).toEqual(['doc_rail']);
    expect(relevantRecords('Is the city building an overpass over the railroad?', hits.slice(0, 1))).toEqual([]);
    expect(relevanceFloor(3)).toBe(2);
    expect(relevanceFloor(1)).toBe(1);
    expect(relevanceFloor(11)).toBe(3);
  });
});

describe('before and after on a model answer (simulated model text, run through the real pipeline)', () => {
  const evidence = [
    src('PROJECTED TAX INCREMENT REVENUE The Project Area development projections anticipate generating $415 million in tax increment revenues. The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million.', 'RDA Resolution U-2010-05 Adopting The Draft Geneva Urban Renewal Project Area Budget', '2010-04-28'),
    src('The Geneva Urban Renewal Project Area covers the former Geneva Steel site. Tax increment pays for roads, utilities and site cleanup.', 'Geneva Urban Renewal Project Area Plan', '2010-04-28'),
  ];
  const raw =
    'According to the records, the RDA is the Vineyard Redevelopment Agency, which runs the Geneva urban renewal project [2]. A redevelopment agency is a separate public body that a city creates to renew one area. It pays for improvements with tax increment, the growth in property taxes that new development brings.\n\n' +
    "In Vineyard's records, the Agency proposes capturing 75 percent of the tax increment with a cap of $300 million [1]. That matters because the increment pays for the roads, utilities and cleanup the former Geneva Steel site needs [2]. The RDA also approved a $900 million bond.";

  it('keeps the explanation and the checked facts, strips the opener, and drops the unsupported figure', () => {
    const out = texts(ground(raw, evidence));
    expect(out).toEqual([
      'The RDA is the Vineyard Redevelopment Agency, which runs the Geneva urban renewal project. [2]',
      'A redevelopment agency is a separate public body that a city creates to renew one area.',
      'It pays for improvements with tax increment, the growth in property taxes that new development brings.',
      "In Vineyard's records, the Agency proposes capturing 75 percent of the tax increment with a cap of $300 million. [1]",
      'That matters because the increment pays for the roads, utilities and cleanup the former Geneva Steel site needs. [2]',
    ]);
  });

  it('the old pipeline rule (every uncited sentence removed) would have kept only the cited lines', () => {
    const first = segmentAnswer(briefAnswer(attributeCitations(raw, evidence)), evidence.length);
    const uncitedKept = first.paragraphs.flatMap((p) => p.segments).filter((s) => !s.citations.length).length;
    // The uncited sentences now all reach the source check, which removes only the unsupported $900 million.
    expect(uncitedKept).toBe(3);
  });
});
