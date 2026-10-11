import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * One id per build: the commit (when CI provides it) and the build time. Short, URL safe. The client compares it
 * with the id its kept API copies were stored under, and the early request in public/theme-init.js carries it.
 */
const BUILD_ID = `${(process.env.GITHUB_SHA ?? process.env.CF_PAGES_COMMIT_SHA ?? '').slice(0, 8) || 'local'}-${Date.now().toString(36)}`;

/** Each route's screen module (the same table as src/app/router.tsx and public/theme-init.js). */
const SCREENS: Record<string, string> = {
  console: 'ConsolePage',
  services: 'ServicesPage',
  service: 'ServiceView',
  meetings: 'MeetingsPage',
  meeting: 'MeetingPage',
  document: 'DocumentView',
  map: 'MapPage',
  records: 'RecordsPage',
  recordsIndex: 'RecordsIndexPage',
  people: 'PeoplePage',
  votes: 'VotesPage',
  boards: 'BoardsPage',
  planning: 'PlanningPage',
  latest: 'LatestPage',
  budget: 'BudgetPage',
  construction: 'ConstructionPage',
  add: 'AddPage',
};

/**
 * Fast first paint (build only):
 * - the entry carries no stylesheet (each screen brings its own), so the static app shell in index.html
 *   paints from its inline styles at once;
 * - fonts are not preloaded: they swap in (font-display: swap) and a preload measured slower on a phone;
 * - a route table (screen to its chunk, the chunks it imports and their stylesheets) is written into the page as JSON data,
 *   which public/theme-init.js reads to preload the code and styles of the address being opened.
 */
function fastStart(): Plugin {
  return {
    name: 'vtp-fast-start',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle ?? {};
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
        const entry = chunks.find((c) => c.type === 'chunk' && c.isEntry);
        const inEntry = new Set<string>();
        const walk = (name: string, into: Set<string>) => {
          if (into.has(name)) return;
          into.add(name);
          const c = bundle[name];
          if (c?.type === 'chunk') for (const i of c.imports) walk(i, into);
        };
        if (entry) walk(entry.fileName, inEntry);
        const routes: Record<string, string[]> = {};
        for (const [screen, mod] of Object.entries(SCREENS)) {
          const c = chunks.find((x) => x.type === 'chunk' && (x.facadeModuleId ?? '').endsWith(`/src/console/${mod}.tsx`));
          if (!c) continue;
          const files = new Set<string>();
          walk(c.fileName, files);
          const own = [...files].filter((f) => !inEntry.has(f));
          const css = new Set<string>();
          for (const f of own) {
            const c2 = bundle[f];
            if (c2?.type === 'chunk') for (const x of c2.viteMetadata?.importedCss ?? []) css.add(x);
          }
          routes[screen] = [...own, ...css].map((f) => `/${f}`);
        }
        // The build id, for public/theme-init.js (its early data request carries it, like src/console/api.ts).
        const head = `<meta name="vtp-build" content="${BUILD_ID}" />\n    <script type="application/json" id="vtp-routes">${JSON.stringify(routes)}</script>`;
        return html.replace('<script src="/theme-init.js"></script>', `${head}\n    <script src="/theme-init.js"></script>`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), fastStart()],
  // The client's own build id (src/console/api.ts): a new build discards the API copies kept on the device.
  define: { __VTP_BUILD__: JSON.stringify(BUILD_ID) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173 },
});
