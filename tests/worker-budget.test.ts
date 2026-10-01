import { describe, expect, it } from 'vitest';
import { topicsFor } from '../worker/ai/topics';
import { fiscalYearOf, resolveTime } from '../worker/ai/timeframe';

describe('budget fiscal years', () => {
  it('reads the fiscal year from the title', () => {
    expect(fiscalYearOf('FY 27 Final Budget -6.30.2026 2', '2026-06-30')).toBe(2027);
    expect(fiscalYearOf('FY25 Vineyard City Budget Book Final', null)).toBe(2025);
    expect(fiscalYearOf('Final Budget for FY 2026-2027', null)).toBe(2027);
    expect(fiscalYearOf('Tentative Budget Presentation FY2026 05-28-2025', null)).toBe(2026);
    expect(fiscalYearOf('Final Budget', '2019-06-25')).toBe(2020);
    expect(fiscalYearOf('Resolution 2017-05 Amend 2016-2017 FY Budget', '2017-03-01')).toBe(2017);
    expect(fiscalYearOf('Resolution 2023-29 Final Amended FY24 Budget', '2023-06-01')).toBe(2024);
  });
  it('"this year\'s budget" in October 2026 is fiscal year 2027', () => {
    const f = resolveTime("What was this year's budget?", '2026-10-01');
    expect(f?.label).toMatch(/fiscal year 2027/);
    expect((f?.from ?? '9999') <= '2026-06-30').toBe(true);
    const t = topicsFor("What was this year's budget?", '2026-10-01').find((x) => x.id === 'budget');
    expect(t?.note).toMatch(/fiscal year 2027 budget \(July 2026 to June 2027\)/);
    expect(t?.queries[0].q).toBe('FY 27 Final Budget');
  });
});
