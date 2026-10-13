import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cityParcelAtUrl,
  countyParcelAtUrl,
  countyParcelTileUrl,
  layerQueryUrl,
  MAP_LAYERS,
  parcelCard,
  parcelPoint,
  parcelTileBody,
  parcelTileEnvelope,
  stripFeatures,
} from '../worker/lib/mapLayers';

// Loaded by path at run time: the module uses Worker types this test project does not compile.
const WORKER_MAP = '../worker/api/map';
type Routes = { getParcelOutlines: (z: string, x: string, y: string) => Promise<Response>; getParcelAt: (url: URL) => Promise<Response> };
const routes = async () => (await import(/* @vite-ignore */ WORKER_MAP)) as Routes;
const getParcelOutlines: Routes['getParcelOutlines'] = async (z, x, y) => (await routes()).getParcelOutlines(z, x, y);
const getParcelAt: Routes['getParcelAt'] = async (url) => (await routes()).getParcelAt(url);

const tileOf = (lng: number, lat: number, z: number) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
};

const square = (lng: number, lat: number) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + 0.001, lat], [lng + 0.001, lat + 0.001], [lng, lat + 0.001], [lng, lat]]] });
/** What the county could send back, private fields included. */
const countyFeature = (no: string, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  id: 7,
  geometry: square(-111.74, 40.3),
  properties: { OBJECTID: 7, PARCEL_NO: no, OWNER_NAME: 'PRIVATE PERSON', OWN_FULL_ADDRESS: '1 PRIVATE WAY', VESTING_DOC: '123', ...extra },
});

describe('county parcel outline tiles', () => {
  it('queries layer 2 for one zoom 16 tile with the parcel number only', () => {
    const { x, y } = tileOf(-111.74, 40.3, 16);
    const url = new URL(countyParcelTileUrl(16, x, y) as string);
    expect(url.origin + url.pathname).toBe('https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer/2/query');
    expect(url.searchParams.get('outFields')).toBe('PARCEL_NO');
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryEnvelope');
    expect(url.searchParams.get('spatialRel')).toBe('esriSpatialRelIntersects');
    expect(url.searchParams.get('outSR')).toBe('4326');
    expect(url.searchParams.get('geometryPrecision')).toBe('6');
    expect(url.searchParams.get('f')).toBe('geojson');
    expect(url.searchParams.get('resultOffset')).toBe('0');
    const [w, s, e, n] = (url.searchParams.get('geometry') as string).split(',').map(Number);
    expect(e - w).toBeCloseTo(360 / 2 ** 16, 6);
    expect(w).toBeLessThanOrEqual(-111.74);
    expect(e).toBeGreaterThan(-111.74);
    expect(s).toBeLessThanOrEqual(40.3);
    expect(n).toBeGreaterThan(40.3);
    expect(new URL(countyParcelTileUrl(16, x, y, 1) as string).searchParams.get('resultOffset')).toBe('2000');
    expect(countyParcelTileUrl(16, x, y, 2)).toBeNull();
  });

  it('refuses other zoom levels and tiles away from Vineyard', () => {
    const v = tileOf(-111.74, 40.3, 16);
    const slc = tileOf(-111.89, 40.76, 16);
    expect(parcelTileEnvelope(16, v.x, v.y)).not.toBeNull();
    expect(parcelTileEnvelope(16, slc.x, slc.y)).toBeNull();
    expect(parcelTileEnvelope(15, v.x >> 1, v.y >> 1)).toBeNull();
    expect(parcelTileEnvelope(17, v.x * 2, v.y * 2)).toBeNull();
    expect(parcelTileEnvelope(16, -1, v.y)).toBeNull();
    expect(parcelTileEnvelope(16.5, v.x, v.y)).toBeNull();
  });

  it('strips every field but the parcel number and drops duplicates across pages', () => {
    const body = parcelTileBody([{ features: [countyFeature('12:345:0001'), countyFeature('12:345:0002')] }, { features: [countyFeature('12:345:0002')] }]);
    expect(body.features).toHaveLength(2);
    for (const f of body.features) expect(Object.keys(f.properties)).toEqual(['PARCEL_NO']);
    expect(JSON.stringify(body)).not.toMatch(/OWNER_NAME|OWN_FULL_ADDRESS|PRIVATE|VESTING_DOC|OBJECTID/);
  });
});

