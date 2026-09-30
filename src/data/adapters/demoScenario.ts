/** Demo-mode failure simulations (mock adapter only). Kept separate so it never pulls demo data into other bundles. */
export type DemoScenario = 'normal' | 'backend_offline' | 'ai_unavailable' | 'search_unavailable' | 'slow';

export const DEMO_SCENARIO_KEY = 'vtp:demo-scenario';

export function readDemoScenario(): DemoScenario {
  try {
    const v = localStorage.getItem(DEMO_SCENARIO_KEY) as DemoScenario | null;
    return v && ['normal', 'backend_offline', 'ai_unavailable', 'search_unavailable', 'slow'].includes(v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function writeDemoScenario(s: DemoScenario): void {
  try {
    if (s === 'normal') localStorage.removeItem(DEMO_SCENARIO_KEY);
    else localStorage.setItem(DEMO_SCENARIO_KEY, s);
  } catch {
    /* ignore */
  }
}
