import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/router';
import './index.css';

// Page-view beacon for the owner's activity log (path only, never the question text; questions are
// logged by the answer endpoint). The site footer says visits are logged.
if (import.meta.env.VITE_DATA_MODE === 'api') {
  let last = '';
  let first = true;
  const track = (path: string) => {
    if (path === last) return;
    last = path;
    const body = JSON.stringify({ path, referrer: first ? document.referrer || null : null });
    first = false;
    try {
      if (!navigator.sendBeacon?.('/api/visit', new Blob([body], { type: 'text/plain' }))) void fetch('/api/visit', { method: 'POST', body, keepalive: true }).catch(() => undefined);
    } catch {
      /* never let logging affect the page */
    }
  };
  track(window.location.pathname);
  router.subscribe((state) => track(state.location.pathname));
}

// The portal is a few quiet screens that need no app-wide providers, so nothing extra loads or
// runs before the first screen paints.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