describe('parcel card lookup', () => {
  it('asks the county and the city only for allowlisted fields at a point in Vineyard', () => {
    expect(parcelPoint(-111.89, 40.76)).toBeNull();
    expect(parcelPoint(Number.NaN, 40.3)).toBeNull();
    const [lng, lat] = parcelPoint(-111.7412345678, 40.3012345678) as [number, number];
    expect(lng).toBe(-111.741235);
    const county = new URL(countyParcelAtUrl(lng, lat));
    expect(county.searchParams.get('outFields')).toBe('PARCEL_NO,SITE_FULL_ADDRESS,ACREAGE,SUB_NAME,TAX_DISTRICT_DESCR,MKT_CUR_VALUE');
    expect(county.searchParams.get('geometryType')).toBe('esriGeometryPoint');
    const city = new URL(cityParcelAtUrl(lng, lat));
    expect(city.pathname).toContain('VNY_CA_Parcels_2025/FeatureServer/446/query');
    expect(city.searchParams.get('outFields')).toBe('PARCEL_NO,PROP_TYPE_DESCR,GLA_WEIGHTED_YRBLT');
  });

  it('builds the card in order, marks city fields and leaves out private and empty ones', () => {
    const county = { features: [countyFeature('12:345:0001', { SITE_FULL_ADDRESS: '100 N MAIN ST', ACREAGE: 0.21, SUB_NAME: '', TAX_DISTRICT_DESCR: 'VINEYARD', MKT_CUR_VALUE: 512000 })] };
    const city = { features: [{ properties: { PARCEL_NO: '12:345:0001', PROP_TYPE_DESCR: 'Residential', GLA_WEIGHTED_YRBLT: 2019, OWNER_NAME: 'X' } }] };
    const card = parcelCard(county, city);
    expect(card.found).toBe(true);
    expect(Object.keys(card.properties)).toEqual(['SITE_FULL_ADDRESS', 'PARCEL_NO', 'ACREAGE', 'PROP_TYPE_DESCR', 'GLA_WEIGHTED_YRBLT', 'MKT_CUR_VALUE', 'TAX_DISTRICT_DESCR']);
    expect(card.city).toEqual(['PROP_TYPE_DESCR', 'GLA_WEIGHTED_YRBLT']);
    expect(card.geometry).toMatchObject({ type: 'Polygon' });
    expect(JSON.stringify(card)).not.toMatch(/OWNER_NAME|OWN_FULL_ADDRESS|PRIVATE/);
  });

  it('ignores city fields for a different parcel number, and reports no parcel when the county has none', () => {
    const county = { features: [countyFeature('12:345:0009', { SITE_FULL_ADDRESS: '1 A ST' })] };
    const city = { features: [{ properties: { PARCEL_NO: '12:345:0001', PROP_TYPE_DESCR: 'Residential' } }] };
    expect(parcelCard(county, city).city).toEqual([]);
    expect(parcelCard({ features: [] }, city)).toEqual({ found: false, properties: {}, city: [], geometry: null });
  });

  it('stripFeatures never keeps nested or unlisted values', () => {
    const [f] = stripFeatures([{ geometry: null, properties: { PARCEL_NO: { evil: 1 }, OWNER_NAME: 'X' } }], ['PARCEL_NO']);
    expect(f.properties).toEqual({});
  });
});

