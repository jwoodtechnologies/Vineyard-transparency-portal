/** URL helpers matching ingest/urls.py and ingest/sources.py, so queue keys agree across pipelines. */

const CACHE_BUSTERS = new Set(['t', '_', 'v', 'ver', 'cb']);
export const CITY_HOSTS = new Set(['vineyardutah.gov', 'vineyardutah.org']);
const CITY_PAGE_EXCLUDE = ['calendar.php', 'report-a-concern', '/revize/', '/security/', 'search.php', '/form', 'login', '/_assets_/', '/rss'];
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'ppt', 'pptx']);

/** Python's quote(unquote(path), safe="/%:@!$&'()*+,;=-._~"). */
function quotePath(path: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  const safe = /[A-Za-z0-9/%:@!$&'()*+,;=\-._~]/;
  let out = '';
  for (const ch of decoded) {
    if (safe.test(ch)) out += ch;
    else for (const b of new TextEncoder().encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

export function normalizeUrl(url: string, base?: string): string | null {
  try {
    const u = base ? new URL(url.trim(), base) : new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = quotePath(u.pathname) || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

export function canonicalUrl(url: string): string {
  const n = normalizeUrl(url) ?? url;
  const u = new URL(n);
  const pairs = [...u.searchParams.entries()].filter(([k]) => !CACHE_BUSTERS.has(k.toLowerCase())).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  const q = new URLSearchParams(pairs).toString();
  const host = u.host.replace(/^www\./, '');
  return `https://${host}${u.pathname}${q ? `?${q}` : ''}`;
}

export async function urlKey(url: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalUrl(url)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export type LinkCategory = 'document' | 'city_page' | 'excluded' | 'other';

export function categorize(url: string): { category: LinkCategory; crawlable: boolean; ext: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { category: 'other', crawlable: false, ext: '' };
  }
  const h = u.host.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  const last = path.split('/').pop() ?? '';
  const ext = last.includes('.') ? (last.split('.').pop() ?? '') : '';
  const onCms = h === 'cms3.revize.com' && path.includes('/revize/vineyard/');
  if (!CITY_HOSTS.has(h) && !onCms) return { category: 'other', crawlable: false, ext };
  if (DOC_EXT.has(ext)) return { category: 'document', crawlable: true, ext };
  if (onCms || path.includes('/revize/') || path.includes('security')) return { category: 'excluded', crawlable: false, ext };
  if (CITY_PAGE_EXCLUDE.some((x) => path.includes(x))) return { category: 'excluded', crawlable: false, ext };
  const isPage = /\.(php|html?)$/.test(path) || path.endsWith('/') || !last.includes('.');
  return { category: 'city_page', crawlable: isPage && !u.search, ext };
}
