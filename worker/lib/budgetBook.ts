/**
 * Checks a budget version staff want to save (pure: no Worker types). Every problem is a plain sentence that names the
 * table and the row, because the person reading it is a city employee fixing a form, not a programmer.
 *
 * The printed totals in the budget book can differ from the sum of their lines by a dollar or two (the book rounds),
 * so a total may differ from the sum by up to TOLERANCE dollars; anything larger is an error.
 */
import type { BudgetBook, BudgetFund, BudgetLine, CapitalProject, GeneralSpending, GeneralTotals, HistorySeries, RevenueGroup, RevenueLine, SpendGroup } from './budgetData';

export const TOLERANCE = 5;
const MAX_ROWS = 400;
const DOC_ID = /^doc_[0-9a-f]{16}$/;
const SLUG = /^[a-z][a-z0-9-]{0,23}$/;

const stripTags = (t: string) => t.replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

class Problems {
  list: string[] = [];
  add(s: string) {
    if (this.list.length < 25) this.list.push(s);
  }
}

/** A trimmed one-line string, tags removed. */
function text(v: unknown, max: number): string {
  return typeof v === 'string' ? stripTags(v).replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Whole dollars from a number or a string such as "$1,234"; null when it is not one. */
export function dollars(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[$,\s]/g, '')) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) <= 1e12 ? n : null;
}

function isoDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

function rows(v: unknown, table: string, p: Problems, min = 0): Obj[] {
  if (!Array.isArray(v)) {
    p.add(`${table}: the list is missing.`);
    return [];
  }
  if (v.length > MAX_ROWS) p.add(`${table}: at most ${MAX_ROWS} rows.`);
  if (v.length < min) p.add(`${table}: add at least ${min === 1 ? 'one row' : `${min} rows`}.`);
  const out: Obj[] = [];
  v.slice(0, MAX_ROWS).forEach((r, i) => {
    if (isObj(r)) out.push(r);
    else p.add(`${table}, row ${i + 1}: not a row.`);
  });
  return out;
}

/** "Departments, row 3 (Fire)". */
const at = (table: string, i: number, name: string) => `${table}, row ${i + 1}${name ? ` (${name})` : ''}`;

function money(r: Obj, key: string, where: string, what: string, p: Problems, { min = 0 }: { min?: number } = {}): number {
  const n = dollars(r[key]);
  if (n === null) {
    p.add(`${where}: ${what} must be a whole number of dollars.`);
    return 0;
  }
  if (n < min) p.add(`${where}: ${what} cannot be less than ${usd(min)}.`);
  return n;
}

function lines(v: unknown, table: string, p: Problems, taken: Set<string>): BudgetLine[] {
  return rows(v, table, p).map((r, i) => {
    const name = text(r.name, 60);
    const where = at(table, i, name);
    if (!name) p.add(`${where}: write the name.`);
    else if (taken.has(name.toLowerCase())) p.add(`${where}: "${name}" is used twice. Names must be different.`);
    taken.add(name.toLowerCase());
    return {
      name,
      adopted: money(r, 'adopted', where, 'the adopted amount', p),
      amended: money(r, 'amended', where, 'the amount after amendment', p),
      prior: money(r, 'prior', where, 'last year’s amount', p),
    };
  });
}

function amounts(v: unknown, table: string, p: Problems, taken: Set<string>): RevenueLine[] {
  return rows(v, table, p).map((r, i) => {
    const name = text(r.name, 60);
    const where = at(table, i, name);
    if (!name) p.add(`${where}: write the name.`);
    else if (taken.has(name.toLowerCase())) p.add(`${where}: "${name}" is used twice. Names must be different.`);
    taken.add(name.toLowerCase());
    return { name, amount: money(r, 'amount', where, 'the amount', p) };
  });
}

/** Every name in `names` is in exactly one group's list. */
function grouped(groups: Array<{ name: string; list: string[] }>, names: string[], table: string, what: string, p: Problems) {
  const seen = new Map<string, number>();
  for (const g of groups) for (const n of g.list) seen.set(n, (seen.get(n) ?? 0) + 1);
  for (const n of names) if (!seen.has(n)) p.add(`${table}: "${n}" is not in any group. Put it in one so it shows in the ${what}.`);
  for (const [n, c] of seen) {
    if (c > 1) p.add(`${table}: "${n}" is in more than one group.`);
    if (!names.includes(n)) p.add(`${table}: a group lists "${n}", which is not in the budget. Remove it from the group.`);
  }
}

