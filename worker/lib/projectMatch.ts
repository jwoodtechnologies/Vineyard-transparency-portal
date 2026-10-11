/**
 * Funded capital projects and the conservative name matching that ties other records to them
 * (votes, archive documents, rows of the city's Construction Projects table). Pure, unit-tested in
 * tests/worker-project-detail.test.ts.
 *
 * A funded project is either one feature of the city's Capital Improvement Plan map (FY27_PLAN,
 * with every budget line behind it) or one budget line from the FY 27 Final Budget Slides that is not
 * on the map. Its names are the map name (when it has one) and its budget line names.
 *
 * Matching rule (see `nameMatch`): both texts are normalized (lower case, "&" to "and", N/S/E/W and
 * St/Rd/Ave spelled out, plural "s" dropped, a number and its direction joined into one token such
 * as "400north"), then stop words and generic words ("design", "construction", "improvements",
 * "city"...) are set aside. Notes in parentheses and a trailing "near ..." place are not part of a
 * name. With one or two distinctive words left, the text must contain the whole name as a phrase.
 * With three, it must contain all three; with four or more, at least two thirds of them. Either way
 * it must contain every numbered token ("400north", "2") and two of them side by side in the name's order.
 * A record goes to a project only when that project is the single best match among all funded
 * projects (`bestProject`); a tie goes to none.
 */
import { BUDGET_ADOPTED, BUDGET_ADOPTION_ORDINANCE, PROJECTS, PROJECT_FUNDS, type CapitalProject } from './budgetData';
import { FY27_PLAN } from './capitalPlan';

export interface FundedProject {
  /** "plan-25" for a map feature, "line-water-secondary-water-master-plan" for a budget line alone. */
  key: string;
  /** The city's map name, else the budget line name. */
  name: string;
  gis: string | null;
  lines: CapitalProject[];
  /** Names used for matching. */
  variants: string[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

/**
 * A name as matched: notes in parentheses ("(RAP tax and UORG grant)", "(Pipelining)") and a trailing
 * "near ..." place ("Skate park near Vineyard City Hall") are not part of it.
 */
const lineName = (n: string) =>
  n
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+near\s+.*$/i, '')
    .trim();

let catalog: FundedProject[] | null = null;
export function fundedProjects(): FundedProject[] {
  if (catalog) return catalog;
  const inPlan = new Set<string>();
  const out: FundedProject[] = [];
  for (const m of FY27_PLAN) {
    const lines = m.budget.map(([fund, name]) => PROJECTS.find((p) => p.fund === fund && p.name === name)).filter((p): p is CapitalProject => Boolean(p));
    for (const l of lines) inPlan.add(`${l.fund}|${l.name}`);
    out.push({ key: `plan-${m.id}`, name: m.gis, gis: m.gis, lines, variants: [...new Set([lineName(m.gis), ...lines.map((l) => lineName(l.name))])] });
  }
  for (const l of PROJECTS) {
    if (inPlan.has(`${l.fund}|${l.name}`)) continue;
    out.push({ key: `line-${l.fund}-${slug(l.name)}`, name: l.name, gis: null, lines: [l], variants: [lineName(l.name)] });
  }
  catalog = out;
  return out;
}

/** The funded project for a map name (exact) or a budget line (exact fund and name), else null. */
export function findProject(q: { gis?: string | null; fund?: string | null; name?: string | null; key?: string | null }): FundedProject | null {
  const all = fundedProjects();
  if (q.key) return all.find((p) => p.key === q.key) ?? null;
  const gis = q.gis?.trim();
  if (gis) return all.find((p) => p.gis === gis) ?? null;
  if (q.fund && q.name) return all.find((p) => p.lines.some((l) => l.fund === q.fund && l.name === q.name)) ?? null;
  return null;
}

// ------------------------------------------------------------------------------------------ matching

const STOP = new Set('a an and are as at be by for from in into is of on onto or the to via with near along all its'.split(' '));
const GENERIC = new Set(
  'city vineyard wide project projects improvement design construct construction finish install installation upgrade new phase additional cost carried over rolled portion one two fy25 fy26 fy27 fy2027 update approve approval award contract agreement resolution ordinance item'.split(' '),
);
const DIRECTION: Record<string, string> = { n: 'north', s: 'south', e: 'east', w: 'west' };
const ABBR: Record<string, string> = { st: 'street', rd: 'road', ave: 'avenue', blvd: 'boulevard', dr: 'drive', ln: 'lane', hwy: 'highway', ...DIRECTION };
const DIRS = new Set(Object.values(DIRECTION));

const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Every word, normalized: lower case, abbreviations spelled out, plural "s" dropped. Stop words kept. */
export function normWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\btake[\s-]+down\b/g, 'takedown')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => stem(ABBR[w] ?? w));
}

