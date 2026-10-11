import { describe, expect, it } from 'vitest';
import { budgetAnswer, budgetIntent, longDate } from '../worker/ai/budgetAnswer';
import { dropRestatement } from '../worker/ai/answer';
import { BUDGET_ADOPTED } from '../worker/lib/budgetData';

const text = (q: string) => {
  const i = budgetIntent(q);
  return i ? budgetAnswer(i).sentences.map((s) => s.text).join(' ') : null;
};

describe('budget answers from budgetData.ts', () => {
  it('gives the final adoption date recorded in budgetData.ts, the same every time', () => {
    expect(BUDGET_ADOPTED).toBe('2026-06-23');
    const q = 'When was the FY27 final budget adopted?';
    const a = budgetAnswer(budgetIntent(q)!);
    expect(a.sentences[0]).toEqual({ text: 'The City Council adopted the FY 27 Final Budget, for fiscal year 2027 (July 1, 2026 to June 30, 2027), on June 23, 2026.', docs: ['book'] });
    expect(text(q)).not.toMatch(/June 30, 2026/);
    expect(text(q)).toBe(text(q));
    expect(budgetIntent('What date did the council adopt the budget?')).toEqual({ kind: 'adopted' });
    expect(budgetIntent('When was the budget amended?')).toEqual({ kind: 'amended' });
  });

  it('answers department, fund and revenue lines', () => {
    expect(text('How much is the city spending on police and fire in the FY27 budget?')).toContain('Police: $4,705,075 in the FY 27 Final Budget adopted June 23, 2026, unchanged by the First Budget Amendment of August 25, 2026.');
    expect(text('How much is the library budget?')).toContain('Library: $157,397 in the FY 27 Final Budget adopted June 23, 2026, and $134,910 after');
    expect(text('How much is in the water fund?')).toContain('Water fund: $7,575,979');
    expect(text('How much revenue does property tax bring in?')).toContain('Property tax: $5,395,500 of General Fund revenue');
    expect(text('How much do fire inspection fees bring in for the budget?')).toContain('Fire inspection fees: $35,000');
    expect(text('How much do fire inspection fees bring in for the budget?')).not.toContain('Fire:');
    const total = text('What is the total city budget?');
    expect(total).not.toContain('$70,944,358');
    expect(total).not.toMatch(/\btotal of\b|\ball funds\b|\bnine city funds total\b/i);
    expect(total).toContain('The General Fund, the city\'s everyday operating budget, is $17,258,772');
    expect(total).toContain('presented by fund');
    expect(total).toContain('Redevelopment Agency: $29,786,656.');
  });

  it('leaves questions the data cannot settle to the records search', () => {
    expect(budgetIntent('How much did the parks master plan cost?')).toBeNull();
    expect(budgetIntent('How much is the police budget for fiscal 2024?')).toBeNull();
    expect(budgetIntent('How much did police spending increase from last year?')).toBeNull();
    expect(budgetIntent('What are police salaries in the budget?')).toBeNull();
    expect(budgetIntent('When was the Parks and Recreation Master Plan adopted?')).toBeNull();
    expect(budgetIntent('When is the next council meeting?')).toBeNull();
  });

  it('answers fiscal 2026 from the prior-year department column and says what else the data covers', () => {
    expect(text('How much is the city spending on parks in the 2026 budget?')).toContain('Parks: $1,117,111.');
    expect(text('How much is the police budget for FY26?')).toBe(
      'General Fund department budgets for fiscal year 2026 (July 1, 2025 to June 30, 2026), final amended, as printed in the FY 27 Final Budget adopted June 23, 2026: Police: $4,103,125. Every line is on the portal’s Budget page.',
    );
    expect(text('How much is in the water fund in fiscal year 2025-2026?')).toContain("The portal's budget data has fiscal year 2026 (July 1, 2025 to June 30, 2026) figures for General Fund departments only");
    expect(text('How much is in the water fund in fiscal year 2025-2026?')).not.toContain('$7,575,979');
    // "2026-27" and "2027" are the budget year itself.
    expect(text('How much is the police budget for 2026-27?')).toContain('Police: $4,705,075');
    expect(text('How much is the police budget in 2027?')).toContain('Police: $4,705,075');
  });

  it('writes dates and has no dashes', () => {
    expect(longDate('2026-06-23')).toBe('June 23, 2026');
    expect(longDate('')).toBeNull();
    for (const q of ['When was the budget adopted?', 'How much is parks spending in the FY27 budget?', 'What is the total city budget?', 'How big is the general fund budget?'])
      expect(text(q)).not.toMatch(/[–—]/);
  });
});

const para = (...sentences: string[]) => [{ segments: sentences.map((t) => ({ text: t, citations: [1] })) }];

describe('summary restatements', () => {
  it('drops a closing sentence that repeats figures already given', () => {
    const out = dropRestatement(para('Police is budgeted $4,705,075 in fiscal 2027.', 'Fire is budgeted $2,873,462.', 'In total, Police receives $4,705,075 and Fire receives $2,873,462.'));
    expect(out[0].segments.map((s) => s.text)).toEqual(['Police is budgeted $4,705,075 in fiscal 2027.', 'Fire is budgeted $2,873,462.']);
  });

  it('matches $4.7 million against 4,700,000 and across paragraphs', () => {
    const out = dropRestatement([...para('The contract is $4,700,000.'), ...para('Overall, the contract is $4.7 million.')]);
    expect(out).toHaveLength(1);
  });

  it('keeps a closing sentence with a new number or a new key word', () => {
    expect(dropRestatement(para('Police is budgeted $4,705,075.', 'Together with Fire that is $7,578,537.'))[0].segments).toHaveLength(2);
    expect(dropRestatement(para('Police is budgeted $4,705,075.', 'The sheriff contract accounts for $4,705,075.'))[0].segments).toHaveLength(2);
    expect(dropRestatement(para('Police is budgeted $4,705,075.', 'The council approved it unanimously.'))[0].segments).toHaveLength(2);
    expect(dropRestatement(para('Police is budgeted $4,705,075.'))[0].segments).toHaveLength(1);
  });
});