function groups<T extends { key: string; name: string }>(v: unknown, table: string, listKey: string, p: Problems): Array<T & Record<string, string[]>> {
  const keys = new Set<string>();
  return rows(v, table, p, 1).map((r, i) => {
    const name = text(r.name, 60);
    const key = text(r.key, 24);
    const where = at(table, i, name);
    if (!name) p.add(`${where}: write the group's name.`);
    if (!SLUG.test(key)) p.add(`${where}: the short key must be lowercase letters, numbers and dashes, starting with a letter.`);
    else if (keys.has(key)) p.add(`${where}: the key "${key}" is used twice.`);
    keys.add(key);
    const list = Array.isArray(r[listKey]) ? (r[listKey] as unknown[]).map((x) => text(x, 60)).filter(Boolean) : [];
    return { key, name, [listKey]: list } as unknown as T & Record<string, string[]>;
  });
}

function spending(v: unknown, label: string, p: Problems): GeneralSpending {
  const r = isObj(v) ? v : {};
  const where = `Totals, ${label}`;
  return {
    departments: money(r, 'departments', where, 'the departments total', p),
    transfersOut: money(r, 'transfersOut', where, 'the transfers out total', p),
    total: money(r, 'total', where, 'the spending total', p),
    surplus: dollars(r.surplus) ?? (p.add(`${where}: the surplus must be a whole number of dollars.`), 0),
  };
}

function near(a: number, b: number, what: string, p: Problems, hint: string) {
  if (Math.abs(a - b) > TOLERANCE) p.add(`Totals: ${what} says ${usd(a)} but ${hint} ${usd(b)}.`);
}

/**
 * A budget that has not been amended (the amendment date is the adoption date) has no "after amendment" figures of its
 * own: they are the adopted ones, so every reader of `amended` sees the right numbers.
 */
function unamended(raw: Obj): Obj {
  const same = typeof raw.adopted === 'string' && raw.adopted.trim() !== '' && raw.adopted === raw.amended;
  if (!same) return raw;
  const again = (v: unknown) => (Array.isArray(v) ? v.map((r) => (isObj(r) ? { ...r, amended: r.adopted } : r)) : v);
  const g = isObj(raw.general) ? raw.general : null;
  return { ...raw, departments: again(raw.departments), transfersOut: again(raw.transfersOut), general: g ? { ...g, amended: g.adopted, cutByAmendment: 0 } : raw.general };
}

