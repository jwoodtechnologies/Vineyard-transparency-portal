/**
 * Which projects on the city's Capital Improvement Plan map (ArcGIS layer 650) belong to the
 * adopted fiscal 2027 budget. The city's map still carries many fiscal 2025 and 2026 items that
 * are finished, rolled over or dropped, so the portal shows only the features listed here, each
 * tied to the line(s) in the council's budget slides. Anything not listed is not shown on the map
 * or fed to the knowledge base as a current project.
 *
 * ingest/gis.py carries the same table between the FY27_PLAN markers; tests/worker-capitalplan.test.ts
 * fails if the two drift apart. Update both when the city amends the budget.
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
  { id: 1, gis: '1200 North Bridge', budget: [['general', 'Design of the 1200 North overpass bridge']] },
  { id: 2, gis: '1600 N Geneva Road Intersection Widening', budget: [['impact', '1600 North Geneva Road intersection widening']] },
  { id: 3, gis: '300 West Striping & Design (Parking Implementation)', budget: [['transport', 'Parking implementation on 300 West: restriping and design']] },
  { id: 4, gis: '400 North & Mill Road Traffic Signal', budget: [['rda', '400 North traffic signal: design and construction']] },
  { id: 11, gis: 'Holdaway Fields 400 S Extension', budget: [['impact', 'Holdaway Fields 400 South betterment']] },
  { id: 12, gis: 'Install Street Lights – 170 South', budget: [['impact', 'Install street lights along 170 South']] },
  { id: 14, gis: 'Traffic Signal – 600 N & Main', budget: [['impact', 'Traffic signal at 600 North and Main Street']] },
  { id: 16, gis: 'Vineyard Connector Overpass Bridge', budget: [['rda', 'Vineyard Connector promenade overpass (UDOT)']] },
  { id: 18, gis: 'Holdaway Road Complete Street Design & Survey', budget: [['general', 'Holdaway Road bike boulevard study']] },
  { id: 21, gis: 'Rail Consolidation', budget: [['rda', 'Rail spur realignment: design and construction']] },
  {
    id: 25,
    gis: 'Public Works Building Expansion & Improvements',
    budget: [
      ['impact', `${PWB} (25%)`],
      ['water', PWB],
      ['wastewater', PWB],
      ['rda', PWB],
    ],
  },
  { id: 28, gis: 'Slide Hill at Grove Park', budget: [['general', 'Finish construction of Slide Hill at Grove Park']] },
  { id: 29, gis: "Engineering for Field (Gammon Park / Robin's Property)", budget: [['general', 'Master plan design of the Robin’s property']] },
  { id: 31, gis: 'Skate Park & Pump Track', budget: [['rap', 'Skate park near Vineyard City Hall (RAP tax and UORG grant)']] },
  { id: 38, gis: 'Lift Station 2 Upgrade', budget: [['wastewater', 'Lift Station 2 upgrade (carried over from FY25)']] },
  { id: 39, gis: 'Storage Building - Lift Station 2', budget: [['wastewater', 'Storage building at Lift Station 2']] },
  { id: 42, gis: 'Vineyard Beach Park', budget: [['rda', 'Vineyard Beach improvements: design (TRCC grant and Flagship rebate)']] },
  { id: 53, gis: 'Dumpster Enclosures Fencing', budget: [['general', 'Dumpster enclosures']] },
  { id: 75, gis: 'Large Shed – Roadway (1 shed)', budget: [['impact', 'One large shed']] },
  { id: 76, gis: 'Small Shed – Roadway (1 shed)', budget: [['impact', 'One small shed']] },
  { id: 77, gis: 'Concrete/Electrical for Sheds', budget: [['impact', 'Concrete and electrical for two sheds']] },
  { id: 84, gis: 'Utah Lake Shoreline Trail Amenities', budget: [['general', 'Design and construct Utah Lake shoreline trail and bike station improvements']] },
  { id: 86, gis: 'Water Shares Purchase', budget: [['water', 'Water shares']] },
  { id: 92, gis: 'Sewer System Improvements (Pipelining)', budget: [['wastewater', 'Sewer system improvements']] },
  { id: 93, gis: 'Secondary Water Master Plan', budget: [['water', 'Secondary water master plan']] },
  { id: 94, gis: 'Public Safety Master Plan and Impact Fee Study', budget: [['general', 'Public safety master plan and impact fee study']] },
  { id: 96, gis: 'Economic Development Strategic Plan', budget: [['rda', 'City-wide economic development strategic plan']] },
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
