/**
 * Funded project data for the projects list beside the map (MapProjects). Two sources:
 *  1. The city's own construction notices and email updates (vineyardutah.gov, Public Works,
 *     Construction Projects), written here as dated entries, newest first. Every line below is taken
 *     from a notice the city posted; nothing is inferred.
 *  2. The city's Capital Improvement Plan map, fetched live from /api/map/layers/projects (stage,
 *     percent, years, fiscal 2027 amount and fund), with plain descriptions from the council's
 *     FY 2026-2027 Capital Projects Reference Guide.
 */
import { formatDate } from '@/lib/dates';
import { PROJECT_CATEGORIES, type ProjectCategory } from '@/lib/projectCategories';
import { META, builtInMeta, type ProjectMeta } from '@/lib/projectMeta';

export { META, builtInMeta };

export type Stage = 'Planning' | 'Design' | 'Procurement' | 'Construction';
export const STAGES: Stage[] = ['Planning', 'Design', 'Procurement', 'Construction'];

export interface DocRef {
  label: string;
  /** Portal record id: opens in the portal's own viewer. */
  id?: string;
  /** Otherwise the city's own file. */
  href?: string;
}

export interface Site {
  id: string;
  label: string;
  lat: number;
  lon: number;
}

export interface Update {
  /** ISO date, or a label for a date range. */
  date: string;
  /** Shown instead of a formatted date when the notice gives a range. */
  when?: string;
  title: string;
  text: string;
}

export interface Contact {
  label: string;
  phone?: string;
  email?: string;
}

export interface ActiveProject {
  id: string;
  n: number;
  title: string;
  where: string;
  summary: string;
  facts: Array<[string, string]>;
  expect: string[];
  updates: Update[];
  sites: Site[];
  contact: Contact;
  docs: DocRef[];
  /** Date of the city's latest update, when it posts them. */
  asOf?: string;
}

const CITY = 'https://www.vineyardutah.gov/';

export const CITY_PAGE = `${CITY}government/construction_projects.php`;

export const STAGE_COLOR: Record<Stage, { light: string; dark: string }> = {
  Planning: { light: '#d8bccb', dark: '#6e4a5e' },
  Design: { light: '#bb82a3', dark: '#a0647f' },
  Procurement: { light: '#964c78', dark: '#c98fb0' },
  Construction: { light: '#6a1f46', dark: '#efc3da' },
};

export type Category = ProjectCategory;
export const CATEGORIES: Category[] = [...PROJECT_CATEGORIES];

/** What staff changed about a project on the plan map. Only the fields they changed are present. */
export interface ProjectEdit {
  name?: string;
  category?: Category;
  about?: string;
}

export interface AlsoFunded {
  id: string;
  name: string;
  about: string;
}

/** Wording staff saved in the staff portal (served by /api/content). It replaces the built-in wording below, field by field. */
export interface ProjectsContent {
  /** By the project's name on the city's plan map. */
  plans: Record<string, ProjectEdit>;
  /** The "also funded" list; null means the built-in list. */
  also: AlsoFunded[] | null;
}

/** What staff saved for a project, found by its exact name (never an inherited object member such as "constructor"). */
export const editOf = (content: ProjectsContent | null | undefined, gisName: string): ProjectEdit | undefined =>
  content && Object.prototype.hasOwnProperty.call(content.plans, gisName) ? content.plans[gisName] : undefined;

/** Staff-saved wording as it arrives from /api/content, or null when it is missing or not the expected shape, so a bad answer can never break the page. */
export function asProjectsContent(v: unknown): ProjectsContent | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { plans?: unknown; also?: unknown };
  const plans = o.plans && typeof o.plans === 'object' && !Array.isArray(o.plans) ? (o.plans as ProjectsContent['plans']) : {};
  const also = Array.isArray(o.also)
    ? (o.also as unknown[]).filter((a): a is AlsoFunded => !!a && typeof a === 'object' && typeof (a as AlsoFunded).name === 'string' && typeof (a as AlsoFunded).id === 'string')
    : null;
  return { plans, also: also ? also.map((a) => ({ id: a.id, name: a.name, about: typeof a.about === 'string' ? a.about : '' })) : null };
}

/** The wording shown for a project: what staff saved, field by field, over the built-in wording. */
export function metaFor(gisName: string, edit?: ProjectEdit | null): ProjectMeta {
  const base = builtInMeta(gisName);
  return { name: edit?.name || base.name, category: edit?.category ?? base.category, about: edit?.about || base.about };
}

