import { describe, expect, it } from 'vitest';
import { discover } from '../scripts/lib/discover';
import { PoliteHttpClient, type FetchLike } from '../scripts/lib/http';
import { formatDiscoverySummary } from '../scripts/lib/summary';
import { createFakeFetch, fictionalSite, testConfig } from './helpers/fixtures';

function client(fetchImpl: FetchLike) {
  const cfg = testConfig();
  return new PoliteHttpClient({
    userAgent: 'TestBot/1.0 (+https://example.org/contact)',
    robotsUserAgentToken: 'TestBot',
    timeoutMs: 5000,
    maxRetries: 0,
    maxRedirects: cfg.crawlPolicy.maxRedirects,
    requestDelayMs: 0,
    maxCrawlDelayMs: 0,
    respectRobotsTxt: true,
    fetchImpl,
    sleep: async () => undefined,
  });
}

const FIXED_NOW = () => new Date('2026-01-01T00:00:00.000Z');

describe('discover() over a fictional site', () => {
  it('crawls, classifies, dedupes and summarises with real computed counts', async () => {
    const fake = createFakeFetch(fictionalSite());
    const manifest = await discover({ config: testConfig(), http: client(fake.fetch), maxDepth: 2, now: FIXED_NOW });

    expect(manifest.seedReachable).toBe(true);
    expect(manifest.generatedAt).toBe('2026-01-01T00:00:00.000Z');

    // Documents: fragments/tracking params collapse; files found on child pages are included.
    const docs = manifest.documents.map((d) => d.normalizedUrl).sort();
    expect(docs).toEqual([
      'https://www.example.org/DocumentCenter/View/123',
      'https://www.example.org/files/Resolution-2026-14.docx',
      'https://www.example.org/files/minutes-2026-01-05.pdf',
      'https://www.example.org/transparency/check-register.xlsx',
      'https://www.example.org/transparency/docs/budget-2026.pdf',
    ]);
    const budget = manifest.documents.find((d) => d.url.endsWith('budget-2026.pdf'));
    expect(budget?.linkTexts).toEqual(['FY2026 Adopted Budget', 'Budget (page 2)']);
    expect(budget?.documentTypeHint).toBe('budget');
    expect(budget?.probe).toMatchObject({ method: 'HEAD', contentType: 'application/pdf', contentLength: 2048 });

    // HEAD refused (405) → ranged GET fallback learns type and total length.
    const library = manifest.documents.find((d) => d.url.endsWith('/View/123'));
    expect(library?.probe).toMatchObject({ method: 'GET', status: 206, contentType: 'application/pdf', contentLength: 5000 });
    expect(library?.fileKind).toBe('pdf');
    expect(library?.documentTypeHint).toBe('agenda_packet');

    const resolution = manifest.documents.find((d) => d.url.endsWith('.docx'));
    expect(resolution?.documentTypeHint).toBe('resolution');
    expect(resolution?.fileKind).toBe('word');

    // Redirect chain recorded.
    expect(manifest.redirects).toContainEqual({
      requestedUrl: 'https://www.example.org/old-records',
      finalUrl: 'https://www.example.org/records/',
      chain: [{ from: 'https://www.example.org/old-records', to: 'https://www.example.org/records/', status: 301 }],
    });

    // Source systems, grouped by kind.
    const ids = Object.values(manifest.sources).flat().map((s) => s?.id).sort();
    expect(ids).toEqual([
      'document-library-www-example-org-documentcenter',
      'financial-transparency-finance-example-net',
      'meeting-media-www-youtube-com',
      'municipal-code-code-example-com',
      'test-city',
      'test-meetings',
      'test-portal',
    ]);
    const code = manifest.sources.municipal_code?.[0];
    expect(code).toMatchObject({ reviewStatus: 'needs_review', hostApproved: false, reached: false, discoveredFrom: 'https://www.example.org/transparency/index.php' });
    expect(manifest.sources.meeting_portal?.[0]).toMatchObject({ id: 'test-meetings', reviewStatus: 'configured', reached: true });

    expect(manifest.summary).toEqual({
      sourceSystems: 7,
      directDocumentLinks: 5,
      meetingOrPublicNoticeSystems: 2,
      financialReportingSystems: 1,
      municipalCodeSystems: 1,
      documentLibraries: 1,
      sourcesNeedingReview: 4,
    });

    // Policy: never requested denied/unapproved hosts; robots.txt disallow honoured; landing_only respected.
    const requested = fake.requests.map((r) => r.url);
    expect(requested.some((u) => u.includes('facebook.com'))).toBe(false);
    expect(requested.some((u) => u.includes('youtube.com'))).toBe(false);
    expect(requested.some((u) => u.includes('code.example.com'))).toBe(false);
    expect(requested.some((u) => u.includes('/private/'))).toBe(false);
    expect(requested).not.toContain('https://meetings.example.net/meeting?id=A7');
    expect(requested).not.toContain('https://www.example.org/about-us.html');
    expect(manifest.errors).toContainEqual(expect.objectContaining({ kind: 'robots_disallowed', url: 'https://www.example.org/private/reports.html' }));
    expect(manifest.stats.skippedDenied).toBeGreaterThanOrEqual(1);
    expect(manifest.stats.skippedNotRelevant).toBeGreaterThanOrEqual(1);
    expect(manifest.mediaLinks.map((m) => m.url)).toEqual(['https://www.youtube.com/watch?v=abc123']);
    // Every request identified the crawler.
    expect(fake.requests.every((r) => r.headers['user-agent']?.startsWith('TestBot/1.0'))).toBe(true);

    const summary = formatDiscoverySummary(manifest, null);
    expect(summary).toContain('7 source systems identified.');
    expect(summary).toContain('5 direct document links identified.');
    expect(summary).toContain('2 meeting/public-notice systems identified.');
    expect(summary).toContain('1 financial-reporting system identified.');
    expect(summary).toContain('1 municipal-code system identified.');
  });

  it('respects maxDepth', async () => {
    const fake = createFakeFetch(fictionalSite());
    const manifest = await discover({ config: testConfig(), http: client(fake.fetch), maxDepth: 0, probeDocuments: false, now: FIXED_NOW });
    expect(manifest.stats.pagesFetched).toBe(1);
    expect(manifest.documents.some((d) => d.url.includes('minutes-2026'))).toBe(false);
    expect(manifest.stats.skippedDepth).toBeGreaterThan(0);
  });

  it('reports an unreachable seed without inventing results', async () => {
    const failing: FetchLike = async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND www.example.org' } });
    };
    const manifest = await discover({ config: testConfig(), http: client(failing), now: FIXED_NOW });
    expect(manifest.seedReachable).toBe(false);
    expect(manifest.documents).toEqual([]);
    expect(manifest.summary.sourceSystems).toBe(0);
    expect(manifest.errors[0]).toMatchObject({ kind: 'network' });
    expect(manifest.errors[0].message).toContain('ENOTFOUND');
  });

  it('identifies a network egress-policy denial instead of blaming the site', async () => {
    const proxy: FetchLike = async () =>
      new Response('Host not in allowlist: www.example.org', { status: 403, headers: { 'content-type': 'text/plain', 'x-deny-reason': 'host_not_allowed' } });
    const manifest = await discover({ config: testConfig(), http: client(proxy), now: FIXED_NOW });
    expect(manifest.seedReachable).toBe(false);
    expect(manifest.errors[0]).toMatchObject({ kind: 'blocked_by_network_policy', status: 403 });
  });

  it('refuses redirects to unapproved hosts and records them', async () => {
    const routes = fictionalSite();
    routes['https://www.example.org/transparency/index.php'] = { status: 302, headers: { location: 'https://elsewhere.example.com/landing' } };
    const manifest = await discover({ config: testConfig(), http: client(createFakeFetch(routes).fetch), now: FIXED_NOW });
    expect(manifest.seedReachable).toBe(false);
    expect(manifest.errors[0]).toMatchObject({ kind: 'redirect_to_unapproved_host' });
    expect(manifest.redirects[0].chain[0].to).toBe('https://elsewhere.example.com/landing');
  });

  it('stops after too many redirects', async () => {
    const routes = fictionalSite();
    routes['https://www.example.org/transparency/index.php'] = { status: 302, headers: { location: '/loop' } };
    routes['https://www.example.org/loop'] = { status: 302, headers: { location: '/transparency/index.php' } };
    const manifest = await discover({ config: testConfig(), http: client(createFakeFetch(routes).fetch), now: FIXED_NOW });
    expect(manifest.errors[0]).toMatchObject({ kind: 'too_many_redirects' });
  });
});