export interface Token {
  key: string;
  /** Words as written, for a search phrase ("400 north"). */
  raw: string;
}

/** The distinctive tokens of a text, in order: a number and its direction joined ("400north"), stop and generic words left out. */
export function distinctTokens(text: string): Token[] {
  const w = normWords(text);
  const out: Token[] = [];
  for (let i = 0; i < w.length; i++) {
    if (/^\d+$/.test(w[i]) && DIRS.has(w[i + 1] ?? '')) {
      out.push({ key: `${w[i]}${w[i + 1]}`, raw: `${w[i]} ${w[i + 1]}` });
      i++;
      continue;
    }
    if (STOP.has(w[i]) || GENERIC.has(w[i])) continue;
    out.push({ key: w[i], raw: w[i] });
  }
  return out;
}

const containsRun = (hay: string[], needle: string[]) => {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((n, j) => hay[i + j] === n)) return true;
  return false;
};

/**
 * How strongly `text` names the project called `name`: the number of its distinctive tokens found,
 * or 0 when the rule in the header is not met.
 */
export function nameMatch(name: string, text: string): number {
  const p = distinctTokens(name);
  if (!p.length) return 0;
  if (p.length <= 2) return containsRun(normWords(text), normWords(name)) ? p.length : 0;
  const c = distinctTokens(text);
  const have = new Set(c.map((t) => t.key));
  const pk = p.map((t) => t.key);
  const found = [...new Set(pk)].filter((k) => have.has(k));
  const n = new Set(pk).size;
  if (found.length < (n === 3 ? 3 : Math.ceil((2 * n) / 3))) return 0;
  if (!pk.filter((k) => /\d/.test(k)).every((k) => have.has(k))) return 0;
  const ck = c.map((t) => t.key);
  let adjacent = false;
  for (let i = 0; i + 1 < pk.length && !adjacent; i++) adjacent = containsRun(ck, [pk[i], pk[i + 1]]);
  return adjacent ? found.length : 0;
}

/** A project's best score against a text, over all its names. */
export function projectScore(p: FundedProject, text: string): number {
  return Math.max(0, ...p.variants.map((v) => nameMatch(v, text)));
}

/** The single funded project a text names best, or null when none matches or two tie. */
export function bestProject(text: string, all: FundedProject[] = fundedProjects()): FundedProject | null {
  let best: FundedProject | null = null;
  let top = 0;
  let tie = false;
  for (const p of all) {
    const s = projectScore(p, text);
    if (s > top) {
      best = p;
      top = s;
      tie = false;
    } else if (s > 0 && s === top) tie = true;
  }
  return top > 0 && !tie ? best : null;
}

/** True when `text` names this project and no other funded project as well or better. */
export const namesProject = (p: FundedProject, text: string, all?: FundedProject[]) => bestProject(text, all)?.key === p.key;

/** Phrases for a title search that can find records naming the project (two adjacent tokens, or a short name whole). */
export function searchPhrases(p: FundedProject): string[] {
  const out = new Set<string>();
  for (const v of p.variants) {
    const t = distinctTokens(v);
    if (t.length <= 2) {
      if (t.length) out.add(normWords(v).join(' '));
      continue;
    }
    for (let i = 0; i + 1 < t.length; i++) out.add(`${t[i].raw} ${t[i + 1].raw}`);
  }
  return [...out].slice(0, 16);
}

