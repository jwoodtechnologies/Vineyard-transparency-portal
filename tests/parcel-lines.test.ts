import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkParcelLines, parcelLinesKey } from '../worker/lib/parcelLines';
import { MAP_LAYERS } from '../worker/lib/mapLayers';
import { decodeLines, FULL_ZOOM, levelFor, tapLooksUpParcel, tilesMinZoom } from '../src/console/parcelLines';

// Loaded by path at run time: the module uses Worker types this test project does not compile.
const WORKER_MAP = '../worker/api/map';
type Routes = {
  getParcelLines: (env: unknown, request: Request, url: URL) => Promise<Response>;
  putParcelLines: (env: unknown, request: Request, level: string) => Promise<Response>;
  PARCEL_LINES_CACHE: string;
};
const routes = async () => (await import(/* @vite-ignore */ WORKER_MAP)) as Routes;

/** A line set as ingest/parcel_lines.py writes it: two squares sharing an edge. */
const set = (over: Record<string, unknown> = {}) => ({
  format: 'vtp-parcel-lines/1',
  level: 'low',
  scale: 100000,
  origin: [-11177394, 4027688],
  area: [-111.773939, 40.276875, -111.731013, 40.334959],
  count: 2,
  lines: [
    [100, 200, 100, 0, 100, 0, 0, 100, -100, 0, -100, 0, 0, -100],
    [200, 200, 0, 100],
  ],
  version: '0123456789abcdef',
  built: '2026-10-12',
  ...over,
});

/** Just enough of an R2 bucket. */
function bucket() {
  const store = new Map<string, { bytes: Uint8Array; meta: Record<string, string>; http: Record<string, string> }>();
  return {
    store,
    async put(key: string, value: ArrayBuffer, opts: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> }) {
      store.set(key, { bytes: new Uint8Array(value), meta: opts.customMetadata ?? {}, http: opts.httpMetadata ?? {} });
      return { size: value.byteLength };
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return { body: new Blob([new Uint8Array(o.bytes)]).stream(), size: o.bytes.length, etag: 'r2etag', customMetadata: o.meta };
    },
  };
}

const put = (body: unknown, level = 'low') => new Request(`https://x/api/admin/map/parcel-lines/${level}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = (level: string, headers: Record<string, string> = { 'accept-encoding': 'gzip, br' }) => {
  const url = new URL(`https://x/api/map/parcel-lines?level=${level}`);
  return { req: new Request(url, { headers }), url };
};

describe('parcel line upload check', () => {
  it('accepts the builder output and rebuilds it field by field', () => {
    const ok = checkParcelLines(set(), 'low');
    expect(typeof ok).toBe('object');
    expect(Object.keys(ok as object).sort()).toEqual(['area', 'built', 'count', 'format', 'level', 'lines', 'origin', 'scale', 'version']);
  });

  it('refuses parcel numbers, properties or any text in the lines', () => {
    expect(checkParcelLines(set({ PARCEL_NO: ['1'] }), 'low')).toMatch(/Unexpected fields/);
    expect(checkParcelLines(set({ properties: { OWNER_NAME: 'X' } }), 'low')).toMatch(/Unexpected fields/);
    expect(checkParcelLines(set({ lines: [[1, 2, 3, 'OWNER']] }), 'low')).toMatch(/integers/);
    expect(checkParcelLines(set({ lines: [[1, 2, 3]] }), 'low')).toMatch(/integers/);
    expect(checkParcelLines(set({ lines: [[1.5, 2, 3, 4]], count: 1 }), 'low')).toMatch(/integers/);
    expect(checkParcelLines(set({ version: 'Jane Doe' }), 'low')).toMatch(/version/);
    expect(checkParcelLines(set({ built: 'owner' }), 'low')).toMatch(/date/);
  });

  it('refuses a level that does not match, a far area and a wrong count', () => {
    expect(checkParcelLines(set(), 'mid')).toMatch(/Level/);
    expect(checkParcelLines(set({ area: [-112.5, 40.2, -112.4, 40.3] }), 'low')).toMatch(/Vineyard/);
    expect(checkParcelLines(set({ count: 5 }), 'low')).toMatch(/Count/);
  });
});

