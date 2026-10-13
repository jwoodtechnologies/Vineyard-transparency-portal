/**
 * Which projects on the city's Capital Improvement Plan map (ArcGIS layer 650) belong to the
 * adopted fiscal 2027 budget. The city's map still carries many fiscal 2025 and 2026 items that
 * are finished, rolled over or dropped, so the portal shows only the features listed here, each
 * tied to the line(s) in the council's budget slides. Anything not listed is not shown on the map
 * or fed to the knowledge base as a current project.
 *
 * The table is part of the budget (worker/lib/budgetData.ts): each capital project line may name its map feature,
 * and staff change those links with the budget in the staff portal. ingest/gis.py carries a copy of the built-in
 * table between the FY27_PLAN markers; tests/worker-capitalplan.test.ts fails if that copy and the built-in budget
 * drift apart. A saved budget version changes the Worker's table at once; the ingest copy (which feeds the chat's
 * map knowledge) follows the built-in budget until someone updates it.
 *
 * Sources for the built-in rows:
 *   id and gis name: "feature 650/<id>" is the city's Capital Improvement Plan layer, viewable at
 *     https://services.arcgis.com/QdlehUncXjEmQYtI/arcgis/rest/services/Capital_Improvement_Plan_Public_View/FeatureServer/650/<id>
 *     (Project_Name is the `gis` value). Layer as read in October 2026; the city can renumber or drop features.
 *   budget line and amount: FY 27 Final Budget Slides, the page given (doc_4d69a97b95e87bea), through the
 *     matching row in budgetData PROJECTS. Which map feature goes with which slide line is the portal's own
 *     matching (added October 2, 2026), not something either source prints.
 */
import { onBudgetBookApplied, PROJECTS, PROJECT_FUNDS } from './budgetData';

/** [fund key, exact project name in budgetData PROJECTS] */
type Ref = [string, string];

export interface PlanMatch {
  /** OBJECTID in the city's Capital Improvement Plan layer. */
  id: number;
  /** The city's name for the project, for reference. */
  gis: string;
  budget: Ref[];
}

/**
 * The map features that belong to the adopted budget, built from the budget's project lines: every line that
 * names a map feature (`feature`, `featureName`) joins its feature, and a feature with several lines (the Public
 * Works building is paid from four funds) lists them all. Lowest feature number first.
 */
export function planFrom(projects: ReadonlyArray<{ fund: string; name: string; feature?: number; featureName?: string }>): PlanMatch[] {
  const byId = new Map<number, PlanMatch>();
  for (const p of projects) {
    if (!p.feature) continue;
    const m = byId.get(p.feature) ?? { id: p.feature, gis: '', budget: [] };
    m.gis ||= p.featureName ?? '';
    m.budget.push([p.fund, p.name]);
    byId.set(p.feature, m);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export let FY27_PLAN: PlanMatch[] = planFrom(PROJECTS);
export let FY27_PROJECT_IDS: number[] = FY27_PLAN.map((p) => p.id);

/** ArcGIS where clause that keeps only the projects in the adopted budget (an impossible match when none is on the map). */
export let FY27_PROJECTS_WHERE = whereFor(FY27_PROJECT_IDS);

function whereFor(ids: number[]): string {
  return ids.length ? `OBJECTID IN (${ids.join(',')})` : 'OBJECTID < 0';
}

// A saved budget version changes the project lines, so the map links follow it.
onBudgetBookApplied(() => {
  FY27_PLAN = planFrom(PROJECTS);
  FY27_PROJECT_IDS = FY27_PLAN.map((p) => p.id);
  FY27_PROJECTS_WHERE = whereFor(FY27_PROJECT_IDS);
});

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
