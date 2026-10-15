/*
 * The map's tile cache, for two kinds of tiles that never change under their address: the elevation tiles
 * (AWS Terrain Tiles) and OpenFreeMap's versioned vector tiles. After the first view they come from here, so
 * panning back, going back into 3D or the next visit draws them without the network.
 *
 * Everything else passes straight through untouched (no respondWith at all): pages, the app's own files,
 * every /api request, and the aerial photos. Responses are kept exactly as the network gave them, never
 * rebuilt. If anything here fails, the request goes to the network as if this file did not exist.
 *
 * At most MAX_ENTRIES tiles are kept; the oldest go first. A new CACHE name drops every older cache when this
 * version takes over (vtp-tiles-v1 to v3 held aerial photos and are removed).
 */
const CACHE = 'vtp-tiles-v4';
const MAX_ENTRIES = 3000;
const TILE_HOSTS = [
  /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/,
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

let puts = 0;
async function keep(url, res) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(url, res);
    if (++puts % 100 === 0) {
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
    }
  } catch {
    // Storage full or unavailable: the tile was still shown.
  }
}

async function cached(url) {
  try {
    return (await (await caches.open(CACHE)).match(url)) ?? null;
  } catch {
    return null;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !TILE_HOSTS.some((r) => r.test(req.url))) return;
  e.respondWith(
    (async () => {
      const hit = await cached(req.url);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'cors') e.waitUntil(keep(req.url, res.clone()));
      return res;
    })().catch(() => fetch(req)),
  );
});
