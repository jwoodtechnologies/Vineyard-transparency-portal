import { describe, expect, it } from 'vitest';
import { COUNTY_PARCEL_LINE_LAYER, layerQueryUrl, MAP_LAYERS, parcelTileUrl } from '../worker/lib/mapLayers';

const tileOf = (lng: number, lat: number, z: number) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
};

describe('county parcel tiles', () => {
  it('asks only for the boundary line layer, as an image', () => {
    const { x, y } = tileOf(-111.74, 40.3, 16);
    const url = new URL(parcelTileUrl(16, x, y) as string);
    expect(url.origin + url.pathname).toBe('https://maps200.utahcounty.gov/arcgis/rest/services/Parcels/Parcel_TaxParcelPUMA/MapServer/export');
    expect(url.searchParams.get('layers')).toBe(`show:${COUNTY_PARCEL_LINE_LAYER}`);
    expect(url.searchParams.get('f')).toBe('image');
    expect(url.searchParams.get('transparent')).toBe('true');
    expect(url.searchParams.has('outFields')).toBe(false);
    const [w, s, e, n] = (url.searchParams.get('bbox') as string).split(',').map(Number);
    expect(e - w).toBeCloseTo(n - s, 1);
    expect(e - w).toBeCloseTo((2 * 20037508.342789244) / 2 ** 16, 1);
  });

  it('refuses tiles outside Vineyard or the zoom range', () => {
    const v = tileOf(-111.74, 40.3, 16);
    const slc = tileOf(-111.89, 40.76, 16);
    expect(parcelTileUrl(16, v.x, v.y)).not.toBeNull();
    expect(parcelTileUrl(16, slc.x, slc.y)).toBeNull();
    expect(parcelTileUrl(10, 0, 0)).toBeNull();
    expect(parcelTileUrl(21, v.x * 32, v.y * 32)).toBeNull();
    expect(parcelTileUrl(16, -1, v.y)).toBeNull();
    expect(parcelTileUrl(16.5, v.x, v.y)).toBeNull();
  });
});

describe('map layer catalog', () => {
  it('serves parcels as raster tiles with no fields', () => {
    const parcels = MAP_LAYERS.find((l) => l.key === 'parcels');
    expect(parcels).toMatchObject({ geometry: 'raster', fields: [], label: 'Parcels (Utah County)', tiles: '/api/map/tiles/parcels/{z}/{x}/{y}.png', attribution: 'Parcels: Utah County GIS', minZoom: 15 });
  });

  it('keeps address lookups to the address field only', () => {
    const url = new URL(layerQueryUrl('parcels', "SITE_FULL_ADDRESS LIKE '1 %'", ['SITE_FULL_ADDRESS', 'OWNER_NAME']) as string);
    expect(url.searchParams.get('outFields')).toBe('SITE_FULL_ADDRESS');
  });
});
