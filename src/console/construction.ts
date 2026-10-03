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

export const ACTIVE: ActiveProject[] = [
  {
    id: 'trail',
    n: 1,
    title: 'Vineyard Regional Trail Enhancements',
    where: 'Lakeside Park and 400 South, and Center Street at Holdaway Road',
    summary:
      'Vineyard, with Orem and the Mountainland Association of Governments, is making two intersections safer for people on foot, on bikes and in cars: a realigned 620 East and 400 South entrance to Lakeside Park with a new traffic signal and crosswalks, and a lighted Pedestrian Hybrid Beacon crosswalk on Center Street near Franklin Discovery Academy.',
    facts: [
      ['Goal', 'Finished before the 2026-2027 school year'],
      ['Work hours', 'Monday to Friday, 7 a.m. to 7 p.m., Saturday as needed'],
      ['Managed by', 'Consor, for Vineyard City'],
    ],
    expect: [
      'Intermittent lane closures on Center Street, with flaggers guiding one-way traffic.',
      'Construction areas are closed to people on foot and on bikes. Children going to school use their regular routes, with crossing guards at 400 South.',
      'The east entrance to Lakeside Park is closed from time to time.',
      'Schedules change with the weather.',
    ],
    updates: [
      {
        date: '2026-08-21',
        title: 'Update 4',
        text: 'Striping at Lakeside Park and 400 South is complete, and crews are installing traffic poles, lights and landscaping through August. At Center Street and Holdaway Road the south sidewalk is poured, with ADA ramps and signal poles going in through August. 620 East and 400 South has been realigned, with a new signal and crosswalks.',
      },
      {
        date: '2026-08-07',
        title: 'Update 3',
        text: '400 South striping is finished and traffic poles and lights go in through August. At Center Street and Holdaway Road, crews are removing the brick wall, curb and gutter, and the south sidewalk is closed.',
      },
      {
        date: '2026-08-04',
        title: 'Gas line notice',
        text: 'Enbridge Gas began lowering an 8-inch gas main at Center Street and Holdaway Road. The eastbound lane on Center Street and the south sidewalk at the intersection were closed, with work expected through the end of that week.',
      },
      {
        date: '2026-07-24',
        title: 'Update 2',
        text: 'Crews started paving the Lakeside Park parking lot and demolishing the south side of the Center Street and Holdaway Road intersection. Next come sod and microsurfacing near the intersection. Starting Monday, July 27, about a week of excavation for right turn lanes at 620 East, with at least one lane each way kept open on 400 South. Alternate route: 575 South to Lakeview Drive.',
      },
      {
        date: '2026-07-10',
        title: 'Update 1',
        text: 'Paving of the Lakeside Park parking lot was expected the week of July 14. Demolition began on the south side of Center Street and Holdaway Road (brick wall and curb), along with work on the Pedestrian Hybrid Beacon at the Center Street crosswalk and the realignment of 620 East and 400 South.',
      },
      {
        date: '2026-06-15',
        title: 'Construction notice',
        text: 'The city announced the project, with work starting as early as June 15, 2026.',
      },
    ],
    sites: [
      { id: 'trail-center', label: 'Center Street and Holdaway Road', lat: 40.29713, lon: -111.74675 },
      { id: 'trail-lakeside', label: '620 East and 400 South, Lakeside Park', lat: 40.28979, lon: -111.73848 },
    ],
    contact: { label: 'Project hotline', phone: '385-557-2586', email: 'claire.langford@consoreng.com' },
    docs: [
      { label: 'Update 4, August 21, 2026', id: 'doc_713c63e87f03fa94' },
      { label: 'Update 3, August 7, 2026', id: 'doc_1fdbb89ff4cde564' },
      { label: 'Gas line notice, August 4, 2026', href: `${CITY}Center%20Street%20and%20Holdaway%20Road%208.4%202026.pdf` },
      { label: 'Update 2, July 24, 2026', id: 'doc_2036559732d13068' },
      { label: 'Update 1, July 10, 2026', id: 'doc_154aac8bd0cd7d4f' },
      { label: 'Construction notice with maps', id: 'doc_39d6dd26ff032126' },
    ],
    asOf: '2026-08-21',
  },
  {
    id: 'pavement',
    n: 2,
    title: 'Pavement Preservation 2026',
    where: 'Streets across Vineyard',
    summary:
      'Chip seal on city streets, a routine treatment that protects pavement and makes it last. Vineyard keeps about 46 miles of street, spends about $380,000 a year on preservation, and counts every $1 spent on timely treatment as $6 saved later.',
    facts: [
      ['Treatments', 'Crack sealing, rejuvenation, chip seal, micro-surfacing, patches and short overlays'],
      ['Condition goal', 'Keep the average street above 70 on the 100-point pavement scale'],
      ['Contractor office', 'Holbrook, (435) 236-2281'],
    ],
    expect: [
      'No parking on the street from 7 a.m. to 7 p.m. on scheduled workdays. Cars left on the street are towed at the owner\'s expense.',
      'Turn sprinklers off on workdays.',
      'Drive under 20 mph. Faster tires throw loose chips.',
      'One lane of traffic at times, with delays up to 10 minutes.',
      'In bad weather the work moves to another day, and a new notice goes out first.',
    ],
    updates: [
      {
        date: '2026-08-11',
        when: 'Aug 11 to 15',
        title: 'Phase 2',
        text: 'The second phase. The city\'s overall map shows which streets are scheduled each day.',
      },
      {
        date: '2026-07-30',
        title: 'Phase 1, day 2',
        text: 'Chip seal on 400 North and North Vineyard Road.',
      },
      {
        date: '2026-07-29',
        title: 'Phase 1, day 1',
        text: 'Chip seal at 300 North and Vineyard Road.',
      },
      {
        date: '2026-05-19',
        title: 'City Council work meeting',
        text: 'Public Works presented the 15-year strategy and 5-year plan: most Vineyard streets are in good shape for preservation, and the goal is to treat them before they fail.',
      },
    ],
    sites: [
      { id: 'pave-300n', label: '300 North and Vineyard Road', lat: 40.30226, lon: -111.7441 },
      { id: 'pave-400n', label: '400 North near North Vineyard Road', lat: 40.3042, lon: -111.745 },
    ],
    contact: { label: 'Contractor office (Holbrook)', phone: '435-236-2281' },
    docs: [
      { label: 'Phase 2 overall map, August 11 to 15', href: `${CITY}OVERALL%20VINEYARD%20DATE%20MAP.pdf` },
      { label: 'Phase 1, day 2 notice', id: 'doc_4270ff48eee44e9b' },
      { label: 'Phase 1, day 1 notice', id: 'doc_538d77c1174350af' },
      { label: 'Pavement preservation information', id: 'doc_50cdcd77518b0bed' },
      { label: 'May 19, 2026 council presentation', id: 'doc_ba7fe47dc67bada5' },
    ],
  },
];

/** Stage colors: one hue, light to dark. */
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
