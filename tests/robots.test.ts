import { describe, expect, it } from 'vitest';
import { crawlDelayFor, isAllowedByRobots, parseRobotsTxt, robotsFromStatus } from '../scripts/lib/robots';

const TOKEN = 'VineyardTransparencyPortalBot';

describe('robots.txt parsing (RFC 9309)', () => {
  const policy = parseRobotsTxt(`
# comment
User-agent: *
Disallow: /private/
Disallow: /*.php$
Allow: /private/public-records/
Crawl-delay: 5

User-agent: BadBot
Disallow: /

Sitemap: https://www.example.org/sitemap.xml
`);

  it('applies longest-match with Allow winning ties', () => {
    expect(isAllowedByRobots(policy, TOKEN, '/')).toBe(true);
    expect(isAllowedByRobots(policy, TOKEN, '/private/x')).toBe(false);
    expect(isAllowedByRobots(policy, TOKEN, '/private/public-records/a.pdf')).toBe(true);
  });

  it('supports * wildcards and $ anchors', () => {
    expect(isAllowedByRobots(policy, TOKEN, '/index.php')).toBe(false);
    expect(isAllowedByRobots(policy, TOKEN, '/index.php?x=1')).toBe(true);
  });

  it('uses the most specific user-agent group', () => {
    expect(isAllowedByRobots(policy, 'BadBot', '/anything')).toBe(false);
    const specific = parseRobotsTxt(`User-agent: *\nDisallow: /\n\nUser-agent: vineyardtransparencyportalbot\nAllow: /\n`);
    expect(isAllowedByRobots(specific, TOKEN, '/x')).toBe(true);
  });

  it('groups consecutive user-agent lines', () => {
    const p = parseRobotsTxt(`User-agent: a\nUser-agent: ${TOKEN}\nDisallow: /x\n`);
    expect(isAllowedByRobots(p, TOKEN, '/x/y')).toBe(false);
  });

  it('treats an empty Disallow as allow-all and always allows /robots.txt', () => {
    const p = parseRobotsTxt('User-agent: *\nDisallow:\n');
    expect(isAllowedByRobots(p, TOKEN, '/anything')).toBe(true);
    expect(isAllowedByRobots(parseRobotsTxt('User-agent: *\nDisallow: /'), TOKEN, '/robots.txt')).toBe(true);
  });

  it('records Crawl-delay and sitemaps', () => {
    expect(crawlDelayFor(policy, TOKEN)).toBe(5);
    expect(policy.sitemaps).toEqual(['https://www.example.org/sitemap.xml']);
  });

  it('follows RFC 9309 availability rules', () => {
    expect(isAllowedByRobots(robotsFromStatus(404), TOKEN, '/x')).toBe(true);
    expect(isAllowedByRobots(robotsFromStatus(403), TOKEN, '/x')).toBe(true);
    expect(isAllowedByRobots(robotsFromStatus(503), TOKEN, '/x')).toBe(false);
    expect(isAllowedByRobots(robotsFromStatus(null), TOKEN, '/x')).toBe(false);
  });
});
