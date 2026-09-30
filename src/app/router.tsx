/* eslint-disable react-refresh/only-export-components -- route table, not a component module */
import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import HomePage from '@/pages/HomePage';

const AskPage = lazy(() => import('@/pages/AskPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const DocumentsPage = lazy(() => import('@/pages/DocumentsPage'));
const DocumentPage = lazy(() => import('@/pages/DocumentPage'));
const BrowsePage = lazy(() => import('@/pages/BrowsePage'));
const MeetingsPage = lazy(() => import('@/pages/MeetingsPage'));
const MeetingPage = lazy(() => import('@/pages/MeetingPage'));
const BodyPage = lazy(() => import('@/pages/BodyPage'));
const TopicPage = lazy(() => import('@/pages/TopicPage'));
const CodePage = lazy(() => import('@/pages/CodePage'));
const SourcesPage = lazy(() => import('@/pages/SourcesPage'));
const AboutPage = lazy(() => import('@/pages/AboutPage'));
const SavedPage = lazy(() => import('@/pages/SavedPage'));
const StatusPage = lazy(() => import('@/pages/StatusPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/ask', element: <AskPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/documents/:documentId', element: <DocumentPage /> },
      { path: '/browse', element: <BrowsePage /> },
      { path: '/meetings', element: <MeetingsPage /> },
      { path: '/meetings/:meetingId', element: <MeetingPage /> },
      { path: '/bodies/:bodyId', element: <BodyPage /> },
      { path: '/topics/:topicId', element: <TopicPage /> },
      { path: '/code', element: <CodePage /> },
      { path: '/sources', element: <SourcesPage /> },
      { path: '/sources/:sourceId', element: <SourcesPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/saved', element: <SavedPage /> },
      { path: '/status', element: <StatusPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
