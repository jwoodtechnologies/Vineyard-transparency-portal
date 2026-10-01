/* eslint-disable react-refresh/only-export-components -- route table, not a component module */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, createBrowserRouter, useSearchParams } from 'react-router-dom';
import ConsolePage from '@/console/ConsolePage';

const ServicesPage = lazy(() => import('@/console/ServicesPage'));
const ServiceView = lazy(() => import('@/console/ServiceView'));
const MeetingsPage = lazy(() => import('@/console/MeetingsPage'));
const MeetingPage = lazy(() => import('@/console/MeetingPage'));
const DocumentView = lazy(() => import('@/console/DocumentView'));
const MapPage = lazy(() => import('@/console/MapPage'));
const RecordsPage = lazy(() => import('@/console/RecordsPage'));
const PeoplePage = lazy(() => import('@/console/PeoplePage'));
const VotesPage = lazy(() => import('@/console/VotesPage'));
const BoardsPage = lazy(() => import('@/console/BoardsPage'));
const PlanningPage = lazy(() => import('@/console/PlanningPage'));

// Warm the other screens in the background once the first one is up, so tapping Meetings or a
// record opens instantly.
if (typeof window !== 'undefined') {
  const warm = () => {
    void import('@/console/MeetingsPage');
    void import('@/console/MeetingPage');
    void import('@/console/DocumentView');
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(warm);
  else setTimeout(warm, 1500);
}

const quiet = (node: ReactNode) => <Suspense fallback={<div className="vc" />}>{node}</Suspense>;

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
  { path: '/', element: <ConsolePage /> },
  { path: '/meetings', element: quiet(<MeetingsPage />) },
  { path: '/calendar', element: quiet(<MeetingsPage />) },
  { path: '/meetings/:meetingId', element: quiet(<MeetingPage />) },
  { path: '/documents/:documentId', element: quiet(<DocumentView />) },
  { path: '/services', element: quiet(<ServicesPage />) },
  { path: '/services/:id', element: quiet(<ServiceView />) },
  // Latest was folded into Records (newest first) and the calendar.
  { path: '/latest', element: <Navigate to="/records" replace /> },
  { path: '/news', element: <Navigate to="/records" replace /> },
  { path: '/map', element: quiet(<MapPage />) },
  { path: '/records', element: quiet(<RecordsPage />) },
  { path: '/votes', element: quiet(<VotesPage />) },
  { path: '/boards', element: quiet(<BoardsPage />) },
  { path: '/planning', element: quiet(<PlanningPage />) },
  { path: '/people', element: quiet(<PeoplePage />) },
  { path: '/people/:slug', element: quiet(<PeoplePage />) },
  { path: '/search', element: <SearchRedirect /> },
  { path: '/ask', element: <SearchRedirect /> },
  { path: '*', element: <Navigate to="/" replace /> },
  ] },
]);
