/**
 * "Construction now": the rows of the city's Construction Projects page table, with what staff changed in the staff portal
 * laid over (site_content key "construction"). Staff can correct a row the city page has, hide one that is finished, or add
 * a project the page does not list yet. Shared by the worker (GET /api/construction and the assistant) and the staff screen.
 */

export interface GlanceTable {
  heading: string | null;
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** The parts of a row staff can set. */
export interface WorkFields {
  where: string;
  work: string;
  status: string;
  expected: string;
}

export interface AddedWork extends WorkFields {
  id: string;
  name: string;
}

export interface ConstructionContent {
  /** Corrections to rows on the city page, by rowKey of the project name. Only the fields staff changed. */
  edits: Record<string, Partial<WorkFields>>;
  hidden: string[];
  added: AddedWork[];
}

export const WORK_LIMITS = { name: 90, where: 120, work: 400, status: 80, expected: 60 } as const;
export const WORK_ADDED_MAX = 30;
export const WORK_FIELDS: Array<keyof WorkFields> = ['where', 'work', 'status', 'expected'];

/** A row's identity: its project name, case and spacing ignored, so a city page that reflows a cell keeps the edit. */
export const rowKey = (name: string): string => name.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);

export interface Roles {
  title: string;
  where?: string;
  work?: string;
  status?: string;
  expected?: string;
}

/** Which column of the city's table holds what, the same way the public card reads it. */
export function rolesOf(headers: string[]): Roles {
  const find = (re: RegExp) => headers.find((h) => re.test(h.trim()));
  return {
    title: find(/^project/i) ?? headers[0] ?? 'Project',
    where: find(/location|where/i),
    work: find(/work|description/i),
    status: find(/^status/i),
    expected: find(/completion|expected|finish/i),
  };
}

const DEFAULT_HEADERS = ['Project', 'Location', 'Work', 'Status', 'Expected Completion'];

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The table residents see: the city's rows with staff corrections, without hidden ones, then the projects staff added. */
export function mergeConstruction(glance: GlanceTable | null, content: ConstructionContent | null | undefined): GlanceTable | null {
  if (!content || (!Object.keys(content.edits).length && !content.hidden.length && !content.added.length)) return glance;
  const headers = glance?.headers.length ? [...glance.headers] : [...DEFAULT_HEADERS];
  const roles = rolesOf(headers);
  // A field staff set that the city's table has no column for gets one, so it is never lost.
  const column = (f: keyof WorkFields): string => {
    const have = roles[f];
    if (have) return have;
    const name = { where: 'Location', work: 'Work', status: 'Status', expected: 'Expected Completion' }[f];
    if (!headers.includes(name)) headers.push(name);
    roles[f] = name;
    return name;
  };
  const hidden = new Set(content.hidden);
  const rows: Array<Record<string, string>> = [];
  for (const r of glance?.rows ?? []) {
    const key = rowKey(r[roles.title] ?? '');
    if (hidden.has(key)) continue;
    const e = own(content.edits, key) ? content.edits[key] : undefined;
    const next = { ...r };
    if (e) for (const f of WORK_FIELDS) if (typeof e[f] === 'string') next[column(f)] = e[f]!;
    rows.push(next);
  }
  for (const a of content.added) {
    if (hidden.has(a.id)) continue;
    const row: Record<string, string> = { [roles.title]: a.name };
    for (const f of WORK_FIELDS) if (a[f]) row[column(f)] = a[f];
    rows.push(row);
  }
  for (const r of rows) for (const h of headers) r[h] ??= '';
  return { heading: glance?.heading ?? null, headers, rows };
}

/** The city's rows as staff edit them: name, the fields, and whether staff changed or hid it. */
export interface WorkRow extends WorkFields {
  key: string;
  name: string;
  city: boolean;
  edited: boolean;
  hidden: boolean;
  original: WorkFields | null;
}

export function workRows(glance: GlanceTable | null, content: ConstructionContent | null | undefined): WorkRow[] {
  const roles = rolesOf(glance?.headers ?? DEFAULT_HEADERS);
  const hidden = new Set(content?.hidden ?? []);
  const out: WorkRow[] = [];
  const seen = new Set<string>();
  for (const r of glance?.rows ?? []) {
    const name = (r[roles.title] ?? '').trim();
    const key = rowKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const original: WorkFields = {
      where: roles.where ? (r[roles.where] ?? '') : '',
      work: roles.work ? (r[roles.work] ?? '') : '',
      status: roles.status ? (r[roles.status] ?? '') : '',
      expected: roles.expected ? (r[roles.expected] ?? '') : '',
    };
    const e = content && own(content.edits, key) ? content.edits[key] : undefined;
    out.push({ key, name, city: true, ...original, ...(e ?? {}), edited: Boolean(e && Object.keys(e).length), hidden: hidden.has(key), original });
  }
  for (const a of content?.added ?? [])
    out.push({ key: a.id, name: a.name, city: false, where: a.where, work: a.work, status: a.status, expected: a.expected, edited: false, hidden: hidden.has(a.id), original: null });
  return out;
}