/** The checked, cleaned budget, or the problems to fix. Never throws. */
export function checkBudgetBook(input: unknown): { book: BudgetBook | null; errors: string[] } {
  const p = new Problems();
  if (!isObj(input)) return { book: null, errors: ['The budget could not be read.'] };
  const raw = unamended(input);

  const fiscalYear = dollars(raw.fiscalYear);
  if (fiscalYear === null || fiscalYear < 2000 || fiscalYear > 2100) p.add('Basics: the fiscal year is the year the budget ends, such as 2027.');
  const adopted = isoDate(raw.adopted);
  if (!adopted) p.add('Basics: choose the date the council adopted the budget.');
  const amended = isoDate(raw.amended);
  if (!amended) p.add('Basics: choose the date of the latest amendment (the adoption date if there has been none).');
  if (adopted && amended && amended < adopted) p.add('Basics: the amendment date is before the adoption date.');
  const adoptionOrdinance = text(raw.adoptionOrdinance, 60);
  const amendmentOrdinance = text(raw.amendmentOrdinance, 60);
  const amendmentName = text(raw.amendmentName, 60) || 'Budget Amendment';
  const tentativeRaw = typeof raw.tentativeDate === 'string' ? raw.tentativeDate.trim() : '';
  const tentativeDate = tentativeRaw ? (isoDate(tentativeRaw) ?? '') : '';
  if (tentativeRaw && !tentativeDate) p.add('Basics: choose the tentative budget date from the calendar, or leave it blank.');
  const docsIn = isObj(raw.docs) ? raw.docs : {};
  const docs = { book: '', slides: '', amendment: '', amendmentSummary: '', tentative: '' };
  for (const [k, label, required] of [
    ['book', 'the budget book', true],
    ['slides', 'the budget slides', true],
    ['amendment', 'the amendment', false],
    ['amendmentSummary', 'the amendment summary', false],
    ['tentative', 'the tentative budget', false],
  ] as const) {
    const id = text(docsIn[k], 40);
    if (!id && required) p.add(`Documents: choose ${label}.`);
    else if (id && !DOC_ID.test(id)) p.add(`Documents: the code for ${label} does not look right. It looks like doc_ followed by 16 letters and numbers.`);
    docs[k] = id;
  }
  const ordDoc = text(raw.adoptionOrdinanceDoc, 40);
  if (ordDoc && !DOC_ID.test(ordDoc)) p.add('Documents: the code for the adopting ordinance does not look right.');

  const fundKeys = new Set<string>();
  const funds: BudgetFund[] = rows(raw.funds, 'Funds', p, 1).map((r, i) => {
    const name = text(r.name, 60);
    const key = text(r.key, 24);
    const where = at('Funds', i, name);
    if (!name) p.add(`${where}: write the fund's name.`);
    if (!SLUG.test(key)) p.add(`${where}: the short key must be lowercase letters, numbers and dashes, starting with a letter.`);
    else if (fundKeys.has(key)) p.add(`${where}: the key "${key}" is used twice.`);
    fundKeys.add(key);
    return { key, name, about: text(r.about, 220), total: money(r, 'total', where, 'the total', p) };
  });
  if (funds.length && !fundKeys.has('general')) p.add('Funds: one fund must have the key "general" (the General Fund).');

  const taken = new Set<string>();
  const departments = lines(raw.departments, 'Departments', p, taken);
  const transfersOut = lines(raw.transfersOut, 'Transfers out', p, taken);
  const spendGroups = groups<SpendGroup>(raw.spendGroups, 'Spending groups', 'depts', p);
  grouped(
    spendGroups.map((g) => ({ name: g.name, list: g.depts })),
    [...departments, ...transfersOut].map((d) => d.name),
    'Spending groups',
    'spending chart',
    p,
  );

  const takenRev = new Set<string>();
  const revenue = amounts(raw.revenue, 'Revenue', p, takenRev);
  const transfersIn = amounts(raw.transfersIn, 'Transfers in', p, takenRev);
  const revenueGroups = groups<RevenueGroup>(raw.revenueGroups, 'Revenue groups', 'lines', p);
  grouped(
    revenueGroups.map((g) => ({ name: g.name, list: g.lines })),
    [...revenue, ...transfersIn].map((d) => d.name),
    'Revenue groups',
    'revenue chart',
    p,
  );

  const g = isObj(raw.general) ? raw.general : {};
  const general: GeneralTotals = {
    revenueBeforeTransfers: money(g, 'revenueBeforeTransfers', 'Totals', 'revenue before transfers', p),
    transfersIn: money(g, 'transfersIn', 'Totals', 'transfers in', p),
    revenueTotal: money(g, 'revenueTotal', 'Totals', 'total revenue', p),
    adopted: spending(g.adopted, 'adopted', p),
    amended: spending(g.amended, 'after amendment', p),
    cutByAmendment: money(g, 'cutByAmendment', 'Totals', 'the amount the amendment cut', p),
    tentativeTotal: money(g, 'tentativeTotal', 'Totals', 'the tentative budget total', p),
  };

  const years = (Array.isArray(raw.historyYears) ? raw.historyYears : []).map((y) => text(y, 12)).filter(Boolean);
  if (years.length < 2 || years.length > 10 || new Set(years).size !== years.length) p.add('History: give between 2 and 10 different years.');
  const seriesKeys = new Set<string>();
  const history: HistorySeries[] = rows(raw.history, 'History', p).map((r, i) => {
    const name = text(r.name, 60);
    const key = text(r.key, 24);
    const where = at('History', i, name);
    if (!name) p.add(`${where}: write the name.`);
    if (!SLUG.test(key)) p.add(`${where}: the short key must be lowercase letters, numbers and dashes, starting with a letter.`);
    else if (seriesKeys.has(key)) p.add(`${where}: the key "${key}" is used twice.`);
    seriesKeys.add(key);
    const vals = Array.isArray(r.values) ? (r.values as unknown[]).map(dollars) : [];
    if (vals.length !== years.length || vals.some((x) => x === null)) p.add(`${where}: give a whole-dollar amount for each of the ${years.length} years.`);
    return { key, name, kind: r.kind === 'spending' ? 'spending' : 'revenue', values: vals.map((x) => x ?? 0) };
  });

  const pfKeys = new Set<string>();
  const projectFunds = rows(raw.projectFunds, 'Project funding sources', p, 1).map((r, i) => {
    const name = text(r.name, 60);
    const key = text(r.key, 24);
    const where = at('Project funding sources', i, name);
    if (!name) p.add(`${where}: write the name.`);
    if (!SLUG.test(key)) p.add(`${where}: the short key must be lowercase letters, numbers and dashes, starting with a letter.`);
    else if (pfKeys.has(key)) p.add(`${where}: the key "${key}" is used twice.`);
    pfKeys.add(key);
    return { key, name };
  });

  const projKeys = new Set<string>();
  const projects: CapitalProject[] = rows(raw.projects, 'Capital projects', p).map((r, i) => {
    const name = text(r.name, 160);
    const fund = text(r.fund, 24);
    const where = at('Capital projects', i, name);
    if (!name) p.add(`${where}: write the project's name.`);
    if (!pfKeys.has(fund)) p.add(`${where}: choose where the money comes from.`);
    const id = `${fund}|${name.toLowerCase()}`;
    if (name && projKeys.has(id)) p.add(`${where}: this project is listed twice under the same funding source.`);
    projKeys.add(id);
    const pageN = dollars(r.page);
    if (pageN === null || pageN < 1 || pageN > 999) p.add(`${where}: give the page of the budget slides it is on.`);
    const featureRaw = r.feature === '' || r.feature == null ? null : dollars(r.feature);
    if (r.feature !== '' && r.feature != null && (featureRaw === null || featureRaw < 1 || featureRaw > 99999)) p.add(`${where}: the map feature number must be a whole number, or blank.`);
    const out: CapitalProject = { fund, dept: text(r.dept, 60), name, amount: money(r, 'amount', where, 'the amount', p, { min: 1 }), page: pageN ?? 0 };
    if (featureRaw) {
      out.feature = featureRaw;
      const fname = text(r.featureName, 120);
      if (fname) out.featureName = fname;
    }
    return out;
  });
  if (!projects.length) p.add('Capital projects: add at least one project.');

  // The totals must agree with the lines they total (within the book's own rounding).
  const generalFund = funds.find((f) => f.key === 'general');
  near(general.revenueBeforeTransfers, sum(revenue.map((r) => r.amount)), 'revenue before transfers', p, 'the revenue lines add up to');
  near(general.transfersIn, sum(transfersIn.map((r) => r.amount)), 'transfers in', p, 'the transfers-in lines add up to');
  near(general.revenueTotal, general.revenueBeforeTransfers + general.transfersIn, 'total revenue', p, 'revenue plus transfers in is');
  if (generalFund) near(general.revenueTotal, generalFund.total, 'total revenue', p, 'the General Fund on the Funds list is');
  for (const [label, field, amountOf] of [
    ['adopted', 'adopted', (d: BudgetLine) => d.adopted],
    ['after amendment', 'amended', (d: BudgetLine) => d.amended],
  ] as const) {
    const s = general[field];
    near(s.departments, sum(departments.map(amountOf)), `departments ${label}`, p, 'the departments add up to');
    near(s.transfersOut, sum(transfersOut.map(amountOf)), `transfers out ${label}`, p, 'the transfers out add up to');
    near(s.total, s.departments + s.transfersOut, `spending ${label}`, p, 'departments plus transfers out is');
    near(s.surplus, general.revenueTotal - s.total, `surplus ${label}`, p, 'revenue minus spending is');
  }
  near(general.cutByAmendment, general.adopted.total - general.amended.total, 'the amount the amendment cut', p, 'adopted minus amended spending is');

  if (p.list.length) return { book: null, errors: p.list };
  return {
    book: {
      fiscalYear: fiscalYear as number,
      adopted: adopted as string,
      adoptionOrdinance,
      adoptionOrdinanceDoc: ordDoc,
      amended: amended as string,
      amendmentOrdinance,
      amendmentName,
      tentativeDate,
      docs,
      funds,
      general,
      departments,
      transfersOut,
      spendGroups,
      revenue,
      transfersIn,
      revenueGroups,
      historyYears: years,
      history,
      projectFunds,
      projects,
    },
    errors: [],
  };
}

