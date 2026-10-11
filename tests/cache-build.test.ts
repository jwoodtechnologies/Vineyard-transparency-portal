/**
 * Nothing outlives a deploy: pages and theme-init.js are revalidated on every load, hashed assets are kept a
 * year, API copies at the edge are keyed to the build and the data version, and the client discards its kept
 * API copies when its own build changes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetCacheControl, assetHeaders, buildId, cacheKey, HTML_CACHE, IMMUTABLE_CACHE } from '../worker/lib/edgeCache';
import { fresh, resetForBuild } from '../src/console/api';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

class FakeStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

describe('edge cache keys', () => {
  const url = new URL('https://vineyardportal.org/api/records/ordinances?year=2026&_=5873.abc');

  it('carry the build and the data version, never the client marker', () => {
    const k = new URL(cacheKey(url, 'v-111', '42').url);
    expect(k.searchParams.get('_')).toBeNull();
    expect(k.searchParams.get('__b')).toBe('v-111');
    expect(k.searchParams.get('__v')).toBe('42');
    expect(k.searchParams.get('year')).toBe('2026');
  });

  it('a new deploy or a new ingest is a new key; the same build and data are the same key', () => {
    const a = cacheKey(url, 'v-111', '42').url;
    expect(cacheKey(new URL('https://vineyardportal.org/api/records/ordinances?_=1.x&year=2026'), 'v-111', '42').url).toBe(a);
    expect(cacheKey(url, 'v-222', '42').url).not.toBe(a);
    expect(cacheKey(url, 'v-111', '43').url).not.toBe(a);
    // The stale-while-revalidate copy is per build: another build's copy is never served.
    expect(cacheKey(url, 'v-222', 'latest').url).not.toBe(cacheKey(url, 'v-111', 'latest').url);
  });

  it('a request cannot choose another build key', () => {
    const forged = new URL('https://vineyardportal.org/api/records/ordinances?year=2026&__b=old&__v=1');
    const k = new URL(cacheKey(forged, 'v-111', '42').url);
    expect(k.searchParams.getAll('__b')).toEqual(['v-111']);
    expect(k.searchParams.getAll('__v')).toEqual(['42']);
  });

  it('the build is the deployed version id', () => {
    expect(buildId({ CF_VERSION_METADATA: { id: 'abc-123' } })).toBe('abc-123');
    expect(buildId({})).toBe('dev');
  });
});

describe('static headers', () => {
  it('pages and theme-init.js revalidate; hashed assets are immutable', () => {
    expect(assetCacheControl('/', 'text/html; charset=utf-8')).toBe(HTML_CACHE);
    expect(assetCacheControl('/records/ordinances', 'text/html')).toBe(HTML_CACHE);
    expect(assetCacheControl('/theme-init.js', 'application/javascript')).toBe(HTML_CACHE);
    expect(assetCacheControl('/assets/index-abc123.js', 'application/javascript')).toBe(IMMUTABLE_CACHE);
    expect(assetCacheControl('/favicon.svg', 'image/svg+xml')).toBeNull();
    expect(HTML_CACHE).toBe('no-cache, max-age=0, must-revalidate');
    expect(IMMUTABLE_CACHE).toBe('public, max-age=31536000, immutable');
  });

  it('the Worker sets them on assets it serves', () => {
    const res = assetHeaders(new URL('https://vineyardportal.org/votes'), new Response('<!doctype html>', { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=14400' } }));
    expect(res.headers.get('cache-control')).toBe(HTML_CACHE);
  });

  it('public/_headers: no-cache for every page, immutable for /assets/*', () => {
    const h = read('public/_headers');
    const blocks = h.split(/\n(?=\/)/);
    const all = blocks.find((b) => b.startsWith('/*\n'))!;
    const assets = blocks.find((b) => b.startsWith('/assets/*\n'))!;
    expect(all).toMatch(/^\s+Cache-Control: no-cache, max-age=0, must-revalidate$/m);
    expect(assets).toMatch(/^\s+! Cache-Control$/m);
    expect(assets).toMatch(/^\s+Cache-Control: public, max-age=31536000, immutable$/m);
    // No rule caches a page or theme-init.js for longer.
    expect(h).not.toMatch(/\/theme-init\.js\n\s+Cache-Control: public/);
  });

  it('wrangler: only the API and feeds run the Worker first; the version binding is declared', () => {
    const w = read('wrangler.jsonc');
    expect(w).toMatch(/"version_metadata":\s*\{\s*"binding":\s*"CF_VERSION_METADATA"\s*\}/);
    expect(w).toMatch(/"run_worker_first":\s*\["\/api\/\*",\s*"\/feeds\/\*"\]/);
  });
});

describe('client copies', () => {
  it('a new build discards every kept API copy, once', () => {
    const s = new FakeStorage();
    s.setItem('vtp:api:build', 'old');
    s.setItem('vtp:api:/api/records/ordinances?year=2026', '1\n{"rows":[]}');
    s.setItem('vtp:api:index', '["/api/records/ordinances?year=2026"]');
    s.setItem('vtp:theme', 'dark');
    expect(resetForBuild('new', s as unknown as Storage)).toBe(true);
    expect([...s.map.keys()].sort()).toEqual(['vtp:api:build', 'vtp:theme']);
    expect(s.getItem('vtp:api:build')).toBe('new');
    expect(resetForBuild('new', s as unknown as Storage)).toBe(false);
  });

  it('every API request carries the build, so no browser copy from an earlier build is reused', () => {
    expect(fresh('/api/records/ordinances?year=2026', 'b1')).toMatch(/[?&]_=\d+\.b1$/);
    expect(fresh('/api/records/ordinances?year=2026', 'b1')).not.toBe(fresh('/api/records/ordinances?year=2026', 'b2'));
  });

  it('theme-init.js sends the same marker for its early request', () => {
    expect(read('public/theme-init.js')).toMatch(/meta\[name="vtp-build"\]/);
    expect(read('vite.config.ts')).toMatch(/<meta name="vtp-build"/);
  });
});

describe('map full screen on Apple touch devices', () => {
  it('uses its own full screen box on iPhone and iPad, never Safari full screen', async () => {
    const { isAppleTouch } = await import('../src/lib/appleTouch');
    expect(isAppleTouch('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 5)).toBe(true);
    expect(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5)).toBe(true);
    expect(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0)).toBe(false);
    expect(isAppleTouch('Mozilla/5.0 (Linux; Android 14) Chrome/141.0 Mobile', 5)).toBe(false);
  });
});
