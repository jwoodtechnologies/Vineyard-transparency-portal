import { describe, expect, it } from 'vitest';
import { orphanLead } from '../worker/ai/answer';
import { noModelReason } from '../worker/ai/fallback';

const para = (...t: string[]) => [{ segments: t.map((text) => ({ text, citations: [1] })) }];

describe('an answer never starts mid-thought', () => {
  it('flags a lead that points back to a removed sentence', () => {
    expect(orphanLead(para('This can lead to increased property values, job creation, and a better quality of life for residents.'))).toBe(true);
    expect(orphanLead(para('However, the agency also funds roads.'))).toBe(true);
    expect(orphanLead(para('It pays for improvements with tax increment.'))).toBe(true);
  });
  it('accepts a lead that names its subject', () => {
    expect(orphanLead(para('The RDA is the Vineyard Redevelopment Agency, which runs the Geneva urban renewal project.'))).toBe(false);
    expect(orphanLead(para('This year the council adopted the budget on June 23, 2026.'))).toBe(false);
    expect(orphanLead([])).toBe(false);
  });
  it('a removed lead shows the plain did-not-finish line, not "nothing answers that"', () => {
    expect(noModelReason('lead sentence removed: This can lead to...')).toBe('failed');
  });
});
