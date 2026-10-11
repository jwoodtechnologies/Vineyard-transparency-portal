/**
 * Which projects on the city's Capital Improvement Plan map (ArcGIS layer 650) belong to the
 * adopted fiscal 2027 budget. The city's map still carries many fiscal 2025 and 2026 items that
 * are finished, rolled over or dropped, so the portal shows only the features listed here, each
 * tied to the line(s) in the council's budget slides. Anything not listed is not shown on the map
 * or fed to the knowledge base as a current project.
 *
 * ingest/gis.py carries the same table between the FY27_PLAN markers; tests/worker-capitalplan.test.ts
 * fails if the two drift apart. Update both when the city amends the budget.
 *
 * Sources for each row (the trailing `// Source:` comment):
 *   id and gis name: "feature 650/<id>" is the city's Capital Improvement Plan layer, viewable at
 *     https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/Capital_Improvement_Plan_Public_View/FeatureServer/650/<id>
 *     (Project_Name is the `gis` value). Layer as read in October 2026; the city can renumber or drop features.
 *   budget line and amount: FY 27 Final Budget Slides, the page given (doc_4d69a97b95e87bea), through the
 *     matching row in budgetData PROJECTS. Which map feature goes with which slide line is the portal's own
 *     matching (added October 2, 2026), not something either source prints.
 */
import { PROJECTS, PROJECT_FUNDS } from './budgetData';

/** [fund key, exact project name in budgetData PROJECTS] */
type Ref = [string, string];

export interface PlanMatch {
  /** OBJECTID in the city's Capital Improvement Plan layer. */
  id: number;
  /** The city's name for the project, for reference. */
  gis: string;
  budget: Ref[];
}

const PWB = 'Public Works building improvements';