/** Funded this year and described in the council's reference guide, but not drawn on the city's plan map. */
export const ALSO_FUNDED: Array<{ name: string; about: string }> = [
  { name: '170 North and North Vineyard Road crosswalk', about: 'A new pedestrian crosswalk for safety and access.' },
  { name: 'Pedestrian ramp updates', about: 'ADA-compliant ramps at Heritage Boulevard, Main Street and Center Street.' },
  { name: 'Pedestrian enhancements at the South Main Street roundabout', about: 'Safer, easier crossings for people on foot and on bikes.' },
  { name: 'Tucker Row Park', about: 'Design and construction of a neighborhood park.' },
  { name: 'Trail bench program', about: 'Benches along the trail system.' },
  { name: 'City bike park improvements', about: 'Design and construction of improvements to the city bike park.' },
  { name: 'Habitat structure at Penny Springs Pond', about: 'Fish habitat structures that support recreational fishing.' },
  { name: 'Fish cleaning station at Penny Springs Park', about: 'A fish cleaning station for park visitors.' },
  { name: 'Concrete aprons around hydrants', about: 'Concrete aprons that improve access and reduce erosion around fire hydrants.' },
];

/** The "also funded" list shown: the one staff saved, or the built-in one. */
export function alsoFunded(content?: ProjectsContent | null): AlsoFunded[] {
  // The ids look like the ones the server makes, so they survive the first save and a row keeps its place on screen.
  return content?.also ?? ALSO_FUNDED.map((a, i) => ({ id: `a_0b17${i.toString(16).padStart(4, '0')}`, ...a }));
}

export interface PlanProps {
  Project_Name?: string;
  Department?: string;
  Project_Phase?: string;
  Phase_Status?: string;
  Location?: string;
  Description?: string;
  Start_Date?: number;
  Finish_Date?: number;
  Consultant?: string;
  FY27_Budget?: number;
  FY27_Source?: string;
}

export interface Plan {
  key: string;
  gis: string;
  name: string;
  category: Category;
  about?: string;
  stage: Stage;
  /** 0 to 100, progress within the stage. */
  pct: number | null;
  start: number | null;
  finish: number | null;
  department: string;
  location: string;
  consultant: string;
  budget: number | null;
  source: string;
  bounds: [[number, number], [number, number]] | null;
}

const stageOf = (s: unknown): Stage => (STAGES.find((x) => x === s) as Stage | undefined) ?? 'Planning';
const year = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 2000 && n <= 2100 ? n : null;
};

type Pos = number[];
function walk(coords: unknown, out: Pos[]) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') out.push(coords as Pos);
  else for (const c of coords) walk(c, out);
}

export function boundsOfGeometry(g: object | null | undefined): [[number, number], [number, number]] | null {
  const coords = (g as { coordinates?: unknown } | null | undefined)?.coordinates;
  if (!coords) return null;
  const pts: Pos[] = [];
  walk(coords, pts);
  if (!pts.length) return null;
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const [x, y] of pts) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [
    [w, s],
    [e, n],
  ];
}

export function plansFrom(fc: { features: Array<{ properties?: PlanProps | null; geometry?: object | null }> }, content?: ProjectsContent | null): Plan[] {
  const list = fc.features.map((f, i): Plan => {
    const p = f.properties ?? {};
    const gis = String(p.Project_Name ?? '').trim();
    const m = metaFor(gis, editOf(content, gis));
    const pct = /^\d+(\.\d+)?%$/.test(String(p.Phase_Status ?? '')) ? Number.parseFloat(String(p.Phase_Status)) : null;
    return {
      key: `${i}:${gis}`,
      gis,
      name: m.name,
      category: m.category,
      about: m.about,
      stage: stageOf(p.Project_Phase),
      pct,
      start: year(p.Start_Date),
      finish: year(p.Finish_Date),
      department: String(p.Department ?? ''),
      location: String(p.Location ?? '').replace(/\s*\(\d+%\)\s*$/, ''),
      consultant: String(p.Consultant ?? ''),
      budget: Number.isFinite(Number(p.FY27_Budget)) && p.FY27_Budget != null ? Number(p.FY27_Budget) : null,
      source: String(p.FY27_Source ?? ''),
      bounds: boundsOfGeometry(f.geometry),
    };
  });
  // Furthest along first, then by name.
  return list.filter((p) => p.gis).sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) || a.name.localeCompare(b.name));
}

export const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function millions(n: number): string {
  return `$${(n / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} million`;
}

/** "Aug 21, 2026" from an ISO date, with no timezone drift. */
export function shortDate(iso: string): string {
  return formatDate(iso);
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