describe('parcel line routes', () => {
  it('stores an upload gzipped under map/ with its version', async () => {
    const { putParcelLines } = await routes();
    const ARCHIVE = bucket();
    const res = await putParcelLines({ ARCHIVE }, put(set()), 'low');
    expect(res.status).toBe(200);
    expect(parcelLinesKey('low')).toBe('map/parcel-lines-low.json.gz');
    const stored = ARCHIVE.store.get('map/parcel-lines-low.json.gz');
    expect(stored?.meta.version).toBe('0123456789abcdef');
    expect(stored?.http.contentEncoding).toBe('gzip');
    expect(JSON.parse(gunzipSync(stored!.bytes).toString()).lines).toHaveLength(2);
  });

  it('refuses unknown levels and bad uploads', async () => {
    const { putParcelLines, getParcelLines } = await routes();
    const ARCHIVE = bucket();
    await expect(putParcelLines({ ARCHIVE }, put(set(), 'high'), 'high')).rejects.toMatchObject({ status: 404 });
    await expect(putParcelLines({ ARCHIVE }, put(set({ OWNER_NAME: 'X' })), 'low')).rejects.toMatchObject({ status: 400 });
    expect(ARCHIVE.store.size).toBe(0);
    for (const level of ['high', '', '../backups', 'LOW']) {
      const { req, url } = get(level);
      await expect(getParcelLines({ ARCHIVE }, req, url)).rejects.toMatchObject({ status: 404 });
    }
    // Not built yet: 404, and the map falls back to the tiles.
    const { req, url } = get('mid');
    await expect(getParcelLines({ ARCHIVE }, req, url)).rejects.toMatchObject({ status: 404 });
  });

  it('serves the stored gzip with long cache headers and a version ETag, and 304 on a match', async () => {
    const { getParcelLines, PARCEL_LINES_CACHE } = await routes();
    const ARCHIVE = bucket();
    await ARCHIVE.put('map/parcel-lines-low.json.gz', new Uint8Array(gzipSync(JSON.stringify(set()))).buffer, { customMetadata: { version: '0123456789abcdef' } });
    const { req, url } = get('low');
    const res = await getParcelLines({ ARCHIVE }, req, url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('cache-control')).toBe(PARCEL_LINES_CACHE);
    expect(PARCEL_LINES_CACHE).toMatch(/max-age=3600/);
    expect(PARCEL_LINES_CACHE).toMatch(/stale-while-revalidate=604800/);
    expect(res.headers.get('etag')).toBe('"pl-low-0123456789abcdef"');
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
    expect(JSON.parse(gunzipSync(new Uint8Array(await res.arrayBuffer())).toString()).version).toBe('0123456789abcdef');

    const again = get('low', { 'accept-encoding': 'gzip', 'if-none-match': '"pl-low-0123456789abcdef"' });
    const nm = await getParcelLines({ ARCHIVE }, again.req, again.url);
    expect(nm.status).toBe(304);

    const plain = get('low', {});
    const unz = await getParcelLines({ ARCHIVE }, plain.req, plain.url);
    expect(unz.headers.get('content-encoding')).toBeNull();
    expect(((await unz.json()) as { count: number }).count).toBe(2);
  });

  it('is in the map catalog for parcels, from zoom 12', () => {
    const parcels = MAP_LAYERS.find((l) => l.key === 'parcels');
    expect(parcels).toMatchObject({ lines: '/api/map/parcel-lines', linesMinZoom: 12, minZoom: 15 });
  });
});

describe('client zoom switching', () => {
  it('draws low lines at 12 and 13, mid at 14 and 15, tiles from 16', () => {
    expect(levelFor(11.9)).toBeNull();
    expect(levelFor(12)).toBe('low');
    expect(levelFor(13.99)).toBe('low');
    expect(levelFor(14)).toBe('mid');
    expect(levelFor(15.9)).toBe('mid');
    expect(levelFor(FULL_ZOOM)).toBeNull();
    expect(levelFor(11.5, 11.5)).toBe('low');
  });

  it('starts the tiles at 16 with lines and at 15 without them', () => {
    expect(tilesMinZoom(true)).toBe(16);
    expect(tilesMinZoom(false)).toBe(15);
  });

  it('looks up a tapped parcel from zoom 14 while lines are drawn', () => {
    expect(tapLooksUpParcel(13.9, true)).toBe(false);
    expect(tapLooksUpParcel(14, true)).toBe(true);
    expect(tapLooksUpParcel(15.5, true)).toBe(true);
    expect(tapLooksUpParcel(16, true)).toBe(false); // the tiles' own shapes take the tap
    expect(tapLooksUpParcel(15, false)).toBe(false);
  });

  it('decodes the stored set to property-free lines', () => {
    const fc = decodeLines(set());
    expect(fc?.features).toHaveLength(1);
    const f = fc!.features[0];
    expect(f.properties).toEqual({});
    expect(f.geometry.coordinates).toHaveLength(2);
    const [first] = f.geometry.coordinates;
    expect(first[0][0]).toBeCloseTo(-111.77294, 6);
    expect(first[0][1]).toBeCloseTo(40.27888, 6);
    expect(first[first.length - 1]).toEqual(first[0]);
    expect(decodeLines({ format: 'other', lines: [] })).toBeNull();
    expect(decodeLines(null)).toBeNull();
  });
});
