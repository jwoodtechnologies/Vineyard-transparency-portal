import { describe, expect, it } from 'vitest';
import { isChunkError, RELOAD_GAP_MS, shouldReload } from '../src/lib/chunkErrors';

describe('reloading once when the app code cannot load', () => {
  it('knows a failed code load in each browser wording', () => {
    expect(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://vineyardportal.org/assets/MapPage-kxQtraU9.js'))).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkError(new Error("Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\". Strict MIME type checking is enforced for module scripts per HTML spec. 'text/html' is not a valid JavaScript MIME type."))).toBe(true);
    expect(isChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });

  it('reloads at most once a minute, so a real outage never loops', () => {
    expect(shouldReload(1_000_000, null)).toBe(true);
    expect(shouldReload(1_000_000, 1_000_000 - 5_000)).toBe(false);
    expect(shouldReload(1_000_000, 1_000_000 - RELOAD_GAP_MS - 1)).toBe(true);
  });
});

import { readFileSync } from 'node:fs';

describe('the service worker and the app code', () => {
  it('never answers or keeps /assets/*, and never keeps HTML', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toMatch(/pathname\.startsWith\('\/assets\/'\)/);
    expect(sw).toMatch(/!\/text\\\/html\/i\.test/);
  });
});