// ------------------------------------------------------------------------------------------ budget

export const SLIDES_TITLE = 'FY 27 Final Budget Slides';
const fundName = (key: string) => PROJECT_FUNDS.find((f) => f.key === key)?.name ?? key;

export interface BudgetBlock {
  total: number;
  adopted: string;
  documentTitle: string;
  lines: Array<{ name: string; fund: string; fundName: string; dept: string; amount: number; page: number }>;
}

export function budgetBlock(p: FundedProject, slidesId: string): BudgetBlock & { documentId: string } {
  return {
    total: p.lines.reduce((s, l) => s + l.amount, 0),
    adopted: BUDGET_ADOPTED,
    documentId: slidesId,
    documentTitle: SLIDES_TITLE,
    lines: p.lines.map((l) => ({ name: l.name, fund: l.fund, fundName: fundName(l.fund), dept: l.dept, amount: l.amount, page: l.page })),
  };
}

// ------------------------------------------------------------------------------------------ votes

export interface MotionLike {
  id: string;
  date: string | null;
  bodyId: string | null;
  bodyName: string | null;
  item: string | null;
  motion: string;
  result: string;
  tally: string | null;
  items: string[];
  documentId: string;
  page: number | null;
  votes: Array<{ member: string; vote: string }>;
}

export interface ProjectVote {
  kind: 'budget' | 'project';
  label: string;
  /** "Resolution RDA-2026-03", only when the motion or its agenda item prints it. */
  number: string | null;
  date: string;
  body: string | null;
  result: string;
  documentId: string;
  page: number | null;
  votes: Array<{ member: string; vote: string }>;
}

const NUMBER = /\b(resolution|ordinance)\s+(?:no\.?\s*)?((?:rda\s*[-–]\s*)?(?:19|20)\d{2}\s*[-–]\s*\d{1,3}[a-z]?)\b/i;
const numberIn = (s: string | null | undefined): string | null => {
  const m = NUMBER.exec(s ?? '');
  if (!m) return null;
  const kind = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return `${kind} ${m[2].replace(/\s+/g, '').replace(/–/g, '-').toUpperCase()}`;
};

/** The ordinance or resolution number printed with a motion: its agenda item first, the motion only when they agree or the item has none. */
export function motionNumber(m: Pick<MotionLike, 'item' | 'motion'>): string | null {
  const a = numberIn(m.item);
  const b = numberIn(m.motion);
  if (a && b && a !== b) return null;
  return a ?? b;
}

/** En and em dashes shown as hyphens (the portal's style); the words are unchanged. */
export const noDash = (s: string) => s.replace(/\s*[\u2013\u2014]\s*/g, (m) => (/\s/.test(m) ? ' - ' : '-'));

/** An agenda item or motion as a short label: numbering, the presenter in parentheses and a leading "to" taken off. */
export function cleanLabel(s: string): string {
  const out = noDash(s)
    .replace(/\s+/g, ' ')
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^to\s+/i, '')
    .trim();
  const cap = out.charAt(0).toUpperCase() + out.slice(1);
  return cap.length > 140 ? `${cap.slice(0, 137).replace(/\s+\S*$/, '')}...` : cap;
}

/** The council's (or the RDA board's) vote adopting the fiscal 2027 budget, held on the adoption date. */
export function isBudgetAdoption(m: Pick<MotionLike, 'date' | 'result' | 'item' | 'motion'>): boolean {
  if (m.date !== BUDGET_ADOPTED || m.result !== 'carried') return false;
  const t = `${m.item ?? ''} ${m.motion}`.toLowerCase().replace(/[^a-z0-9\s\-–]/g, ' ');
  return /\bbudget\b/.test(t) && /(2026\s*[-–]\s*2027|\bfy\s*27\b|\bfy\s*2027\b|fiscal\s+year\s+2027)/.test(t) && !/\btentative\b|\bamending the\b|\bamendments? to the (?:fiscal|fy|budget|\d{4})/.test(t);
}

