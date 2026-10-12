/* eslint-disable react-refresh/only-export-components -- route table, not a component module */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, createBrowserRouter, useSearchParams } from 'react-router-dom';
/**
 * Every screen is its own chunk, loaded with its route. Each importer is listed once so a route's chunk can
 * also be fetched ahead of a tap (preloadRoute: link hover, touchstart or focus), and index.html preloads the
 * chunk for the address being opened (vite.config.ts writes the route table, public/theme-init.js reads it).
 */
const load = {
  console: () => import('@/console/ConsolePage'),
  services: () => import('@/console/ServicesPage'),
  service: () => import('@/console/ServiceView'),
  meetings: () => import('@/console/MeetingsPage'),
  meeting: () => import('@/console/MeetingPage'),
  document: () => import('@/console/DocumentView'),
  map: () => import('@/console/MapPage'),
  records: () => import('@/console/RecordsPage'),
  recordsIndex: () => import('@/console/RecordsIndexPage'),
  people: () => import('@/console/PeoplePage'),
  votes: () => import('@/console/VotesPage'),
  boards: () => import('@/console/BoardsPage'),
  planning: () => import('@/console/PlanningPage'),
  budget: () => import('@/console/BudgetPage'),
  add: () => import('@/console/AddPage'),
  sources: () => import('@/console/SourcesPage'),
};
type Screen = keyof typeof load;

const ConsolePage = lazy(load.console);
const ServicesPage = lazy(load.services);
const ServiceView = lazy(load.service);
const MeetingsPage = lazy(load.meetings);
const MeetingPage = lazy(load.meeting);
const DocumentView = lazy(load.document);
const MapPage = lazy(load.map);
const RecordsPage = lazy(load.records);
const RecordsIndexPage = lazy(load.recordsIndex);
const PeoplePage = lazy(load.people);
const VotesPage = lazy(load.votes);
const BoardsPage = lazy(load.boards);
const PlanningPage = lazy(load.planning);
const BudgetPage = lazy(load.budget);
const AddPage = lazy(load.add);
const SourcesPage = lazy(load.sources);

/** The screen a path opens (by its first segment), or null. */
export function screenFor(path: string): Screen | null {
  const seg = path.split(/[?#]/)[0].split('/').filter(Boolean);
  const table: Record<string, Screen> = {
    '': 'console',
    meetings: seg[1] ? 'meeting' : 'meetings',
    calendar: 'meetings',
    documents: 'document',
    services: seg[1] ? 'service' : 'services',
    budget: 'budget',
    map: 'map',
    records: seg[1] ? 'recordsIndex' : 'records',
    votes: 'votes',
    boards: 'boards',
    planning: 'planning',
    people: 'people',
    add: 'add',
    sources: 'sources',
  };
  return table[seg[0] ?? ''] ?? null;
}

const started = new Set<Screen>();
/** Starts loading a route's chunk (once). */
export function preloadRoute(path: string): void {
  const screen = screenFor(path);
  if (!screen || started.has(screen)) return;
  started.add(screen);
  void load[screen]().catch(() => started.delete(screen));
}

if (typeof window !== 'undefined') {
  // A link the reader is about to tap: its screen starts loading on hover, touch or keyboard focus.
  const ahead = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (a && a.origin === window.location.origin && !a.pathname.startsWith('/api/')) preloadRoute(a.pathname);
  };
  for (const type of ['pointerover', 'touchstart', 'focusin']) document.addEventListener(type, ahead, { passive: true, capture: true });
  // Warm the other screens in the background once the first one is up and its data is in (a few seconds
  // after load, when idle), so tapping Meetings or a record opens instantly without slowing this page.
  const warm = () => ['/meetings', '/meetings/x', '/documents/x'].forEach(preloadRoute);
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const later = () => setTimeout(() => (idle ? idle(warm, { timeout: 5000 }) : warm()), 3000);
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}

// While a screen's code loads, the page stays as it is (the app shell on first load), never an empty frame.
const quiet = (node: ReactNode) => <Suspense fallback={null}>{node}</Suspense>;

/** If a screen ever fails, offer a clean way back instead of a raw error page. */
function RouteError() {
  return (
    <div className="vc" data-state="page" style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: '2rem', textAlign: 'center' }}>
      <div>
        <p style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Something went wrong on this page.</p>
        <p style={{ margin: '0 0 1.2rem', opacity: 0.7 }}>Reloading usually fixes it.</p>
        <button type="button" className="vc-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

/** Old search links (/search?q=...) open the same question in the console. */
function SearchRedirect() {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim();
  return <Navigate to={q ? `/?q=${encodeURIComponent(q)}` : '/'} replace />;
}

// The portal is a few quiet screens: ask, records, the calendar, the map, one meeting, one record.
// Everything else from the first version (browse, topics, sources, about, status...) folds into these.
export const router = createBrowserRouter([
  { errorElement: <RouteError />, children: [
  { path: '/', element: quiet(<ConsolePage />) },
  { path: '/meetings', element: quiet(<MeetingsPage />) },
  { path: '/calendar', element: quiet(<MeetingsPage />) },
  { path: '/meetings/:meetingId', element: quiet(<MeetingPage />) },
  { path: '/documents/:documentId', element: quiet(<DocumentView />) },
  { path: '/services', element: quiet(<ServicesPage />) },
  { path: '/services/:id', element: quiet(<ServiceView />) },
  // Latest was retired: its address opens the calendar.
  { path: '/latest', element: <Navigate to="/meetings" replace /> },
  { path: '/news', element: <Navigate to="/meetings" replace /> },
  { path: '/budget', element: quiet(<BudgetPage />) },
  { path: '/map', element: quiet(<MapPage />) },
  // Construction is a map layer: with it on, the funded projects and the city's construction table are listed beside the map.
  { path: '/construction', element: <Navigate to="/map?layers=projects#projects" replace /> },
  { path: '/records', element: quiet(<RecordsPage />) },
  { path: '/records/:index', element: quiet(<RecordsIndexPage />) },
  { path: '/votes', element: quiet(<VotesPage />) },
  { path: '/boards', element: quiet(<BoardsPage />) },
  { path: '/planning', element: quiet(<PlanningPage />) },
  { path: '/people', element: quiet(<PeoplePage />) },
  { path: '/people/:slug', element: quiet(<PeoplePage />) },
  { path: '/add', element: quiet(<AddPage />) },
  { path: '/sources', element: quiet(<SourcesPage />) },
  { path: '/search', element: <SearchRedirect /> },
  { path: '/ask', element: <SearchRedirect /> },
  { path: '*', element: <Navigate to="/" replace /> },
  ] },
]);
