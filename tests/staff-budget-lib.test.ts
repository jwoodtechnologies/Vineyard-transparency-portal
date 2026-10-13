import { describe, expect, it } from 'vitest';
import { builtInBudgetBook } from '../worker/lib/budgetData';
import { checkBudgetBook, summarizeChange } from '../worker/lib/budgetBook';
import { TABLES, applyImport, blankRow, exportRows, fromDraft, importRows, isDirty, moneyOf, parseTable, slug, stepOfProblem, toDraft, usd, type Book } from '../src/console/staff/budgetLib';

const book = () => builtInBudgetBook() as unknown as Book;

describe('typing an amount', () => {
  it('reads dollars the way people write them', () => {
    expect(moneyOf('$1,234')).toBe(1234);
    expect(moneyOf(' 1234.00 ')).toBe(1234);
    expect(moneyOf('(500)')).toBe(-500);
    expect(moneyOf('-2,000')).toBe(-2000);
    expect(moneyOf('1,234.60')).toBe(1235);
    expect(moneyOf('')).toBeNull();
    expect(moneyOf('lots')).toBeNull();
    expect(moneyOf('12abc')).toBeNull();
  });
  it('writes dollars with the sign first', () => {
    expect(usd(1234567)).toBe('$1,234,567');
    expect(usd(-5)).toBe('-$5');
  });
});

describe('reading pasted spreadsheet text', () => {
  it('handles tabs, commas, semicolons and quotes', () => {
    expect(parseTable('Name\tAmount\nParks\t$1,000')).toEqual([
      ['Name', 'Amount'],
      ['Parks', '$1,000'],
    ]);
    expect(parseTable('Name,Amount\n"Parks, and Rec","1,000"\n')).toEqual([
      ['Name', 'Amount'],
      ['Parks, and Rec', '1,000'],
    ]);
    expect(parseTable('Name;Amount\nParks;1000')).toEqual([
      ['Name', 'Amount'],
      ['Parks', '1000'],
    ]);
    expect(parseTable('a,"say ""hi"""\r\nb,c')).toEqual([
      ['a', 'say "hi"'],
      ['b', 'c'],
    ]);
  });
});

describe('importing a table', () => {
  it('matches columns by heading, in any order', () => {
    const r = importRows(TABLES.revenue, 'Amount,Line item\n"$1,500",Sales tax\n200,Fees');
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { name: 'Sales tax', amount: 1500, group: '' },
      { name: 'Fees', amount: 200, group: '' },
    ]);
  });
  it('reads columns in table order when there are no headings', () => {
    const r = importRows(TABLES.revenue, 'Sales tax\t1500\nFees\t200');
    expect(r.rows.map((x) => [x.name, x.amount])).toEqual([
      ['Sales tax', 1500],
      ['Fees', 200],
    ]);
  });
  it('says what is wrong in plain words', () => {
    const r = importRows(TABLES.revenue, 'Name,Amount\nSales tax,lots\n,5');
    expect(r.problems).toEqual(['Row 1 (Sales tax): "lots" in Amount is not a number.', 'Row 2: write the name.']);
    expect(importRows(TABLES.departments, 'Name,Last year\nParks,5').problems.join(' ')).toContain('There is no "Adopted" column');
    expect(importRows(TABLES.revenue, '').problems[0]).toContain('Nothing to read');
  });
  it('matches project funding sources by name', () => {
    const funds = [
      { key: 'general', name: 'General Fund' },
      { key: 'rda', name: 'Redevelopment Agency' },
    ];
    const r = importRows(TABLES.projects, 'Project,Fund,Amount,Page\nA trail,General Fund,"$5,000",4\nA road,Mystery,10,5', funds);
    expect(r.rows[0]).toMatchObject({ name: 'A trail', fund: 'general', amount: 5000, page: 4 });
    expect(r.problems).toEqual(['Row 2 (A road): "Mystery" is not one of the funding sources.']);
  });
  it('round trips a table through the text it exports', () => {
    const d = toDraft(book());
    const text = exportRows(TABLES.departments, d.departments, [], d.spendGroups);
    const r = importRows(TABLES.departments, text);
    expect(r.problems).toEqual([]);
    const again = applyImport(d, 'departments', r.rows);
    expect(again.departments).toEqual(d.departments);
  });
  it('keeps the map links of a project when its row is imported again', () => {
    const d = toDraft(book());
    const text = exportRows(TABLES.projects, d.projects, d.projectFunds);
    const r = importRows(TABLES.projects, text, d.projectFunds);
    expect(r.problems).toEqual([]);
    expect(applyImport(d, 'projects', r.rows).projects).toEqual(d.projects);
  });
});

