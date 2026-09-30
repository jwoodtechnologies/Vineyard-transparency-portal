/* eslint-disable react-refresh/only-export-components -- route table, not a component module */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, createBrowserRouter, useSearchParams } from 'react-router-dom';
import ConsolePage from '@/console/ConsolePage';

const MeetingsPage = lazy(() => import('@/console/MeetingsPage'));
const MeetingPage = lazy(() => import('@/console/MeetingPage'));
const DocumentView = lazy(() => import('@/console/DocumentView'));
const LatestPage = lazy(() => import('@/console/LatestPage'));
const MapPage = lazy(() => import('@/console/MapPage'));

// Warm the other screens in the background once the first one is up, so tapping Meetings or a
// record opens instantly.
if (typeof window !== 'undefined') {
  const warm = () => {
    void import('@/console/MeetingsPage');
    void import('@/console/MeetingPage');
    void import('@/console/DocumentView');
    void import('@/console/LatestPage');
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

// The portal is a few quiet screens: ask, latest, the calendar, the map, one meeting, one record.
// Everything else from the first version (browse, topics, sources, about, status...) folds into these.
export const router = createBrowserRouter([
  { errorElement: <RouteError />, children: [
  { path: '/', element: <ConsolePage /> },
  { path: '/meetings', element: quiet(<MeetingsPage />) },
  { path: '/calendar', element: quiet(<MeetingsPage />) },
  { path: '/meetings/:meetingId', element: quiet(<MeetingPage />) },
  { path: '/documents/:documentId', element: quiet(<DocumentView />) },
  { path: '/latest', element: quiet(<LatestPage />) },
  { path: '/news', element: <Navigate to="/latest" replace /> },
  { path: '/map', element: quiet(<MapPage />) },
  { path: '/search', element: <SearchRedirect /> },
  { path: '/ask', element: <SearchRedirect /> },
  { path: '*', element: <Navigate to="/" replace /> },
  ] },
]);