/** Which body adopted the budget for a fund: the Redevelopment Agency board for its own fund, the City Council for the rest. */
const adoptingBody = (fund: string) => (fund === 'rda' ? 'redevelopment-agency' : 'city-council');

/** The votes behind a project: the budget adoption for each body whose budget carries it, and any motion on the project itself. */
export function projectVotes(p: FundedProject, motions: MotionLike[], all: FundedProject[] = fundedProjects()): ProjectVote[] {
  const out: ProjectVote[] = [];
  const bodies = [...new Set(p.lines.map((l) => adoptingBody(l.fund)))];
  const base = (m: MotionLike) => ({ number: motionNumber(m), date: m.date as string, body: m.bodyName, result: m.result, documentId: m.documentId, page: m.page, votes: m.votes });
  const adoption = motions.filter(isBudgetAdoption);
  for (const body of bodies)
    for (const m of adoption.filter((x) => x.bodyId === body))
      // The council's budget vote: the minutes do not print the ordinance number, Ordinance 2026-08 itself does (budgetData).
      out.push({ kind: 'budget', label: body === 'redevelopment-agency' ? 'Approved the RDA budget for FY 2027' : 'Approved the FY 2027 budget', ...base(m), number: motionNumber(m) ?? (body === 'city-council' ? BUDGET_ADOPTION_ORDINANCE : null) });
  for (const m of motions) {
    if (!m.date || isBudgetAdoption(m)) continue;
    // A consent motion: the one consent item that names the project.
    const consent = (m.items ?? []).find((it) => namesProject(p, it, all));
    const text = consent ?? [m.item, m.motion].find((t) => t && namesProject(p, t, all));
    if (!text) continue;
    out.push({ kind: 'project', label: cleanLabel(consent ?? (m.item && namesProject(p, m.item, all) ? m.item : m.motion)), ...base(m) });
  }
  return out.sort((a, b) => Number(a.kind === 'project') - Number(b.kind === 'project') || b.date.localeCompare(a.date));
}

// ------------------------------------------------------------------------------------------ status

export interface ProjectStatus {
  label: string;
  /** "Early November", as the city's table prints it. */
  completion: string | null;
  asOf: string;
  source: 'construction' | 'budget';
  sourceUrl: string | null;
  documentId: string | null;
}

const col = (row: Record<string, string>, re: RegExp) => {
  const k = Object.keys(row).find((h) => re.test(h));
  return k ? (row[k] ?? '').trim() : '';
};

/** The row of the city's "at a glance" table for this project (project and location must name it), else null. */
export function glanceStatus(p: FundedProject, rows: Array<Record<string, string>>, asOf: string, sourceUrl: string | null, all: FundedProject[] = fundedProjects()): ProjectStatus | null {
  for (const r of rows) {
    const text = [col(r, /project/i), col(r, /location/i)].filter(Boolean).join(' ');
    const status = col(r, /status/i);
    if (!status || !namesProject(p, text, all)) continue;
    const done = col(r, /complet/i);
    return { label: noDash(status), completion: done && !/^(tbd|n\/?a|-)$/i.test(done) ? noDash(done) : null, asOf, source: 'construction', sourceUrl, documentId: null };
  }
  return null;
}

export function budgetStatus(bookId: string): ProjectStatus {
  return { label: 'Funded in the adopted FY 2027 budget', completion: null, asOf: BUDGET_ADOPTED, source: 'budget', sourceUrl: null, documentId: bookId };
}

// ------------------------------------------------------------------------------------------ documents

/** Record types that can be about one project: contracts, bid awards and staff reports, and the resolutions that approve them. */
export const RELATED_TYPES = ['contract', 'interlocal_agreement', 'professional_services_agreement', 'procurement', 'staff_report', 'resolution', 'memorandum', 'exhibit', 'public_notice'] as const;
/** Records older than fiscal 2025 belong to earlier plans. */
export const RELATED_FROM = '2024-07-01';

export interface RelatedDoc {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  date: string | null;
}
