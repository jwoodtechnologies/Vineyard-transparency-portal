import { describe, expect, it } from 'vitest';
import { GENERAL, REVENUE, REVENUE_GROUPS, budgetPayload } from '../worker/lib/budgetData';
import { budgetFacts } from '../worker/lib/budgetFacts';

describe('budget framing', () => {
  it('shows taxes apart from the money that is not tax revenue', () => {
    const taxes = REVENUE.filter((r) => ['Property tax', 'Sales tax', 'Transportation tax', 'RAP tax'].includes(r.name)).reduce((s, r) => s + r.amount, 0);
    expect(taxes).toBe(9_945_500);
    // The page's two tax groups cover exactly those lines: nothing else is counted as a tax.
    const grouped = REVENUE_GROUPS.filter((g) => g.key === 'property' || g.key === 'sales')
      .flatMap((g) => g.lines)
      .map((n) => REVENUE.find((r) => r.name === n)?.amount ?? 0)
      .reduce((s, n) => s + n, 0);
    expect(grouped).toBe(taxes);
    expect(Math.round((taxes / GENERAL.revenueTotal) * 100)).toBe(56);
  });

  it('tells the chat to give the General Fund and never a total of all funds', () => {
    const facts = budgetFacts();
    expect(facts).toContain('about 56 percent of General Fund revenue');
    expect(facts).toContain('Never add the funds together or state a total of all funds');
    expect(facts).toContain('give the General Fund');
    expect(facts).not.toContain('70,944,358');
  });

  it('does not ship the year-over-year framing notes the page no longer shows', () => {
    expect(budgetPayload().notes.join(' ')).not.toMatch(/FY23/);
  });
});

describe('budget cuts', () => {
  it('states the cut since the tentative budget and the departments below last year', () => {
    const facts = budgetFacts();
    expect(GENERAL.tentativeTotal - GENERAL.amended.total).toBe(453_231);
    expect(facts).toContain('$453,231 below the $17,712,003');
    expect(facts).toContain('11 departments are budgeted $1,018,261 below');
  });
});