describe('parcel routes', () => {
  afterEach(() => vi.unstubAllGlobals());
  const v = tileOf(-111.74, 40.3, 16);

  it('serves a tile with only parcel numbers, whatever the county returns', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [countyFeature('1'), countyFeature('2')] })));
    vi.stubGlobal('fetch', fetchMock);
    const res = await getParcelOutlines('16', String(v.x), `${v.y}.json`);
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    const body = (await res.json()) as { features: Array<{ properties: Record<string, unknown> }> };
    expect(body.features.map((f) => f.properties)).toEqual([{ PARCEL_NO: '1' }, { PARCEL_NO: '2' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a second page when the first is full, and no more', async () => {
    const full = Array.from({ length: 2000 }, (_, i) => countyFeature(`p${i}`));
    const fetchMock = vi.fn(async (u: string) => new Response(JSON.stringify({ features: new URL(u).searchParams.get('resultOffset') === '0' ? full : [countyFeature('last')] })));
    vi.stubGlobal('fetch', fetchMock);
    const body = (await (await getParcelOutlines('16', String(v.x), `${v.y}.json`)).json()) as { features: unknown[] };
    expect(body.features).toHaveLength(2001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses other zooms, far tiles and county errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 400 } }))));
    await expect(getParcelOutlines('15', String(v.x), `${v.y}.json`)).rejects.toMatchObject({ status: 404 });
    await expect(getParcelOutlines('16', '0', '0.json')).rejects.toMatchObject({ status: 404 });
    await expect(getParcelOutlines('16', String(v.x), `${v.y}.png`)).rejects.toMatchObject({ status: 404 });
    await expect(getParcelOutlines('16', String(v.x), `${v.y}.json`)).rejects.toMatchObject({ status: 502 });
  });

  it('answers a click with the card shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) =>
        u.includes('utahcounty')
          ? new Response(JSON.stringify({ features: [countyFeature('12:345:0001', { SITE_FULL_ADDRESS: '100 N MAIN ST', ACREAGE: 0.2 })] }))
          : new Response(JSON.stringify({ features: [{ properties: { PARCEL_NO: '12:345:0001', GLA_WEIGHTED_YRBLT: 2001 } }] })),
      ),
    );
    const res = await getParcelAt(new URL('https://x/api/map/parcel?lng=-111.74&lat=40.3'));
    const card = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(card).sort()).toEqual(['city', 'found', 'geometry', 'properties']);
    expect(card.properties).toEqual({ SITE_FULL_ADDRESS: '100 N MAIN ST', PARCEL_NO: '12:345:0001', ACREAGE: 0.2, GLA_WEIGHTED_YRBLT: 2001 });
    expect(card.city).toEqual(['GLA_WEIGHTED_YRBLT']);
    await expect(getParcelAt(new URL('https://x/api/map/parcel?lng=-111.89&lat=40.76'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('map layer catalog', () => {
  it('draws parcels from county tiles, with the city 2025 layer as the fallback', () => {
    const parcels = MAP_LAYERS.find((l) => l.key === 'parcels');
    expect(parcels).toMatchObject({ geometry: 'polygon', path: 'VNY_CA_Parcels_2025/FeatureServer/446', tiles: '/api/map/parcels/{z}/{x}/{y}.json', attribution: 'Parcels: Utah County GIS', minZoom: 15 });
    expect(parcels?.fields).not.toContain('OWNER_NAME');
  });

  it('keeps address lookups to the address field only', () => {
    const url = new URL(layerQueryUrl('parcels', "SITE_FULL_ADDRESS LIKE '1 %'", ['SITE_FULL_ADDRESS', 'OWNER_NAME']) as string);
    expect(url.searchParams.get('outFields')).toBe('SITE_FULL_ADDRESS');
  });
});

describe('map catalog: trails without bike lanes, no URA layer', () => {
  it('has no Geneva URA project area layer', () => {
    expect(MAP_LAYERS.find((l) => l.key === 'ura')).toBeUndefined();
    expect(MAP_LAYERS.some((l) => /URA/.test(l.label) || /Geneva_URA/.test(l.path))).toBe(false);
  });

  it('asks the city for trails only, so bike lanes are never sent', async () => {
    const trails = MAP_LAYERS.find((l) => l.key === 'trails');
    expect(trails?.label).toBe('Trails');
    const { upstreamUrl } = (await import(/* @vite-ignore */ WORKER_MAP)) as { upstreamUrl: (l: unknown, p: number) => string };
    const where = new URL(upstreamUrl(trails, 0)).searchParams.get('where') ?? '';
    expect(where).toContain("NOT LIKE '%BIKE LANE%'");
    // The layer's values (October 2026): "Shared Use Path" kept; "Bike Lane" and "Buffered Bike Lane" dropped.
    const kept = (v: string | null) => v === null || !v.toUpperCase().includes('BIKE LANE');
    expect(['Shared Use Path', 'Bike Lane', 'Buffered Bike Lane', null].map(kept)).toEqual([true, false, false, true]);
  });
});

describe('stories tiles for 3D building heights', () => {
  it('asks UGRC for floors and class only, in one zoom 16 tile near Vineyard', async () => {
    const { storiesTileUrl, LIR_PARCELS } = await import('../worker/lib/mapLayers');
    const u = new URL(storiesTileUrl(16, 12424, 24727) as string);
    expect(u.href.startsWith(LIR_PARCELS)).toBe(true);
    expect(u.searchParams.get('outFields')).toBe('FLOORS_CNT,PROP_CLASS');
    expect(storiesTileUrl(15, 6212, 12363)).toBeNull();
    expect(storiesTileUrl(16, 0, 0)).toBeNull();
  });

  it('keeps the shape, floors and class and drops everything else', async () => {
    const { storiesTileBody } = await import('../worker/lib/mapLayers');
    const g = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const body = storiesTileBody([
      {
        features: [
          { type: 'Feature', geometry: g, properties: { FLOORS_CNT: 2, PROP_CLASS: 'Residential', OWNER_NAME: 'Someone', PARCEL_ID: '1' } },
          { type: 'Feature', geometry: g, properties: { FLOORS_CNT: 0, PROP_CLASS: 'Commercial' } },
          { type: 'Feature', geometry: g, properties: { FLOORS_CNT: null, PROP_CLASS: null } },
        ],
      },
    ]);
    expect(body.features.map((f) => f.properties)).toEqual([{ f: 2, c: 'Residential' }, { c: 'Commercial' }]);
    expect(JSON.stringify(body)).not.toContain('Someone');
  });
});
