import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/router';
import PullToRefresh from '@/console/PullToRefresh';
import { applyRouteHead } from '@/lib/head';

/** The shell leaves in the same frame the first screen arrives (a .vc frame in the root), so nothing flashes in between. */
function dropShellWhenDrawn(root: HTMLElement): void {
  const shell = document.getElementById('vtp-shell');
  if (!shell) return;
  const done = () => {
    if (!root.querySelector('.vc')) return false;
    shell.remove();
    return true;
  };
  const watch = new MutationObserver(() => {
    if (done()) watch.disconnect();
  });
  watch.observe(root, { childList: true, subtree: true });
}

// The first in-app navigation turns the page entrance animations back on.
const stop = router.subscribe(() => {
  document.documentElement.classList.remove('vtp-boot');
  stop();
});

// Title and description per route, on first load and on every change of page (a screen with more to say,
// such as a record, sets its own once its data is in).
let headPath = window.location.pathname;
applyRouteHead(headPath);
router.subscribe((state) => {
  if (state.location.pathname === headPath) return;
  headPath = state.location.pathname;
  applyRouteHead(headPath);
});

const root = document.getElementById('root')!;
dropShellWhenDrawn(root);
createRoot(root).render(
  <StrictMode>
    <PullToRefresh />
    <RouterProvider router={router} />
  </StrictMode>,
);

// The map's tile cache (public/sw.js): elevation, vector and aerial tiles kept after the first view.
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