export const FY27_PLAN: PlanMatch[] = [
  { id: 1, gis: '1200 North Bridge', budget: [['general', 'Design of the 1200 North overpass bridge']] }, // Source: feature 650/1; slides page 4
  { id: 2, gis: '1600 N Geneva Road Intersection Widening', budget: [['impact', '1600 North Geneva Road intersection widening']] }, // Source: feature 650/2; slides page 4
  { id: 3, gis: '300 West Striping & Design (Parking Implementation)', budget: [['transport', 'Parking implementation on 300 West: restriping and design']] }, // Source: feature 650/3; slides page 5
  { id: 4, gis: '400 North & Mill Road Traffic Signal', budget: [['rda', '400 North traffic signal: design and construction']] }, // Source: feature 650/4; slides page 6
  { id: 11, gis: 'Holdaway Fields 400 S Extension', budget: [['impact', 'Holdaway Fields 400 South betterment']] }, // Source: feature 650/11; slides page 4
  { id: 12, gis: 'Install Street Lights – 170 South', budget: [['impact', 'Install street lights along 170 South']] }, // Source: feature 650/12; slides page 4
  { id: 14, gis: 'Traffic Signal – 600 N & Main', budget: [['impact', 'Traffic signal at 600 North and Main Street']] }, // Source: feature 650/14; slides page 4
  { id: 16, gis: 'Vineyard Connector Overpass Bridge', budget: [['rda', 'Vineyard Connector promenade overpass (UDOT)']] }, // Source: feature 650/16; slides page 6
  { id: 18, gis: 'Holdaway Road Complete Street Design & Survey', budget: [['general', 'Holdaway Road bike boulevard study']] }, // Source: feature 650/18; slides page 4
  { id: 21, gis: 'Rail Consolidation', budget: [['rda', 'Rail spur realignment: design and construction']] }, // Source: feature 650/21; slides page 6
  {
    id: 25, // Source: feature 650/25; slides pages 4 (impact), 5 (water, wastewater), 6 (rda)
    gis: 'Public Works Building Expansion & Improvements',
    budget: [
      ['impact', `${PWB} (25%)`],
      ['water', PWB],
      ['wastewater', PWB],
      ['rda', PWB],
    ],
  },
  { id: 28, gis: 'Slide Hill at Grove Park', budget: [['general', 'Finish construction of Slide Hill at Grove Park']] }, // Source: feature 650/28; slides page 4
  { id: 29, gis: "Engineering for Field (Gammon Park / Robin's Property)", budget: [['general', 'Master plan design of the Robin’s property']] }, // Source: feature 650/29; slides page 4
  { id: 31, gis: 'Skate Park & Pump Track', budget: [['rap', 'Skate park near Vineyard City Hall (RAP tax and UORG grant)']] }, // Source: feature 650/31; slides page 4
  { id: 38, gis: 'Lift Station 2 Upgrade', budget: [['wastewater', 'Lift Station 2 upgrade (carried over from FY25)']] }, // Source: feature 650/38; slides page 5
  { id: 39, gis: 'Storage Building - Lift Station 2', budget: [['wastewater', 'Storage building at Lift Station 2']] }, // Source: feature 650/39; slides page 5
  { id: 42, gis: 'Vineyard Beach Park', budget: [['rda', 'Vineyard Beach improvements: design (TRCC grant and Flagship rebate)']] }, // Source: feature 650/42; slides page 6
  { id: 53, gis: 'Dumpster Enclosures Fencing', budget: [['general', 'Dumpster enclosures']] }, // Source: feature 650/53; slides page 4
  { id: 75, gis: 'Large Shed – Roadway (1 shed)', budget: [['impact', 'One large shed']] }, // Source: feature 650/75; slides page 4
  { id: 76, gis: 'Small Shed – Roadway (1 shed)', budget: [['impact', 'One small shed']] }, // Source: feature 650/76; slides page 4
  { id: 77, gis: 'Concrete/Electrical for Sheds', budget: [['impact', 'Concrete and electrical for two sheds']] }, // Source: feature 650/77; slides page 4
  { id: 84, gis: 'Utah Lake Shoreline Trail Amenities', budget: [['general', 'Design and construct Utah Lake shoreline trail and bike station improvements']] }, // Source: feature 650/84; slides page 4
  { id: 86, gis: 'Water Shares Purchase', budget: [['water', 'Water shares']] }, // Source: feature 650/86; slides page 5
  { id: 92, gis: 'Sewer System Improvements (Pipelining)', budget: [['wastewater', 'Sewer system improvements']] }, // Source: feature 650/92; slides page 5
  { id: 93, gis: 'Secondary Water Master Plan', budget: [['water', 'Secondary water master plan']] }, // Source: feature 650/93; slides page 5
  { id: 94, gis: 'Public Safety Master Plan and Impact Fee Study', budget: [['general', 'Public safety master plan and impact fee study']] }, // Source: feature 650/94; slides page 4
  { id: 96, gis: 'Economic Development Strategic Plan', budget: [['rda', 'City-wide economic development strategic plan']] }, // Source: feature 650/96; slides page 6
];

export const FY27_PROJECT_IDS: number[] = FY27_PLAN.map((p) => p.id);

/** ArcGIS where clause that keeps only the projects in the adopted budget. */
export const FY27_PROJECTS_WHERE = `OBJECTID IN (${FY27_PROJECT_IDS.join(',')})`;

export interface BudgetMatch {
  amount: number;
  /** "Redevelopment Agency" or "Impact fees and Water" */
  source: string;
  items: Array<{ fund: string; name: string; amount: number }>;
}

const fundName = (key: string) => PROJECT_FUNDS.find((f) => f.key === key)?.name ?? key;

/** The fiscal 2027 budget lines behind one map feature, or null when the feature is not in the budget. */
export function budgetForFeature(objectId: number): BudgetMatch | null {
  const m = FY27_PLAN.find((p) => p.id === objectId);
  if (!m) return null;
  const items = m.budget.map(([fund, name]) => {
    const p = PROJECTS.find((x) => x.fund === fund && x.name === name);
    return { fund, name, amount: p?.amount ?? 0 };
  });
  const funds = [...new Set(items.map((i) => fundName(i.fund)))];
  const source = funds.length > 1 ? `${funds.slice(0, -1).join(', ')} and ${funds[funds.length - 1]}` : (funds[0] ?? '');
  return { amount: items.reduce((s, i) => s + i.amount, 0), source, items };
}