/** The totals the lines add up to, for the staff screen's "Add up the totals" button (the printed rounding is not reproduced). */
export function totalsFrom(b: Pick<BudgetBook, 'funds' | 'departments' | 'transfersOut' | 'revenue' | 'transfersIn'>, keep: GeneralTotals): GeneralTotals {
  const rev = sum(b.revenue.map((r) => r.amount));
  const inn = sum(b.transfersIn.map((r) => r.amount));
  const side = (pick: (d: BudgetLine) => number): GeneralSpending => {
    const departments = sum(b.departments.map(pick));
    const transfersOut = sum(b.transfersOut.map(pick));
    return { departments, transfersOut, total: departments + transfersOut, surplus: rev + inn - (departments + transfersOut) };
  };
  const adopted = side((d) => d.adopted);
  const amended = side((d) => d.amended);
  return { revenueBeforeTransfers: rev, transfersIn: inn, revenueTotal: rev + inn, adopted, amended, cutByAmendment: adopted.total - amended.total, tentativeTotal: keep.tentativeTotal };
}

/** One line for the activity log and the version list: what changed between two versions, counted by table. */
export function summarizeChange(before: BudgetBook, after: BudgetBook): string {
  const tables: Array<[string, unknown[], unknown[], (r: never) => string]> = [
    ['funds', before.funds, after.funds, (r: BudgetFund) => r.key],
    ['departments', before.departments, after.departments, (r: BudgetLine) => r.name],
    ['transfers out', before.transfersOut, after.transfersOut, (r: BudgetLine) => r.name],
    ['revenue lines', before.revenue, after.revenue, (r: RevenueLine) => r.name],
    ['transfers in', before.transfersIn, after.transfersIn, (r: RevenueLine) => r.name],
    ['capital projects', before.projects, after.projects, (r: CapitalProject) => `${r.fund}|${r.name}`],
    ['history rows', before.history, after.history, (r: HistorySeries) => r.key],
  ];
  const parts: string[] = [];
  for (const [label, a, b, keyOf] of tables) {
    const key = keyOf as (r: unknown) => string;
    const was = new Map(a.map((r) => [key(r), JSON.stringify(r)]));
    const now = new Map(b.map((r) => [key(r), JSON.stringify(r)]));
    const added = [...now.keys()].filter((k) => !was.has(k)).length;
    const removed = [...was.keys()].filter((k) => !now.has(k)).length;
    const changed = [...now].filter(([k, v]) => was.has(k) && was.get(k) !== v).length;
    const bits = [changed && `${changed} changed`, added && `${added} added`, removed && `${removed} removed`].filter(Boolean);
    if (bits.length) parts.push(`${label}: ${bits.join(', ')}`);
  }
  const rest: string[] = [];
  if (before.fiscalYear !== after.fiscalYear) rest.push('fiscal year');
  if (before.adopted !== after.adopted || before.adoptionOrdinance !== after.adoptionOrdinance || before.adoptionOrdinanceDoc !== after.adoptionOrdinanceDoc) rest.push('adoption details');
  if (before.amended !== after.amended || before.amendmentOrdinance !== after.amendmentOrdinance || before.amendmentName !== after.amendmentName) rest.push('amendment details');
  if (before.tentativeDate !== after.tentativeDate) rest.push('tentative budget date');
  if (JSON.stringify(before.docs) !== JSON.stringify(after.docs)) rest.push('documents');
  if (JSON.stringify(before.general) !== JSON.stringify(after.general)) rest.push('totals');
  // The pages show a group's lines in the table's order, so the order inside a group's list is not a change.
  const inGroups = (gs: ReadonlyArray<object>) => JSON.stringify(gs.map((g) => Object.fromEntries(Object.entries(g).map(([k, v]: [string, unknown]) => [k, Array.isArray(v) ? [...v].sort() : v]))));
  if (inGroups(before.spendGroups) !== inGroups(after.spendGroups) || inGroups(before.revenueGroups) !== inGroups(after.revenueGroups)) rest.push('chart groups');
  if (rest.length) parts.push(`also changed: ${rest.join(', ')}`);
  return parts.join('; ') || 'no figures changed';
}
