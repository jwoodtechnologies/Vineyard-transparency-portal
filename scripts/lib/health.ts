/**
 * Generic source health check used by every adapter (adapters may add structure checks).
 *
 * Status mapping:
 *   active                  2xx HTML with links on the expected host
 *   degraded                429 / 5xx / too many redirects / page without links (JS-only?)
 *   unreachable             DNS / connection / timeout failures
 *   changed                 404/410, redirect to another host, or link structure changed since last check
 *   authentication_required 401 / 407
 *   blocked                 403, robots.txt disallow, or a local network-policy denial
 *   unknown                 no baseUrl configured yet
 */
import type { SourceHealthStatus } from '../../src/types/models';
import { extractLinks } from './html';
import { decodeBody, HttpError, type HttpClientLike } from './http';
import { sha256Hex } from './hash';
import { hostOf } from './url';
import type { AdapterId, SourceHealthRecord } from './types';

export interface HealthTarget {
  id: string;
  name: string;
  baseUrl: string;
  adapter: AdapterId;
}

export interface HealthCheckOptions {
  /** Links that must be present for the source to count as structurally intact. */
  expectedLinkPattern?: RegExp;
  expectedLinkDescription?: string;
  now?: () => Date;
}

/** Hash of the same-host link "shapes" (digits collapsed) — stable across routine content updates. */
export function linkStructureFingerprint(pageUrl: string, urls: Array<string | null>): string {
  const host = hostOf(pageUrl);
  const shapes = new Set<string>();
  for (const u of urls) {
    if (!u || hostOf(u) !== host) continue;
    const { pathname } = new URL(u);
    shapes.add(pathname.toLowerCase().replace(/\d+/g, '#').split('/').slice(0, 3).join('/'));
  }
  return sha256Hex([...shapes].sort().join('\n')).slice(0, 16);
}

export async function checkSourceHealth(
  http: HttpClientLike,
  target: HealthTarget,
  previous: SourceHealthRecord | null,
  options: HealthCheckOptions = {},
): Promise<SourceHealthRecord> {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const base = {
    sourceId: target.id,
    name: target.name,
    baseUrl: target.baseUrl,
    adapterId: target.adapter,
    lastCheckedAt: now,
    lastSuccessfulCheckAt: previous?.lastSuccessfulCheckAt ?? null,
  };
  const result = (status: SourceHealthStatus, message: string, extra: Partial<SourceHealthRecord> = {}): SourceHealthRecord => ({
    ...base,
    status,
    message,
    httpStatus: null,
    finalUrl: null,
    fingerprint: previous?.fingerprint ?? null,
    ...extra,
  });

  if (!target.baseUrl) return result('unknown', 'No baseUrl configured (must be discovered and reviewed first).');

  let res;
  try {
    res = await http.request(target.baseUrl, { maxBytes: 3_000_000, onTooLarge: 'truncate' });
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.kind === 'robots_disallowed') return result('blocked', error.message);
      if (error.kind === 'too_many_redirects') return result('degraded', error.message);
      return result('unreachable', error.message);
    }
    return result('unreachable', (error as Error).message);
  }

  const httpExtra = { httpStatus: res.status, finalUrl: res.url };
  if (res.networkPolicyBlock) return result('blocked', `Local network policy: ${res.networkPolicyBlock}`, httpExtra);
  if (res.status === 401 || res.status === 407) return result('authentication_required', `HTTP ${res.status}`, httpExtra);
  if (res.status === 403 || res.status === 451) return result('blocked', `HTTP ${res.status}`, httpExtra);
  if (res.status === 404 || res.status === 410) return result('changed', `HTTP ${res.status}: base URL no longer resolves`, httpExtra);
  if (res.status === 429 || res.status >= 500) return result('degraded', `HTTP ${res.status}`, httpExtra);
  if (!res.ok) return result('degraded', `HTTP ${res.status}`, httpExtra);

  const success = { ...httpExtra, lastSuccessfulCheckAt: now };
  if (hostOf(res.url) !== hostOf(target.baseUrl)) {
    return result('changed', `Redirected to a different host: ${res.url}`, success);
  }
  if (res.contentType && res.contentType !== 'text/html' && res.contentType !== 'application/xhtml+xml') {
    return result('active', `Reachable (${res.contentType})`, success);
  }
  const page = extractLinks(decodeBody(res.body ?? new Uint8Array(0), res.headers.get('content-type')), res.url);
  const fingerprint = linkStructureFingerprint(res.url, page.links.map((l) => l.url));
  if (!page.links.length) {
    return result('degraded', 'Page has no links (content may be rendered by JavaScript; adapter needs an API/listing endpoint).', { ...success, fingerprint });
  }
  if (options.expectedLinkPattern && !page.links.some((l) => l.url && options.expectedLinkPattern?.test(l.url + ' ' + l.text))) {
    return result('changed', `Expected ${options.expectedLinkDescription ?? 'links'} not found; page structure may have changed.`, { ...success, fingerprint });
  }
  if (previous?.fingerprint && previous.fingerprint !== fingerprint) {
    return result('changed', 'Link structure differs from the previous check; verify the adapter still works.', { ...success, fingerprint });
  }
  return result('active', `Reachable; ${page.links.length} links`, { ...success, fingerprint });
}
