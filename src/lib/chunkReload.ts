/**
 * When a page's code cannot be loaded (a deploy replaced the chunk a page asked for, or a browser kept a bad
 * copy of one), the page reloads once with a fresh query, which brings the current index.html and its chunk
 * names. A note in sessionStorage keeps it to one try a minute, so a real outage shows the error page instead
 * of reloading forever.
 */
import { isChunkError, shouldReload } from './chunkErrors';

export { isChunkError };

const KEY = 'vtp:chunk-reload';
const PARAM = '__r';

/** Reloads once with a cache-busting query; false when it already tried within the last minute. */
export function reloadOnce(): boolean {
  let last: number | null = null;
  try {
    const v = sessionStorage.getItem(KEY);
    last = v ? Number(v) : null;
  } catch {
    // Storage blocked: one try per page load is still kept by the flag below.
  }
  if ((window as Window & { __vtpReloading?: boolean }).__vtpReloading || !shouldReload(Date.now(), last)) return false;
  (window as Window & { __vtpReloading?: boolean }).__vtpReloading = true;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // As above.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
  return true;
}

/** Listens for failed code loads, and takes the cache-busting query back off the address after a reload. */
export function watchChunkLoads(): void {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadOnce()) e.preventDefault();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isChunkError(e.reason)) reloadOnce();
  });
  const url = new URL(window.location.href);
  if (url.searchParams.has(PARAM)) {
    url.searchParams.delete(PARAM);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
}
