import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/router';
import PullToRefresh from '@/console/PullToRefresh';

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

const root = document.getElementById('root')!;
dropShellWhenDrawn(root);
createRoot(root).render(
  <StrictMode>
    <PullToRefresh />
    <RouterProvider router={router} />
  </StrictMode>,
);