describe('the draft', () => {
  it('goes to the server unchanged when nothing was edited', () => {
    const b = book();
    // The pages show a group's lines in the table's order, so the order inside a group's list is not kept.
    const sorted = (x: Book): Book => ({
      ...x,
      spendGroups: x.spendGroups.map((g) => ({ ...g, depts: [...g.depts].sort() })),
      revenueGroups: x.revenueGroups.map((g) => ({ ...g, lines: [...g.lines].sort() })),
    });
    expect(sorted(fromDraft(toDraft(b)))).toEqual(sorted(b));
    expect(checkBudgetBook(fromDraft(toDraft(b))).errors).toEqual([]);
  });
  it('is not reported as a change just because the screen listed a group in table order', () => {
    const b = book();
    expect(summarizeChange(b as never, fromDraft(toDraft(b)) as never)).toBe('no figures changed');
  });
  it('is not dirty until something changes', () => {
    const d = toDraft(book());
    expect(isDirty(d, toDraft(book()))).toBe(false);
    expect(isDirty(d, { ...d, fiscalYear: 2028 })).toBe(true);
  });
  it('moves a renamed line into its group without anyone editing a list', () => {
    const d = toDraft(book());
    d.departments[0] = { ...d.departments[0], name: 'Renamed department', group: d.spendGroups[1].key };
    const out = fromDraft(d);
    expect(out.spendGroups[1].depts).toContain('Renamed department');
    expect(out.spendGroups.flatMap((g) => g.depts).filter((n) => n === 'Renamed department')).toHaveLength(1);
    const wasName = book().departments[0].name;
    expect(out.spendGroups.flatMap((g) => g.depts)).not.toContain(wasName);
  });
  it('puts a new line in the first group when none is chosen, and gives new funds a key', () => {
    const d = toDraft(book());
    d.revenue.push({ ...(blankRow('revenue', '') as { name: string; amount: number; group: string }), name: 'Grant money', amount: 5 });
    d.funds.push({ key: '', name: 'Fire & Rescue', about: '', total: 0 });
    d.funds.push({ key: '', name: 'Fire & Rescue', about: '', total: 0 });
    const out = fromDraft(d);
    expect(out.revenueGroups[0].lines).toContain('Grant money');
    const keys = out.funds.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.slice(-2)).toEqual(['fire-and-rescue', 'fire-and-rescue-2']);
  });
  it('leaves no after-amendment figures when there was no amendment', () => {
    const d = toDraft(book());
    d.amendedYet = false;
    d.departments[0].adopted += 1000;
    const out = fromDraft(d);
    expect(out.amended).toBe(out.adopted);
    expect(out.departments.every((r) => r.amended === r.adopted)).toBe(true);
    expect(out.general.amended).toEqual(out.general.adopted);
    expect(out.docs.amendment).toBe('');
  });
});

describe('keys', () => {
  it('makes short unique keys from names', () => {
    expect(slug('Parks & Recreation', [])).toBe('parks-and-recreation');
    expect(slug('Parks & Recreation', ['parks-and-recreation'])).toBe('parks-and-recreation-2');
    expect(slug('123', [])).toBe('item');
    expect(slug('A very long department name that keeps going', []).length).toBeLessThanOrEqual(24);
  });
});

describe('sending a mistake to the right step', () => {
  it('reads the table a sentence starts with', () => {
    expect(stepOfProblem('Departments, row 3 (Parks): write the name.')).toBe('spending');
    expect(stepOfProblem('Revenue, row 1: x')).toBe('revenue');
    expect(stepOfProblem('Totals: revenue before transfers says $1 but the revenue lines add up to $2.')).toBe('totals');
    expect(stepOfProblem('Capital projects, row 2 (Trail): choose where the money comes from.')).toBe('projects');
    expect(stepOfProblem('Basics: choose the date the council adopted the budget.')).toBe('basics');
    expect(stepOfProblem('Spending groups: "X" is not in any group.')).toBe('more');
  });
});
