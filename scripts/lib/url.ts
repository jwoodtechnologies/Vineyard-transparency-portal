/**
 * URL utilities: resolution, normalization, and host-pattern matching.
 *
 * Normalization is used as an identity key (dedupe, visited sets), never to rewrite the URL we
 * actually request — some servers are sensitive to parameter order, so requests use the resolved
 * URL and only comparisons use the normalized form.
 */
import type { HostPattern } from './types';

export const DEFAULT_STRIP_PARAMS = ['utm_*', 'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga', '_gl', 'igshid', 'yclid'];

export interface NormalizeOptions {
  /** Query parameter names to drop. A trailing "*" matches a prefix (e.g. "utm_*"). */
  stripParams?: string[];
  /** Sort remaining query parameters by name (stable for equal names). Default true. */
  sortParams?: boolean;
}

/** Resolve an href against a base URL. Returns null for unparseable or non-http(s) results. */
export function resolveUrl(href: string, base: string): string | null {
  const trimmed = href.trim().replace(/[\t\n\r]/g, '');
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.toString();
}

/** Scheme of an href if it has one (mailto:, tel:, javascript:, data:, ...), lower-cased. */
export function hrefScheme(href: string): string | null {
  const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(href);
  return m ? m[1].toLowerCase() : null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function paramMatches(name: string, patterns: string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => {
    const pl = p.toLowerCase();
    return pl.endsWith('*') ? lower.startsWith(pl.slice(0, -1)) : lower === pl;
  });
}

/**
 * Normalize a URL for identity comparison:
 *  - lower-case scheme and host, drop trailing dot on host
 *  - remove default ports (:80 for http, :443 for https)
 *  - strip the fragment
 *  - strip tracking parameters (utm_*, fbclid, gclid, ...)
 *  - sort remaining query parameters
 *  - collapse duplicate slashes in the path, resolve dot segments (done by URL parser)
 *  - trailing slash: removed from non-root paths, EXCEPT it is kept for the root "/".
 *    ("/a/" and "/a" are treated as the same resource; this is true for virtually every CMS we
 *    target and is the conservative choice for dedupe of listing pages.)
 *  - percent-encoding normalized by the WHATWG URL parser; unreserved escapes (e.g. %7E) decoded.
 * Returns null if the input is not an http(s) URL.
 */
export function normalizeUrl(input: string, options: NormalizeOptions = {}): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  url.username = '';
  url.password = '';

  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  pathname = pathname.replace(/%7E/gi, '~').replace(/%2D/gi, '-').replace(/%5F/gi, '_');
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '') || '/';
  url.pathname = pathname;

  const strip = options.stripParams ?? DEFAULT_STRIP_PARAMS;
  const entries = [...url.searchParams.entries()].filter(([name]) => !paramMatches(name, strip));
  if (options.sortParams !== false) {
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  const search = new URLSearchParams(entries).toString();
  url.search = search ? `?${search}` : '';

  return url.toString();
}

/** Lower-cased host without trailing dot, or null. */
export function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** See HostPattern: "example.org" = host + subdomains, "=www.example.org" = exact host. */
export function hostMatches(host: string, pattern: HostPattern): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (pattern.startsWith('=')) return h === pattern.slice(1).toLowerCase();
  const p = pattern.toLowerCase().replace(/^\*\./, '');
  return h === p || h.endsWith(`.${p}`);
}

export function hostMatchesAny(host: string, patterns: readonly HostPattern[] | undefined): boolean {
  return !!patterns && patterns.some((p) => hostMatches(host, p));
}

/** Lower-cased file extension of the URL path (without dot), or null. */
export function extensionOf(value: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  const last = decodeURIComponentSafe(pathname.split('/').pop() ?? '');
  const m = /\.([a-z0-9]{1,5})$/i.exec(last);
  return m ? m[1].toLowerCase() : null;
}

export function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Path + query used for pattern matching (lower-cased). */
export function pathAndQuery(value: string): string {
  try {
    const u = new URL(value);
    return (u.pathname + u.search).toLowerCase();
  } catch {
    return '';
  }
}

/** Filename suggested by the URL path (decoded), or null. */
export function fileNameFromUrl(value: string): string | null {
  try {
    const last = new URL(value).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponentSafe(last) : null;
  } catch {
    return null;
  }
}
