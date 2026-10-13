/**
 * The budget as the staff screen edits it, and the spreadsheet import and export. Pure: no React, no network.
 * The server (worker/lib/budgetBook.ts) does the real checking; this file only shapes the data so a row can be typed,
 * pasted or imported without anyone seeing a chart group's key or a list of names.
 */

export interface Fund {
  key: string;
  name: string;
  about: string;
  total: number;
}
export interface Line {
  name: string;
  adopted: number;
  amended: number;
  prior: number;
}
export interface Rev {
  name: string;
  amount: number;
}
export interface Project {
  fund: string;
  dept: string;
  name: string;
  amount: number;
  page: number;
  feature?: number;
  featureName?: string;
}
export interface Spending {
  departments: number;
  transfersOut: number;
  total: number;
  surplus: number;
}
export interface General {
  revenueBeforeTransfers: number;
  transfersIn: number;
  revenueTotal: number;
  adopted: Spending;
  amended: Spending;
  cutByAmendment: number;
  tentativeTotal: number;
}
export interface Docs {
  book: string;
  slides: string;
  amendment: string;
  amendmentSummary: string;
  tentative: string;
}
export interface Series {
  key: string;
  name: string;
  kind: 'revenue' | 'spending';
  values: number[];
}

/** A budget version as the server stores it. */
export interface Book {
  fiscalYear: number;
  adopted: string;
  adoptionOrdinance: string;
  adoptionOrdinanceDoc: string;
  amended: string;
  amendmentOrdinance: string;
  amendmentName: string;
  tentativeDate: string;
  docs: Docs;
  funds: Fund[];
  general: General;
  departments: Line[];
  transfersOut: Line[];
  spendGroups: Array<{ key: string; name: string; depts: string[] }>;
  revenue: Rev[];
  transfersIn: Rev[];
  revenueGroups: Array<{ key: string; name: string; lines: string[] }>;
  historyYears: string[];
  history: Series[];
  projectFunds: Array<{ key: string; name: string }>;
  projects: Project[];
}

export interface Group {
  key: string;
  name: string;
}
export type LineRow = Line & { group: string };
export type RevRow = Rev & { group: string };

/** The budget while it is being edited: each line carries its chart group, so groups are never edited as lists of names. */
export interface Draft extends Omit<Book, 'departments' | 'transfersOut' | 'revenue' | 'transfersIn' | 'spendGroups' | 'revenueGroups'> {
  /** False: the budget has not been amended, so there are no "after amendment" figures. */
  amendedYet: boolean;
  departments: LineRow[];
  transfersOut: LineRow[];
  revenue: RevRow[];
  transfersIn: RevRow[];
  spendGroups: Group[];
  revenueGroups: Group[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function toDraft(book: Book): Draft {
  const b = clone(book);
  const spendOf = (n: string) => b.spendGroups.find((g) => g.depts.includes(n))?.key ?? b.spendGroups[0]?.key ?? '';
  const revOf = (n: string) => b.revenueGroups.find((g) => g.lines.includes(n))?.key ?? b.revenueGroups[0]?.key ?? '';
  return {
    ...b,
    amendedYet: b.amended > b.adopted,
    departments: b.departments.map((d) => ({ ...d, group: spendOf(d.name) })),
    transfersOut: b.transfersOut.map((d) => ({ ...d, group: spendOf(d.name) })),
    revenue: b.revenue.map((r) => ({ ...r, group: revOf(r.name) })),
    transfersIn: b.transfersIn.map((r) => ({ ...r, group: revOf(r.name) })),
    spendGroups: b.spendGroups.map(({ key, name }) => ({ key, name })),
    revenueGroups: b.revenueGroups.map(({ key, name }) => ({ key, name })),
  };
}

/** "Parks and Rec" becomes "parks-and-rec", made different from every key in `taken`. */
export function slug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/^[^a-z]+/, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'item';
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const k = `${base.slice(0, 24 - String(i).length - 1)}-${i}`;
    if (!used.has(k)) return k;
  }
}

