/**
 * Page title and meta description, updated on each navigation (src/main.tsx). A screen that knows more
 * (a record, a meeting, a person) calls setHead again once its data is in.
 */
import { SITE, headFor } from './routeHead';

function meta(selector: string, attr: 'name' | 'property', key: string): HTMLMetaElement {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

/** Sets the tab title ("Page | Vineyard Transparency Portal"), description and the matching share tags. */
export function setHead(title: string | null, description?: string | null): void {
  if (typeof document === 'undefined') return;
  const full = title ? `${title} | ${SITE}` : SITE;
  document.title = full;
  meta('meta[property="og:title"]', 'property', 'og:title').content = title ?? SITE;
  meta('meta[name="twitter:title"]', 'name', 'twitter:title').content = title ?? SITE;
  if (description) {
    const d = description.length > 200 ? `${description.slice(0, 197).replace(/\s+\S*$/, '')}...` : description;
    meta('meta[name="description"]', 'name', 'description').content = d;
    meta('meta[property="og:description"]', 'property', 'og:description').content = d;
    meta('meta[name="twitter:description"]', 'name', 'twitter:description').content = d;
  }
  meta('meta[property="og:url"]', 'property', 'og:url').content = `${window.location.origin}${window.location.pathname}`;
}

/** Applies the defaults for a path. */
export function applyRouteHead(path: string): void {
  const h = headFor(path);
  setHead(h.title, h.description);
}
