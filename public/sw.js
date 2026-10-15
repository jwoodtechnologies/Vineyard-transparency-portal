/*
 * The map's tile cache. Map tiles that never change under their address (elevation tiles and OpenFreeMap's
 * versioned vector tiles) and the county's and the USGS aerial photos are kept in the browser after the
 * first view, so panning back, going back into 3D, or the next visit draws them without the network.
 * Nothing else is touched: pages, the app's own files and every /api request go to the network as usual.
 *
 * At most MAX_ENTRIES tiles are kept (about 150 to 250 MB at the usual tile sizes); the oldest go first.
 * Tiles older than MAX_AGE_DAYS are fetched again when the network answers.
 */
const CACHE = 'vtp-tiles-v3';
const MAX_ENTRIES = 3000;
const MAX_AGE_DAYS = 30;
const TILE_HOSTS = [
  /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\/\d+\/\d+\/\d+\.png$/,
  /^https:\/\/tiles\.openfreemap\.org\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/,
  /^https:\/\/gisaerials\.utahcounty\.gov\/arcgis\/rest\/services\/NewestImagery\//,
  /^https:\/\/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly\//,
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('vtp-tiles-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

let puts = 0;
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

const fresh = (res) => {
  const at = Date.parse(res.headers.get('x-vtp-cached') || res.headers.get('date') || '');
  return Number.isFinite(at) && Date.now() - at < MAX_AGE_DAYS * 86400000;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !TILE_HOSTS.some((r) => r.test(req.url))) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req.url);
      if (hit && fresh(hit)) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) {
          // Stamp when it was kept (the copy's own date header may be the server's original).
          const body = await res.clone().arrayBuffer();
          const headers = new Headers(res.headers);
          headers.set('x-vtp-cached', new Date().toUTCString());
          e.waitUntil(
            cache.put(req.url, new Response(body, { status: res.status, statusText: res.statusText, headers })).then(() => {
              if (++puts % 100 === 0) return trim(cache);
            }),
          );
        }
        return res;
      } catch (err) {
        if (hit) return hit;
        throw err;
      }
    })(),
  );
});
