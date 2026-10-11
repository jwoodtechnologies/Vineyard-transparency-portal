/**
 * Construction page data. Two sources:
 *  1. The city's own construction notices and email updates (vineyardutah.gov, Public Works,
 *     Construction Projects), written here as dated entries, newest first. Every line below is taken
 *     from a notice the city posted; nothing is inferred.
 *  2. The city's Capital Improvement Plan map, fetched live from /api/map/layers/projects (stage,
 *     percent, years, fiscal 2027 amount and fund), with plain descriptions from the council's
 *     FY 2026-2027 Capital Projects Reference Guide.
 */

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

export type Category = 'Roads and traffic' | 'Parks and trails' | 'Water and sewer' | 'Buildings and equipment' | 'Plans and studies';
export const CATEGORIES: Category[] = ['Roads and traffic', 'Parks and trails', 'Water and sewer', 'Buildings and equipment', 'Plans and studies'];

interface Meta {
  name: string;
  category: Category;
  about?: string;
}

/** Display name, group and plain description for each project on the city's plan map. */
const META: Record<string, Meta> = {
  '1200 North Bridge': {
    name: '1200 North overpass bridge',
    category: 'Roads and traffic',
    about: 'Design is underway. Construction is expected in the next construction season, to improve regional connectivity and traffic flow. The city received $10 million from the State for this project.',
  },
  '1600 N Geneva Road Intersection Widening': {
    name: '1600 North and Geneva Road intersection widening',
    category: 'Roads and traffic',
    about: 'More capacity and better traffic flow at 1600 North and Geneva Road. The project is reimbursed over seven years through the RDA.',
  },
  '300 West Striping & Design (Parking Implementation)': {
    name: '300 West striping and parking',
    category: 'Roads and traffic',
    about: 'Restriping and parking layout changes along 300 West to improve traffic operations and parking.',
  },
  '400 North & Mill Road Traffic Signal': { name: 'Traffic signal at 400 North and Mill Road', category: 'Roads and traffic', about: 'A new traffic signal at 400 North and Mill Road, paid for by the Redevelopment Agency.' },
  'Holdaway Fields 400 S Extension': {
    name: 'Holdaway Fields 400 South extension',
    category: 'Roads and traffic',
    about: 'Transportation improvements on the 400 South corridor that connect into the Holdaway Fields development, for safety and mobility.',
  },
  'Install Street Lights – 170 South': {
    name: 'Street lights on 170 South',
    category: 'Roads and traffic',
    about: 'New street lighting along 170 South to improve visibility, safety and the walking experience.',
  },
  'Traffic Signal – 600 N & Main': { name: 'Traffic signal at 600 North and Main', category: 'Roads and traffic', about: 'A new traffic signal at 600 North and Main Street.' },
  'Vineyard Connector Overpass Bridge': { name: 'Vineyard Connector overpass bridge', category: 'Roads and traffic', about: 'The Vineyard Connector promenade overpass, built with UDOT.' },
  'Holdaway Road Complete Street Design & Survey': {
    name: 'Holdaway Road complete street design',
    category: 'Roads and traffic',
    about: 'Planning for bicycle connections and roadway improvements along the Holdaway corridor.',
  },
  'Rail Consolidation': { name: 'Rail consolidation', category: 'Roads and traffic', about: 'Removing and realigning a rail spur.' },
  'Slide Hill at Grove Park': { name: 'Slide hill at Vineyard Grove Park', category: 'Parks and trails', about: 'A recreational slide hill, a new outdoor play feature for the park.' },
  "Engineering for Field (Gammon Park / Robin's Property)": {
    name: "Gammon Park and Robin's property design",
    category: 'Parks and trails',
    about: "Design of a new athletic field at Gammon Park, with four tennis courts and a dirt infield, and a master plan for Robin's property.",
  },
  'Skate Park & Pump Track': { name: 'Skate park and pump track', category: 'Parks and trails', about: 'A community skate park south of City Hall, paid for with RAP tax and a grant.' },
  'Vineyard Beach Park': {
    name: 'Vineyard Beach improvements',
    category: 'Parks and trails',
    about: 'Planning and design for better public access and recreation at Vineyard Beach. Partly paid for by the Utah County TRCC grant.',
  },
  'Utah Lake Shoreline Trail Amenities': {
    name: 'Utah Lake shoreline trail amenities',
    category: 'Parks and trails',
    about: 'Design and construction of shoreline trail and bike station improvements.',
  },
  'Lift Station 2 Upgrade': { name: 'Lift Station 2 upgrade', category: 'Water and sewer', about: 'An upgrade to the sewer lift station on 1600 North, carried over from last year.' },
  'Storage Building - Lift Station 2': { name: 'Storage building at Lift Station 2', category: 'Water and sewer' },
  'Water Shares Purchase': {
    name: 'Water share purchases',
    category: 'Water and sewer',
    about: 'Funds set aside to buy water shares when they become available and qualify to benefit the city.',
  },
  'Sewer System Improvements (Pipelining)': { name: 'Sewer pipe lining', category: 'Water and sewer', about: 'Sewer system improvements by pipe lining.' },
  'Secondary Water Master Plan': { name: 'Secondary water master plan', category: 'Water and sewer', about: 'A master plan for using the city\'s irrigation water.' },
  'Public Works Building Expansion & Improvements': {
    name: 'Public Works building expansion',
    category: 'Buildings and equipment',
    about: 'An expanded Public Works facility to meet future needs and support a growing workforce.',
  },
  'Dumpster Enclosures Fencing': { name: 'Dumpster enclosures', category: 'Buildings and equipment', about: 'Dumpster enclosures for a cleaner look and better waste containment around the city.' },
  'Large Shed – Roadway (1 shed)': { name: 'Large shed for streets equipment', category: 'Buildings and equipment' },
  'Small Shed – Roadway (1 shed)': { name: 'Small shed for streets equipment', category: 'Buildings and equipment' },
  'Concrete/Electrical for Sheds': { name: 'Concrete and electrical for the sheds', category: 'Buildings and equipment' },
  'Public Safety Master Plan and Impact Fee Study': {
    name: 'Public safety master plan and impact fee study',
    category: 'Plans and studies',
    about: 'A long-term plan for police, fire and emergency service needs, with Zions Bank calculating impact fees.',
  },
  'Economic Development Strategic Plan': { name: 'Economic development strategic plan', category: 'Plans and studies', about: 'A plan outlining the city\'s economic strategies.' },
};

const clean = (s: string) => s.replace(/\s*[–—]\s*/g, ' ').replace(/\s&\s/g, ' and ').replace(/\s+/g, ' ').trim();

export function metaFor(gisName: string): { name: string; category: Category; about?: string } {
  return META[gisName] ?? { name: clean(gisName), category: 'Buildings and equipment' };
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

export function plansFrom(fc: { features: Array<{ properties?: PlanProps | null; geometry?: object | null }> }): Plan[] {
  const list = fc.features.map((f, i): Plan => {
    const p = f.properties ?? {};
    const gis = String(p.Project_Name ?? '').trim();
    const m = metaFor(gis);
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
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