/** A key for a group or funding source added on the screen, made at once so lines can point to it before it is saved. */
export function newKey(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Gives every row that has no key one, from its name. */
function keyed<T extends { key: string; name: string }>(rows: T[]): T[] {
  const taken = new Set(rows.map((r) => r.key).filter(Boolean));
  return rows.map((r) => {
    if (r.key) return r;
    const key = slug(r.name, taken);
    taken.add(key);
    return { ...r, key };
  });
}

/** The budget to send: groups rebuilt from the lines, new keys made, and no "after amendment" figures when there was no amendment. */
export function fromDraft(d: Draft): Book {
  const c = clone(d);
  const spendGroups = keyed(c.spendGroups);
  const revenueGroups = keyed(c.revenueGroups);
  const keys = (gs: Group[]) => new Set(gs.map((g) => g.key));
  const spendKeys = keys(spendGroups);
  const revKeys = keys(revenueGroups);
  const first = (gs: Group[]) => gs[0]?.key ?? '';
  const place = (group: string, ks: Set<string>, gs: Group[]) => (ks.has(group) ? group : first(gs));
  const lines = (rows: LineRow[]) => rows.map((r) => ({ ...r, group: place(r.group, spendKeys, spendGroups), name: r.name.trim() }));
  const revs = (rows: RevRow[]) => rows.map((r) => ({ ...r, group: place(r.group, revKeys, revenueGroups), name: r.name.trim() }));
  const departments = lines(c.departments);
  const transfersOut = lines(c.transfersOut);
  const revenue = revs(c.revenue);
  const transfersIn = revs(c.transfersIn);
  const adopted = c.adopted;
  const amended = c.amendedYet ? c.amended : adopted;
  const strip = <T extends { group: string }>({ group: _g, ...rest }: T) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars
  const flat = (rows: LineRow[]): Line[] => rows.map((r) => ({ ...strip(r), amended: c.amendedYet ? r.amended : r.adopted }));
  return {
    fiscalYear: c.fiscalYear,
    adopted,
    adoptionOrdinance: c.adoptionOrdinance,
    adoptionOrdinanceDoc: c.adoptionOrdinanceDoc,
    amended,
    amendmentOrdinance: c.amendedYet ? c.amendmentOrdinance : '',
    amendmentName: c.amendmentName,
    tentativeDate: c.tentativeDate,
    docs: c.amendedYet ? c.docs : { ...c.docs, amendment: '', amendmentSummary: '' },
    funds: keyed(c.funds),
    general: c.amendedYet ? c.general : { ...c.general, amended: { ...c.general.adopted }, cutByAmendment: 0 },
    departments: flat(departments),
    transfersOut: flat(transfersOut),
    spendGroups: spendGroups.map((g) => ({ ...g, depts: [...departments, ...transfersOut].filter((r) => r.group === g.key && r.name).map((r) => r.name) })),
    revenue: revenue.map((r) => strip(r)),
    transfersIn: transfersIn.map((r) => strip(r)),
    revenueGroups: revenueGroups.map((g) => ({ ...g, lines: [...revenue, ...transfersIn].filter((r) => r.group === g.key && r.name).map((r) => r.name) })),
    historyYears: c.historyYears,
    history: keyed(c.history),
    projectFunds: keyed(c.projectFunds),
    projects: c.projects.map((p) => {
      const { feature, featureName, ...rest } = p;
      return feature ? { ...rest, feature, ...(featureName ? { featureName } : {}) } : rest;
    }),
  };
}

export const isDirty = (a: Draft, b: Draft) => JSON.stringify(a) !== JSON.stringify(b);

// ---- money

/** Whole dollars from what someone typed or pasted: "$1,234", "1234.00", "(500)" for -500. Null when it is not an amount. */
export function moneyOf(v: string): number | null {
  let s = v.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

export const showMoney = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '');
export const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

// ---- spreadsheet text

/** Rows of cells from pasted spreadsheet text: tab, comma or semicolon separated, with quotes. */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const first = src.split('\n').find((l) => l.trim()) ?? '';
  const delim = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

const quote = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
export const tableText = (rows: string[][]) => rows.map((r) => r.map(quote).join(',')).join('\n');

export type ColumnKind = 'text' | 'money' | 'whole' | 'fund';
export interface Column {
  key: string;
  label: string;
  kind: ColumnKind;
  /** Other headings that mean this column. */
  also?: string[];
  optional?: boolean;
}

export interface TableSpec {
  id: 'departments' | 'transfersOut' | 'revenue' | 'transfersIn' | 'funds' | 'projects';
  label: string;
  columns: Column[];
}

const NAME: Column = { key: 'name', label: 'Name', kind: 'text', also: ['line', 'line item', 'item', 'description', 'department', 'project'] };
const GROUP: Column = { key: 'group', label: 'Chart group', kind: 'text', also: ['group'], optional: true };

export const TABLES: Record<TableSpec['id'], TableSpec> = {
  departments: {
    id: 'departments',
    label: 'Departments',
    columns: [
      NAME,
      { key: 'prior', label: 'Last year', kind: 'money', also: ['prior', 'prior year', 'fy26', 'last year budget'], optional: true },
      { key: 'adopted', label: 'Adopted', kind: 'money', also: ['adopted budget', 'budget', 'original', 'amount'] },
      { key: 'amended', label: 'After amendment', kind: 'money', also: ['amended', 'final', 'final amended', 'revised'], optional: true },
      GROUP,
    ],
  },
  transfersOut: {
    id: 'transfersOut',
    label: 'Transfers out',
    columns: [
      NAME,
      { key: 'prior', label: 'Last year', kind: 'money', also: ['prior', 'prior year'], optional: true },
      { key: 'adopted', label: 'Adopted', kind: 'money', also: ['adopted budget', 'budget', 'amount'] },
      { key: 'amended', label: 'After amendment', kind: 'money', also: ['amended', 'final', 'revised'], optional: true },
      GROUP,
    ],
  },
  revenue: { id: 'revenue', label: 'Revenue', columns: [NAME, { key: 'amount', label: 'Amount', kind: 'money', also: ['budget', 'adopted', 'revenue'] }, GROUP] },
  transfersIn: { id: 'transfersIn', label: 'Transfers in', columns: [NAME, { key: 'amount', label: 'Amount', kind: 'money', also: ['budget', 'adopted'] }, GROUP] },
  funds: {
    id: 'funds',
    label: 'Funds',
    columns: [
      NAME,
      { key: 'total', label: 'Total', kind: 'money', also: ['amount', 'revenue', 'budget'] },
      { key: 'about', label: 'About', kind: 'text', also: ['description', 'what it pays for'], optional: true },
    ],
  },
  projects: {
    id: 'projects',
    label: 'Capital projects',
    columns: [
      NAME,
      { key: 'fund', label: 'Paid from', kind: 'fund', also: ['fund', 'funding', 'funding source', 'source'] },
      { key: 'amount', label: 'Amount', kind: 'money', also: ['budget', 'cost'] },
      { key: 'page', label: 'Slide page', kind: 'whole', also: ['page', 'slide'], optional: true },
      { key: 'dept', label: 'Department', kind: 'text', also: ['dept'], optional: true },
      { key: 'feature', label: 'Map feature', kind: 'whole', also: ['map', 'map feature number', 'feature', 'objectid'], optional: true },
    ],
  },
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface Imported {
  /** Rows ready to put in the table (cell values by column key). */
  rows: Array<Record<string, string | number>>;
  /** Plain sentences about rows or columns that could not be read. */
  problems: string[];
  /** How the columns were matched, for the preview heading. */
  columns: Column[];
}

/** Reads pasted spreadsheet text for one table. `funds` maps the names of project funding sources to their keys. */
export function importRows(spec: TableSpec, text: string, funds: Array<{ key: string; name: string }> = []): Imported {
  const cells = parseTable(text);
  const problems: string[] = [];
  if (!cells.length) return { rows: [], problems: ['Nothing to read. Paste the rows from your spreadsheet, headings first.'], columns: [] };
  const wanted = (c: Column) => [norm(c.label), norm(c.key), ...(c.also ?? []).map(norm)];
  const head = cells[0].map(norm);
  const index = new Map<string, number>();
  for (const c of spec.columns) {
    const at = head.findIndex((h, i) => wanted(c).includes(h) && ![...index.values()].includes(i));
    if (at >= 0) index.set(c.key, at);
  }
  // A first row with no heading we know is data: the columns are then in the order of the table.
  let body = cells.slice(1);
  if (!index.has('name') || index.size < 2) {
    body = cells;
    index.clear();
    spec.columns.forEach((c, i) => i < (cells[0]?.length ?? 0) && index.set(c.key, i));
  }
  const columns = spec.columns.filter((c) => index.has(c.key));
  for (const c of spec.columns) if (!c.optional && !index.has(c.key)) problems.push(`There is no "${c.label}" column. Put a heading with that name on the first row.`);
  const rows: Imported['rows'] = [];
  body.slice(0, 400).forEach((r, i) => {
    const out: Record<string, string | number> = {};
    const at = (c: Column) => (index.has(c.key) ? (r[index.get(c.key) as number] ?? '') : '');
    for (const c of spec.columns) {
      const raw = at(c);
      if (c.kind === 'text') out[c.key] = raw;
      else if (c.kind === 'fund') {
        const f = funds.find((x) => norm(x.name) === norm(raw) || x.key === raw.toLowerCase().trim());
        if (!f && raw) problems.push(`Row ${i + 1} (${at(NAME)}): "${raw}" is not one of the funding sources.`);
        out[c.key] = f?.key ?? '';
      } else {
        const n = raw ? moneyOf(raw) : null;
        if (raw && n === null) problems.push(`Row ${i + 1} (${at(NAME)}): "${raw}" in ${c.label} is not a number.`);
        out[c.key] = n ?? 0;
      }
    }
    if (!String(out.name).trim()) {
      if (r.some((c) => c)) problems.push(`Row ${i + 1}: write the name.`);
      return;
    }
    rows.push(out);
  });
  if (body.length > 400) problems.push('Only the first 400 rows are read.');
  if (!rows.length && !problems.length) problems.push('No rows found under the headings.');
  return { rows, problems, columns };
}

/** A table as spreadsheet text, headings first, for downloading or copying. */
export function exportRows(spec: TableSpec, rows: ReadonlyArray<object>, funds: Array<{ key: string; name: string }> = [], groups: Group[] = []): string {
  const cols = spec.columns;
  const head = cols.map((c) => c.label);
  const body = rows.map((r) =>
    cols.map((c) => {
      const v = (r as Record<string, unknown>)[c.key];
      if (c.kind === 'fund') return funds.find((f) => f.key === v)?.name ?? String(v ?? '');
      if (c.key === 'group') return groups.find((g) => g.key === v)?.name ?? '';
      return v === undefined || v === null || (v === 0 && c.key === 'feature') ? '' : String(v);
    }),
  );
  return tableText([head, ...body]);
}

/** The blank row for a table. */
export function blankRow(id: TableSpec['id'], group = ''): Record<string, string | number> {
  if (id === 'revenue' || id === 'transfersIn') return { name: '', amount: 0, group };
  if (id === 'funds') return { key: '', name: '', about: '', total: 0 };
  if (id === 'projects') return { fund: '', dept: '', name: '', amount: 0, page: 1 };
  return { name: '', prior: 0, adopted: 0, amended: 0, group };
}

/** Rows the import produced, turned into rows of the draft's table (the chart group matched by name, else the first group). */
export function applyImport(d: Draft, id: TableSpec['id'], imported: Imported['rows']): Draft {
  const groupKey = (name: unknown, groups: Group[]) => groups.find((g) => norm(g.name) === norm(String(name ?? '')) || g.key === String(name ?? '').trim())?.key ?? groups[0]?.key ?? '';
  if (id === 'departments' || id === 'transfersOut') {
    const rows = imported.map((r) => ({
      name: String(r.name),
      prior: Number(r.prior ?? 0),
      adopted: Number(r.adopted ?? 0),
      amended: r.amended === undefined || r.amended === '' || r.amended === 0 ? Number(r.adopted ?? 0) : Number(r.amended),
      group: groupKey(r.group, d.spendGroups),
    }));
    return { ...d, [id]: rows };
  }
  if (id === 'revenue' || id === 'transfersIn') {
    return { ...d, [id]: imported.map((r) => ({ name: String(r.name), amount: Number(r.amount ?? 0), group: groupKey(r.group, d.revenueGroups) })) };
  }
  if (id === 'funds') {
    const existing = new Map(d.funds.map((f) => [norm(f.name), f]));
    const rows = imported.map((r) => ({
      key: existing.get(norm(String(r.name)))?.key ?? '',
      name: String(r.name),
      about: String(r.about ?? '') || (existing.get(norm(String(r.name)))?.about ?? ''),
      total: Number(r.total ?? 0),
    }));
    return { ...d, funds: rows };
  }
  const old = new Map(d.projects.map((p) => [`${p.fund}|${norm(p.name)}`, p]));
  const projects = imported.map((r) => {
    const was = old.get(`${r.fund}|${norm(String(r.name))}`);
    const feature = Number(r.feature ?? 0) || was?.feature;
    const p: Project = { fund: String(r.fund), dept: String(r.dept ?? '') || was?.dept || '', name: String(r.name), amount: Number(r.amount ?? 0), page: Number(r.page ?? 0) || was?.page || 1 };
    if (feature) {
      p.feature = feature;
      if (was?.featureName && was.feature === feature) p.featureName = was.featureName;
    }
    return p;
  });
  return { ...d, projects };
}

/** Sections of the editor, in the order a person works through them. */
export const STEPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'spending', label: 'Spending' },
  { id: 'funds', label: 'Funds' },
  { id: 'totals', label: 'Totals' },
  { id: 'projects', label: 'Projects' },
  { id: 'more', label: 'Charts' },
  { id: 'save', label: 'Save' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

/** The step a server sentence is about, from the table name it starts with. */
export function stepOfProblem(sentence: string): StepId {
  const head = sentence.split(/[,:(]/)[0].trim().toLowerCase();
  if (head === 'basics' || head === 'documents') return 'basics';
  if (head === 'revenue' || head === 'transfers in') return 'revenue';
  if (head === 'departments' || head === 'transfers out') return 'spending';
  if (head === 'funds') return 'funds';
  if (head === 'totals') return 'totals';
  if (head === 'capital projects' || head === 'project funding sources') return 'projects';
  return 'more';
}

/** What the lines add up to, to show beside the totals people type. */
export function lineSums(d: Draft) {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    revenue: sum(d.revenue.map((r) => r.amount)),
    transfersIn: sum(d.transfersIn.map((r) => r.amount)),
    departmentsAdopted: sum(d.departments.map((r) => r.adopted)),
    departmentsAmended: sum(d.departments.map((r) => r.amended)),
    transfersOutAdopted: sum(d.transfersOut.map((r) => r.adopted)),
    transfersOutAmended: sum(d.transfersOut.map((r) => r.amended)),
  };
}

/** How far a typed total may be from its lines before the screen says so (the printed book rounds; the server allows the same). */
export const TOLERANCE = 5;
