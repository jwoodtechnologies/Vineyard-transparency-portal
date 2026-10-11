import { describe, expect, it } from 'vitest';
import { asksCurrentValue, recencyWeighted } from '../worker/ai/retrieval';
import { undatedRates } from '../worker/ai/rag';
import { groundParagraphs, reversedIncrementShare } from '../worker/ai/answer';
import { topicsFor } from '../worker/ai/topics';
import type { ChunkHit } from '../worker/search/types';

const hit = (id: string, date: string, rel: number): ChunkHit & { rel: number } => ({ shard: 0, chunkId: id, documentId: id.split(':')[0], pageStart: 1, pageEnd: 1, sectionTitle: null, score: 1, excerpt: '', highlights: [], title: id, documentType: 'minutes', documentNumber: null, documentDate: date, year: Number(date.slice(0, 4)), governmentBodyId: null, sourceId: 's', categoriesJson: '[]', rel });

describe('current-value questions (b)', () => {
  it('reads "what is the property tax rate" as asking for the value in effect now', () => {
    expect(asksCurrentValue('what is the property tax rate')).toBe(true);
    expect(asksCurrentValue("What's the current certified tax rate?")).toBe(true);
    expect(asksCurrentValue('how much is the water fee now')).toBe(true);
    expect(asksCurrentValue('what was the property tax rate in 2019')).toBe(false);
    expect(asksCurrentValue('what is the property tax rate for FY26')).toBe(false);
    expect(asksCurrentValue('who is the mayor')).toBe(false);
  });

  it('ranks the June 2025 rate record over the June 2024 one for a present-tense rate question', () => {
    // The 2024 record matches the words a little better; the newer record still leads.
    const ranked = [hit('old:1', '2024-06-26', 0.9), hit('new:1', '2025-06-25', 0.8)];
    expect(recencyWeighted(ranked, 'what is the property tax rate', 2026).map((h) => h.chunkId)).toEqual(['new:1', 'old:1']);
  });

  it('removes a sentence that gives a rate with no year', () => {
    const out = undatedRates([{ segments: [{ text: 'The certified tax rate is 0.002835.', citations: [1] }, { text: 'Certified tax rate for fiscal 2026: 0.003796 (06/25/2025 CC Meeting Minutes, June 25, 2025).', citations: [2] }] }]);
    expect(out[0].segments.map((s) => s.text)).toEqual(['Certified tax rate for fiscal 2026: 0.003796 (06/25/2025 CC Meeting Minutes, June 25, 2025).']);
  });
});

describe('Geneva URA tax increment wording (c)', () => {
  // doc_6a0c9a6544266140, RDA Resolution U-2010-05, page 6; doc_179192efa15bf228, 2016 Annual Report, page 13.
  const budget = 'PROJECTED TAX INCREMENT REVENUE The Project Area development projections anticipate generating $415 million in tax increment revenues. The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million.';
  const report = 'Total Tax Increment 8,634,617 Participation Rate 75% Total Tax Increment Revenue Due to RDA 6,475,963 Total Pass Through to Taxing Entities (Above Base)* 2,158,654';

  it('drops "the taxing entities each receive 75% of the increment" when the record gives 75 percent to the Agency', () => {
    expect(reversedIncrementShare('The taxing entities each receive 75% of the increment [1].', [budget])).toBe(true);
    expect(reversedIncrementShare('Taxing entities each receive 75 percent of the tax increment.', [report])).toBe(true);
    expect(reversedIncrementShare('The Agency proposes capturing 75 percent of the tax increment, with a cap of $300 million.', [budget])).toBe(false);
    const out = groundParagraphs(
      [{ segments: [{ text: 'The taxing entities each receive 75% of the increment.', citations: [1] }, { text: 'The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million.', citations: [1] }] }],
      [{ title: 'RDA Resolution U-2010-05 Adopting The Draft Geneva Urban Renewal Project Area Budget', documentDate: '2010-04-28', text: budget }],
    );
    expect(out.paragraphs[0].segments.map((s) => s.text)).toEqual(['The Agency proposes capturing 75 percent of the tax increment with a cap of $300 million.']);
  });

  it('pulls the project area budget and annual report forward for a Geneva URA question, with no figure of its own', () => {
    const t = topicsFor('How does the Geneva URA tax increment work?', '2026-10-11').find((x) => x.id === 'geneva-ura');
    expect(t?.queries.map((q) => q.q)).toContain('"Agency proposes capturing" "tax increment"');
    expect(t?.note).toContain('the Redevelopment Agency captures (receives) a share of the tax increment');
    expect(t?.note).not.toMatch(/\d/);
    expect(t?.note).not.toMatch(/[–—]/);
  });
});
