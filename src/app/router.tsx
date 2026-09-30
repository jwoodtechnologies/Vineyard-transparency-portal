/* eslint-disable react-refresh/only-export-components -- route table, not a component module */
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, createBrowserRouter, useSearchParams } from 'react-router-dom';
import ConsolePage from '@/console/ConsolePage';

const MeetingsPage = lazy(() => import('@/console/MeetingsPage'));
const MeetingPage = lazy(() => import('@/console/MeetingPage'));
const DocumentView = lazy(() => import('@/console/DocumentView'));

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

/** Old search links (/search?q=...) open the same question in the console. */
function SearchRedirect() {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim();
  return <Navigate to={q ? `/?q=${encodeURIComponent(q)}` : '/'} replace />;
}

// The whole portal is four quiet screens: ask, the meeting schedule, one meeting, one record.
// Everything else from the first version (browse, topics, sources, about, status...) folds into these.
export const router = createBrowserRouter([
  { path: '/', element: <ConsolePage /> },
  { path: '/meetings', element: quiet(<MeetingsPage />) },
  { path: '/meetings/:meetingId', element: quiet(<MeetingPage />) },
  { path: '/documents/:documentId', element: quiet(<DocumentView />) },
  { path: '/search', element: <SearchRedirect /> },
  { path: '/ask', element: <SearchRedirect /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
