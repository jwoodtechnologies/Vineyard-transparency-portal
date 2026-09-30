/**
 * Minimal robots.txt parser following RFC 9309 (Robots Exclusion Protocol).
 *
 *  - Groups start with one or more User-agent lines; rules apply to the group whose product token
 *    matches ours (case-insensitive substring of the token), else the "*" group.
 *  - Allow/Disallow: the longest matching path wins; on a tie, Allow wins.
 *  - "*" matches any character sequence and a trailing "$" anchors the end.
 *  - Crawl-delay (non-standard) is recorded for the matched group so callers may honour it.
 *  - Availability (RFC 9309 §2.3.1): a 4xx robots.txt means "no restrictions"; a 5xx or network
 *    failure means "assume complete disallow". See robotsFromStatus().
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

export interface RobotsPolicy {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** When set, overrides rule evaluation (used for unavailable/unreachable robots.txt). */
  blanket: 'allow_all' | 'disallow_all' | null;
}

export function parseRobotsTxt(text: string): RobotsPolicy {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySeconds: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue; // rules before any User-agent are ignored
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" and contributes no rule.
      if (value === '') continue;
      current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySeconds = n;
    }
  }
  return { groups, sitemaps, blanket: null };
}

/** Policy for a robots.txt fetch that did not return 2xx (RFC 9309 §2.3.1). */
export function robotsFromStatus(status: number | null): RobotsPolicy {
  if (status !== null && status >= 400 && status < 500) return { groups: [], sitemaps: [], blanket: 'allow_all' };
  return { groups: [], sitemaps: [], blanket: 'disallow_all' };
}

function selectGroups(policy: RobotsPolicy, userAgentToken: string): RobotsGroup[] {
  const token = userAgentToken.toLowerCase();
  const specific = policy.groups.filter((g) => g.agents.some((a) => a !== '*' && (token.includes(a) || a.includes(token))));
  if (specific.length) return specific;
  return policy.groups.filter((g) => g.agents.includes('*'));
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert a robots path pattern into an anchored RegExp. */
export function robotsPatternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split('*').map(escapeRegex).join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`);
}

function normalizeForMatch(pathWithQuery: string): string {
  // Compare in a canonical percent-encoding: decode unreserved escapes only.
  return pathWithQuery.replace(/%([0-9a-f]{2})/gi, (m, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(ch) ? ch : m.toUpperCase();
  });
}

/** True if `pathWithQuery` (e.g. "/a/b?c=1") may be fetched by `userAgentToken`. */
export function isAllowedByRobots(policy: RobotsPolicy, userAgentToken: string, pathWithQuery: string): boolean {
  if (policy.blanket === 'allow_all') return true;
  if (policy.blanket === 'disallow_all') return false;
  const path = normalizeForMatch(pathWithQuery || '/');
  if (path === '/robots.txt') return true;
  const rules = selectGroups(policy, userAgentToken).flatMap((g) => g.rules);
  let best: RobotsRule | null = null;
  let bestLength = -1;
  for (const rule of rules) {
    const pattern = normalizeForMatch(rule.pattern);
    if (!robotsPatternToRegex(pattern).test(path)) continue;
    const length = pattern.length;
    if (length > bestLength || (length === bestLength && rule.allow && best && !best.allow)) {
      best = rule;
      bestLength = length;
    }
  }
  return best ? best.allow : true;
}

/** Crawl-delay in seconds for our agent, or null. */
export function crawlDelayFor(policy: RobotsPolicy, userAgentToken: string): number | null {
  const delays = selectGroups(policy, userAgentToken)
    .map((g) => g.crawlDelaySeconds)
    .filter((d): d is number => d !== null);
  return delays.length ? Math.max(...delays) : null;
}
