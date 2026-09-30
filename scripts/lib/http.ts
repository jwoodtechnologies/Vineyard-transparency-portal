/**
 * Polite HTTP client shared by every crawler/adapter/ingest step.
 *
 *  - identifies itself with a descriptive User-Agent (config crawlPolicy.userAgent)
 *  - honours robots.txt (RFC 9309) including Crawl-delay (capped)
 *  - per-host rate limiting (minimum delay between requests to the same host)
 *  - per-attempt timeouts, retries with exponential backoff + jitter, Retry-After support
 *  - manual redirect following with a recorded chain (max hops configurable) and a hook to refuse
 *    redirects to unapproved hosts
 *  - hard response-size limits (streaming; aborts instead of buffering unbounded bodies)
 *  - never executes content; bodies are returned as bytes
 *
 * `fetchImpl` is injectable so the crawler can be unit-tested against a fictional site.
 */
import { crawlDelayFor, isAllowedByRobots, parseRobotsTxt, robotsFromStatus, type RobotsPolicy } from './robots';
import type { CrawlPolicy, DiscoveryErrorKind, RedirectHop } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  userAgent: string;
  robotsUserAgentToken: string;
  timeoutMs: number;
  maxRetries: number;
  maxRedirects: number;
  requestDelayMs: number;
  maxCrawlDelayMs: number;
  respectRobotsTxt: boolean;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  /** Maximum body bytes to read. */
  maxBytes?: number;
  /** 'error' (default) throws HttpError('too_large'); 'truncate' returns the first maxBytes. */
  onTooLarge?: 'error' | 'truncate';
  /** Read the body (default true for GET). */
  readBody?: boolean;
  followRedirects?: boolean;
  /** Return false to stop following a redirect hop (e.g. to an unapproved host). */
  allowRedirect?: (from: string, to: string) => boolean;
  checkRobots?: boolean;
  maxRetries?: number;
}

export interface HttpResponse {
  requestedUrl: string;
  /** Final URL after redirects. */
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  /** Lower-cased MIME type without parameters, or null. */
  contentType: string | null;
  contentLength: number | null;
  body: Uint8Array | null;
  truncated: boolean;
  redirectChain: RedirectHop[];
  /** Set when a redirect was not followed because allowRedirect refused it. */
  redirectRefused: { to: string } | null;
  /** Set when the response looks like a network egress policy denial rather than the site. */
  networkPolicyBlock: string | null;
}

