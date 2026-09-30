/**
 * Test fixtures. Everything here is FICTIONAL: hosts are reserved example domains
 * (example.org / example.net / example.com / example.gov-style names) and no content describes
 * Vineyard or any real government record.
 */
import { loadSeedsConfig } from '../../scripts/lib/config';
import type { FetchLike } from '../../scripts/lib/http';
import type { SourceSeedsConfig } from '../../scripts/lib/types';

/** Real config (for its generic patterns) with fictional seeds and approved domains. */
export function testConfig(): SourceSeedsConfig {
  const real = loadSeedsConfig();
  const base = {
    authority: 'Fictional Test Town',
    discoveredFrom: null,
    crawlEnabled: true,
    archiveEnabled: true,
    documentDiscoveryEnabled: true,
    lastChecked: null,
    notes: 'test fixture',
  };
  return {
    ...real,
    primarySourceSeed: 'https://www.example.org/transparency/index.php',
    sources: [
      { ...base, id: 'test-portal', name: 'Test Portal', baseUrl: 'https://www.example.org/transparency/index.php', pathPrefix: '/transparency/', primary: true, sourceType: 'transparency_portal', adapter: 'generic-html' },
      { ...base, id: 'test-city', name: 'Test Town Website', baseUrl: 'https://www.example.org/', sourceType: 'city_website', adapter: 'generic-html' },
      { ...base, id: 'test-meetings', name: 'Test Meeting Portal', baseUrl: 'https://meetings.example.net/', sourceType: 'meeting_portal', adapter: 'suiteone' },
    ],
    approvedDomains: [
      { pattern: 'www.example.org', crawl: 'full', maxDepth: 3, reason: 'fixture' },
      { pattern: 'meetings.example.net', crawl: 'landing_only', reason: 'fixture' },
    ],
    sourceSystemPatterns: [
      { systemKind: 'meeting_portal', label: 'Fixture meeting portal', hostPatterns: ['meetings.example.net'] },
      { systemKind: 'municipal_code', label: 'Fixture code host', hostPatterns: ['code.example.com'] },
      { systemKind: 'financial_transparency', label: 'Fixture finance portal', hostPatterns: ['finance.example.net'] },
      ...real.sourceSystemPatterns,
    ],
    crawlPolicy: { ...real.crawlPolicy, requestDelayMs: 0, maxRetries: 0 },
  };
}

export interface Route {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Separate behaviour for HEAD requests. */
  head?: { status?: number; headers?: Record<string, string> };
}

export interface FakeFetch {
  fetch: FetchLike;
  requests: Array<{ method: string; url: string; headers: Record<string, string> }>;
}

/** Deterministic in-memory "internet" keyed by absolute URL. Unknown URLs return 404. */
export function createFakeFetch(routes: Record<string, Route>): FakeFetch {
  const requests: FakeFetch['requests'] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    requests.push({ method, url: input, headers });
    const route = routes[input];
    if (!route) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    if (method === 'HEAD') {
      const status = route.head?.status ?? route.status ?? 200;
      return new Response(null, { status, headers: route.head?.headers ?? route.headers ?? {} });
    }
    const status = route.status ?? 200;
    const nullBody = status === 204 || status === 304 || (status >= 300 && status < 400 && !route.body);
    return new Response(nullBody ? null : (route.body ?? ''), { status, headers: route.headers ?? {} });
  };
  return { fetch: fetchImpl, requests };
}

const html = (body: string, title = 'Fixture page') =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

/** A small fictional municipal website used by discover() tests. */
export function fictionalSite(): Record<string, Route> {
  const H = { 'content-type': 'text/html; charset=utf-8' };
  return {
    'https://www.example.org/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /private/\n' },
    'https://meetings.example.net/robots.txt': { status: 404 },
    'https://www.example.org/transparency/index.php': {
      headers: H,
      body: html(
        `<h1>Test Town Transparency</h1>
         <!-- <a href="/commented-out.pdf">hidden</a> -->
         <script>var x = '<a href="/script.pdf">no</a>';</script>
         <ul>
           <li><a href="docs/budget-2026.pdf">FY2026 Adopted Budget</a></li>
           <li><a href="docs/budget-2026.pdf#page=2">Budget (page 2)</a></li>
           <li><a href="/DocumentCenter/View/123">Agenda Packet &ndash; January 5, 2026</a></li>
           <li><a href="https://www.example.org/transparency/minutes.html?utm_source=newsletter">Meeting Minutes</a></li>
           <li><a href="/transparency/check-register.xlsx">Check Register</a></li>
           <li><a href="https://meetings.example.net/">Meeting Portal</a></li>
           <li><a href="https://code.example.com/codes/test_town">Municipal Code</a></li>
           <li><a href="https://finance.example.net/entity/42">Financial transparency</a></li>
           <li><a href="https://www.facebook.com/testtown">Follow us</a></li>
           <li><a href="https://www.youtube.com/watch?v=abc123">Watch the council meeting</a></li>
           <li><a href="mailto:clerk@example.org">Email the clerk</a></li>
           <li><a href="/private/reports.html">Private reports</a></li>
           <li><a href="/about-us.html">About us</a></li>
           <li><a href="/old-records">Records archive</a></li>
         </ul>`,
        'Transparency | Test Town',
      ),
    },
    'https://www.example.org/transparency/docs/budget-2026.pdf': { head: { headers: { 'content-type': 'application/pdf', 'content-length': '2048' } } },
    'https://www.example.org/DocumentCenter/View/123': {
      head: { status: 405 },
      status: 206,
      headers: { 'content-type': 'application/pdf', 'content-range': 'bytes 0-0/5000', 'content-length': '1' },
      body: '%',
    },
    'https://www.example.org/transparency/check-register.xlsx': {
      head: { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-length': '900' } },
    },
    'https://www.example.org/transparency/minutes.html?utm_source=newsletter': {
      headers: H,
      body: html(`<a href="/files/minutes-2026-01-05.pdf">Minutes - January 5, 2026</a> <a href="index.php">Back</a>`),
    },
    'https://www.example.org/files/minutes-2026-01-05.pdf': { head: { headers: { 'content-type': 'application/pdf', 'content-length': '1500' } } },
    'https://www.example.org/old-records': { status: 301, headers: { location: '/records/' } },
    'https://www.example.org/records/': {
      headers: H,
      body: html(`<a href="/files/Resolution-2026-14.docx">Resolution No. 2026-14</a>`),
    },
    'https://www.example.org/files/Resolution-2026-14.docx': {
      head: { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-length': '3000' } },
    },
    'https://meetings.example.net/': { headers: H, body: html(`<a href="/meeting?id=A7">Council Meeting January 5, 2026</a>`) },
  };
}
