import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { topicsFor } from '../worker/ai/topics';
import { ALL_FUNDS_TOTAL, DEPARTMENTS, FUNDS, GENERAL, PROJECTS, PROJECT_FUNDS, REVENUE, REVENUE_GROUPS, SPEND_GROUPS, TRANSFERS_IN, TRANSFERS_OUT } from '../worker/lib/budgetData';
import { budgetForFeature, FY27_PLAN, FY27_PROJECTS_WHERE } from '../worker/lib/capitalPlan';

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('fiscal 2027 budget data', () => {
  it('adds up to the totals in the budget book (within the book’s own rounding)', () => {
    expect(Math.abs(sum(DEPARTMENTS.map((d) => d.adopted)) - GENERAL.adopted.departments)).toBeLessThanOrEqual(3);
    expect(Math.abs(sum(DEPARTMENTS.map((d) => d.amended)) - GENERAL.amended.departments)).toBeLessThanOrEqual(3);
    expect(Math.abs(sum(TRANSFERS_OUT.map((d) => d.amended)) - GENERAL.amended.transfersOut)).toBeLessThanOrEqual(3);
    expect(sum(REVENUE.map((r) => r.amount))).toBe(GENERAL.revenueBeforeTransfers);
    expect(sum(TRANSFERS_IN.map((r) => r.amount))).toBe(GENERAL.transfersIn);
    expect(GENERAL.revenueBeforeTransfers + GENERAL.transfersIn).toBe(GENERAL.revenueTotal);
    expect(Math.abs(GENERAL.adopted.total - GENERAL.amended.total - GENERAL.cutByAmendment)).toBeLessThanOrEqual(1);
    expect(Math.abs(sum(FUNDS.map((f) => f.total)) - ALL_FUNDS_TOTAL)).toBeLessThanOrEqual(3);
  });
  it('puts every department, transfer and revenue line in exactly one group', () => {
    const spend = SPEND_GROUPS.flatMap((g) => g.depts);
    expect(new Set(spend).size).toBe(spend.length);
    expect(spend.sort()).toEqual([...DEPARTMENTS, ...TRANSFERS_OUT].map((d) => d.name).sort());
    const rev = REVENUE_GROUPS.flatMap((g) => g.lines);
    expect(new Set(rev).size).toBe(rev.length);
    expect(rev.sort()).toEqual([...REVENUE, ...TRANSFERS_IN].map((r) => r.name).sort());
  });
  it('gives every project a known fund and a slide page', () => {
    for (const p of PROJECTS) {
      expect(PROJECT_FUNDS.some((f) => f.key === p.fund)).toBe(true);
      expect([4, 5, 6]).toContain(p.page);
      expect(p.amount).toBeGreaterThan(0);
    }
  });
});

describe('map projects tied to the fiscal 2027 budget', () => {
  it('every mapped project resolves to real budget lines', () => {
    for (const m of FY27_PLAN) {
      const b = budgetForFeature(m.id);
      expect(b, m.gis).not.toBeNull();
      expect(b!.items.every((i) => i.amount > 0), m.gis).toBe(true);
    }
    expect(new Set(FY27_PLAN.map((p) => p.id)).size).toBe(FY27_PLAN.length);
    expect(FY27_PROJECTS_WHERE).toMatch(/^OBJECTID IN \(\d+(,\d+)*\)$/);
    expect(budgetForFeature(43)).toBeNull(); // New City Hall is not in the budget
    expect(budgetForFeature(32)).toBeNull(); // Fire Station 35 is not in the fiscal 2027 budget
  });
  it('the ingest copy of the table matches the Worker copy', () => {
    const py = readFileSync(new URL('../ingest/gis.py', import.meta.url), 'utf8');
    const block = /# BEGIN FY27_PLAN[^\n]*\nFY27_PLAN = (\[[\s\S]*?\n\])\n# END FY27_PLAN/.exec(py);
    expect(block).not.toBeNull();
    const rows = JSON.parse(block![1].replace(/,\s*\]$/, ']')) as Array<{ id: number; items: Array<[string, string, number]> }>;
    const ts = FY27_PLAN.map((m) => ({ id: m.id, items: budgetForFeature(m.id)!.items.map((i) => [i.fund, i.name, i.amount]) }));
    expect(rows.map((r) => ({ id: r.id, items: r.items }))).toEqual(ts);
  });
});

describe('chat knowledge of the budget', () => {
  it('a capital projects question carries the adopted project list', () => {
    const t = topicsFor('What capital projects are planned this year?', '2026-10-01').find((x) => x.id === 'capital-projects');
    expect(t?.note).toMatch(/Skate park near Vineyard City Hall/);
    expect(t?.note).toMatch(/Fire Station 35/);
    expect(t?.note).toMatch(/do not present them as current/);
  });
  it('a budget question carries the verified fiscal 2027 figures', () => {
    const t = topicsFor('How much does the police department cost in this year\'s budget?', '2026-10-01').find((x) => x.id === 'budget');
    expect(t?.note).toMatch(/Police \$4,705,075/);
    expect(t?.note).toMatch(/\$17,258,772/);
  });
});