export class HttpError extends Error {
  readonly kind: DiscoveryErrorKind;
  readonly url: string;
  readonly status: number | null;
  constructor(kind: DiscoveryErrorKind, url: string, message: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HttpError';
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

export interface ProbeResult {
  method: 'HEAD' | 'GET';
  status: number;
  contentType: string | null;
  contentLength: number | null;
  finalUrl: string;
  redirectChain: RedirectHop[];
}

/** Interface consumed by discovery/adapters (implemented by PoliteHttpClient and test doubles). */
export interface HttpClientLike {
  request(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  probe(url: string, options?: Pick<HttpRequestOptions, 'allowRedirect'>): Promise<ProbeResult>;
  robotsAllowed(url: string): Promise<boolean>;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 60_000;
const ROBOTS_MAX_BYTES = 512 * 1024;

export function mimeOf(contentTypeHeader: string | null): string | null {
  if (!contentTypeHeader) return null;
  const mime = contentTypeHeader.split(';')[0].trim().toLowerCase();
  return mime || null;
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/** Describe a thrown fetch error (undici puts the useful code on `cause`). */
export function describeNetworkError(error: unknown): { kind: DiscoveryErrorKind; message: string } {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return { kind: 'timeout', message: 'request timed out' };
  const code = err?.cause?.code;
  const detail = [code, err?.cause?.message].filter(Boolean).join(' ');
  return { kind: 'network', message: `${err?.message ?? 'network error'}${detail ? ` (${detail})` : ''}` };
}

/**
 * Heuristic: many sandboxes/corporate proxies answer blocked hosts themselves with a 403 and a
 * marker header or plain-text explanation. Surfacing this avoids blaming the government site.
 */
export function detectNetworkPolicyBlock(status: number, headers: Headers, bodySample: string | null): string | null {
  if (status !== 403 && status !== 407 && status !== 451) return null;
  const denyReason = headers.get('x-deny-reason') ?? headers.get('x-proxy-deny-reason');
  if (denyReason) return `network egress policy denied the request (x-deny-reason: ${denyReason})`;
  if (status === 407) return 'proxy authentication required by the local network';
  if (bodySample && /(not in allowlist|egress|blocked by (your )?(network|proxy|firewall|administrator))/i.test(bodySample)) {
    return `network policy block: ${bodySample.slice(0, 160).trim()}`;
  }
  return null;
}

export function decodeBody(body: Uint8Array, contentTypeHeader: string | null): string {
  let charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentTypeHeader ?? '')?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(body.subarray(0, 2048));
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export function httpOptionsFromPolicy(policy: CrawlPolicy, extra: Partial<HttpClientOptions> = {}): HttpClientOptions {
  return {
    userAgent: policy.userAgent,
    robotsUserAgentToken: policy.robotsUserAgentToken,
    timeoutMs: policy.timeoutMs,
    maxRetries: policy.maxRetries,
    maxRedirects: policy.maxRedirects,
    requestDelayMs: policy.requestDelayMs,
    maxCrawlDelayMs: policy.maxCrawlDelayMs,
    respectRobotsTxt: policy.respectRobotsTxt,
    ...extra,
  };
}

interface RobotsEntry {
  policy: RobotsPolicy;
  networkError: string | null;
}

export class PoliteHttpClient implements HttpClientLike {
  private readonly opts: HttpClientOptions;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly robots = new Map<string, Promise<RobotsEntry>>();
  private readonly hostDelayMs = new Map<string, number>();
  requestCount = 0;

  constructor(options: HttpClientOptions) {
    this.opts = options;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  private log(message: string): void {
    this.opts.log?.(message);
  }

  private async waitForHost(url: string): Promise<void> {
    const host = new URL(url).host;
    const now = this.now();
    const next = this.nextAllowedAt.get(host) ?? 0;
    if (next > now) await this.sleep(next - now);
    const delay = Math.max(this.opts.requestDelayMs, this.hostDelayMs.get(host) ?? 0);
    this.nextAllowedAt.set(host, this.now() + delay);
  }

  private async loadRobots(origin: string): Promise<RobotsEntry> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await this.rawRequest(robotsUrl, {
        method: 'GET',
        maxBytes: ROBOTS_MAX_BYTES,
        onTooLarge: 'truncate',
        checkRobots: false,
        maxRetries: 1,
        followRedirects: true,
      });
      let policy: RobotsPolicy;
      if (res.status >= 200 && res.status < 300 && res.body) {
        policy = parseRobotsTxt(new TextDecoder('utf-8').decode(res.body));
      } else {
        policy = robotsFromStatus(res.status);
      }
      const delay = crawlDelayFor(policy, this.opts.robotsUserAgentToken);
      if (delay !== null) {
        this.hostDelayMs.set(new URL(origin).host, Math.min(delay * 1000, this.opts.maxCrawlDelayMs));
      }
      return { policy, networkError: null };
    } catch (error) {
      // RFC 9309: unreachable robots.txt => assume complete disallow.
      const described = error instanceof HttpError ? error.message : describeNetworkError(error).message;
      return { policy: robotsFromStatus(null), networkError: described };
    }
  }

  private robotsEntry(url: string): Promise<RobotsEntry> {
    const origin = new URL(url).origin;
    let entry = this.robots.get(origin);
    if (!entry) {
      entry = this.loadRobots(origin);
      this.robots.set(origin, entry);
    }
    return entry;
  }

  async robotsAllowed(url: string): Promise<boolean> {
    if (!this.opts.respectRobotsTxt) return true;
    const { policy } = await this.robotsEntry(url);
    const u = new URL(url);
    return isAllowedByRobots(policy, this.opts.robotsUserAgentToken, u.pathname + u.search);
  }

  private async assertRobots(url: string): Promise<void> {
    if (!this.opts.respectRobotsTxt) return;
    const entry = await this.robotsEntry(url);
    const u = new URL(url);
    if (isAllowedByRobots(entry.policy, this.opts.robotsUserAgentToken, u.pathname + u.search)) return;
    if (entry.networkError) {
      throw new HttpError(
        'network',
        url,
        `robots.txt for ${u.origin} could not be fetched (${entry.networkError}); per RFC 9309 the host is treated as fully disallowed`,
      );
    }
    throw new HttpError('robots_disallowed', url, `robots.txt disallows ${u.pathname}${u.search}`);
  }

  private async fetchOnce(url: string, method: 'GET' | 'HEAD', headers: Record<string, string>): Promise<Response> {
    await this.waitForHost(url);
    this.requestCount += 1;
    return this.fetchImpl(url, {
      method,
      redirect: 'manual',
      headers: { 'user-agent': this.opts.userAgent, accept: '*/*', ...headers },
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
  }

  private async fetchWithRetry(url: string, method: 'GET' | 'HEAD', headers: Record<string, string>, maxRetries: number): Promise<Response> {
    let attempt = 0;
    for (;;) {
      try {
        const res = await this.fetchOnce(url, method, headers);
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'), this.now());
          const backoff = retryAfter ?? 1000 * 2 ** attempt + Math.floor(Math.random() * 250);
          await res.body?.cancel().catch(() => undefined);
          this.log(`  retry ${attempt + 1}/${maxRetries} for ${url} after HTTP ${res.status}`);
          await this.sleep(Math.min(backoff, MAX_RETRY_AFTER_MS));
          attempt += 1;
          continue;
        }
        return res;
      } catch (error) {
        if (attempt >= maxRetries) {
          const d = describeNetworkError(error);
          throw new HttpError(d.kind, url, d.message, null, { cause: error });
        }
        this.log(`  retry ${attempt + 1}/${maxRetries} for ${url} after ${describeNetworkError(error).message}`);
        await this.sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 250));
        attempt += 1;
      }
    }
  }

  private async readLimited(res: Response, url: string, maxBytes: number, onTooLarge: 'error' | 'truncate'): Promise<{ body: Uint8Array; truncated: boolean }> {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes && onTooLarge === 'error') {
      await res.body?.cancel().catch(() => undefined);
      throw new HttpError('too_large', url, `response is ${declared} bytes (limit ${maxBytes})`, res.status);
    }
    if (!res.body) return { body: new Uint8Array(0), truncated: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        if (onTooLarge === 'error') throw new HttpError('too_large', url, `response exceeded ${maxBytes} bytes`, res.status);
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      body.set(c, offset);
      offset += c.byteLength;
    }
    return { body, truncated };
  }

  private async rawRequest(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
    const method = options.method ?? 'GET';
    const followRedirects = options.followRedirects ?? true;
    const checkRobots = options.checkRobots ?? this.opts.respectRobotsTxt;
    const maxRetries = options.maxRetries ?? this.opts.maxRetries;
    const chain: RedirectHop[] = [];
    let current = url;
    let redirectRefused: { to: string } | null = null;

    for (let hop = 0; ; hop += 1) {
      if (checkRobots) await this.assertRobots(current);
      const res = await this.fetchWithRetry(current, method, options.headers ?? {}, maxRetries);
      const location = res.headers.get('location');
      if (followRedirects && res.status >= 300 && res.status < 400 && location) {
        let next: string;
        try {
          next = new URL(location, current).toString();
        } catch {
          await res.body?.cancel().catch(() => undefined);
          throw new HttpError('http_status', current, `invalid redirect location "${location}"`, res.status);
        }
        if (!/^https?:$/.test(new URL(next).protocol)) {
          await res.body?.cancel().catch(() => undefined);
          throw new HttpError('http_status', current, `redirect to non-http URL refused (${next})`, res.status);
        }
        if (options.allowRedirect && !options.allowRedirect(current, next)) {
          redirectRefused = { to: next };
          chain.push({ from: current, to: next, status: res.status });
          return this.finish(url, current, res, chain, redirectRefused, method, options);
        }
        chain.push({ from: current, to: next, status: res.status });
        await res.body?.cancel().catch(() => undefined);
        if (hop + 1 > this.opts.maxRedirects) {
          throw new HttpError('too_many_redirects', url, `more than ${this.opts.maxRedirects} redirects`, res.status);
        }
        current = next;
        continue;
      }
      return this.finish(url, current, res, chain, redirectRefused, method, options);
    }
  }

  private async finish(
    requestedUrl: string,
    finalUrl: string,
    res: Response,
    chain: RedirectHop[],
    redirectRefused: { to: string } | null,
    method: 'GET' | 'HEAD',
    options: HttpRequestOptions,
  ): Promise<HttpResponse> {
    const readBody = options.readBody ?? method === 'GET';
    let body: Uint8Array | null = null;
    let truncated = false;
    if (readBody && method === 'GET' && !redirectRefused) {
      const read = await this.readLimited(res, finalUrl, options.maxBytes ?? 10_000_000, options.onTooLarge ?? 'error');
      body = read.body;
      truncated = read.truncated;
    } else {
      await res.body?.cancel().catch(() => undefined);
    }
    const contentTypeHeader = res.headers.get('content-type');
    const lengthHeader = res.headers.get('content-length');
    const rangeTotal = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')?.[1];
    const contentLength = rangeTotal ? Number(rangeTotal) : lengthHeader !== null && lengthHeader !== '' ? Number(lengthHeader) : body && !truncated ? body.byteLength : null;
    const sample = body && body.byteLength < 4096 ? new TextDecoder('utf-8').decode(body) : null;
    return {
      requestedUrl,
      url: finalUrl,
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      headers: res.headers,
      contentType: mimeOf(contentTypeHeader),
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      body,
      truncated,
      redirectChain: chain,
      redirectRefused,
      networkPolicyBlock: detectNetworkPolicyBlock(res.status, res.headers, sample),
    };
  }

  request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    return this.rawRequest(url, options);
  }

  /** HEAD, falling back to a 1-byte ranged GET when HEAD is refused or uninformative. */
  async probe(url: string, options: Pick<HttpRequestOptions, 'allowRedirect'> = {}): Promise<ProbeResult> {
    const head = await this.rawRequest(url, { method: 'HEAD', readBody: false, allowRedirect: options.allowRedirect, maxRetries: 1 });
    const headUseful = head.ok && head.contentType !== null;
    if (headUseful || head.redirectRefused || head.networkPolicyBlock) {
      return { method: 'HEAD', status: head.status, contentType: head.contentType, contentLength: head.contentLength, finalUrl: head.url, redirectChain: head.redirectChain };
    }
    const get = await this.rawRequest(url, {
      method: 'GET',
      headers: { range: 'bytes=0-0' },
      readBody: false,
      allowRedirect: options.allowRedirect,
      maxRetries: 1,
    });
    return { method: 'GET', status: get.status, contentType: get.contentType, contentLength: get.contentLength, finalUrl: get.url, redirectChain: get.redirectChain };
  }
}
