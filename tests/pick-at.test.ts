import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { metersPerPx, pickAt } from '../src/console/pickAt';

const fc = (features: FeatureCollection['features']): FeatureCollection => ({ type: 'FeatureCollection', features });
const sq = (w: number, s: number, d: number) => [[[w, s], [w + d, s], [w + d, s + d], [w, s + d], [w, s]]];

describe('the map feature at a ground point (Drive mode taps)', () => {
  const zoning = { key: 'zoning', fc: fc([{ type: 'Feature', properties: { ZONE: 'R-1-10' }, geometry: { type: 'Polygon', coordinates: sq(-111.75, 40.29, 0.01) } }]) };
  const park = { key: 'parks', fc: fc([{ type: 'Feature', properties: { NAME: 'Gammon Park' }, geometry: { type: 'Polygon', coordinates: sq(-111.745, 40.295, 0.001) } }]) };
  const road = { key: 'udot', fc: fc([{ type: 'Feature', properties: { pin_desc: 'Geneva Road' }, geometry: { type: 'LineString', coordinates: [[-111.75, 40.2952], [-111.74, 40.2952]] } }]) };
  const school = { key: 'schools', fc: fc([{ type: 'Feature', properties: { Name: 'Vineyard Elementary' }, geometry: { type: 'Point', coordinates: [-111.7445, 40.2955] } }]) };

  it('takes a point near the tap first, then a line, then the smallest shape', () => {
    expect(pickAt([zoning, park, road, school], [-111.7445, 40.29552], 20)?.key).toBe('schools');
    expect(pickAt([zoning, park, road], [-111.7446, 40.29521], 20)?.key).toBe('udot');
    expect(pickAt([zoning, park], [-111.7446, 40.2957], 20)?.feature.properties?.NAME).toBe('Gammon Park');
    expect(pickAt([zoning], [-111.7446, 40.2957], 20)?.key).toBe('zoning');
  });

  it('finds nothing outside every shape and far from points and lines', () => {
    expect(pickAt([zoning, road, school], [-111.70, 40.25], 20)).toBeNull();
  });

  it('scales nearness with the zoom', () => {
    expect(metersPerPx(40.3, 20)).toBeCloseTo(0.0569, 3);
    expect(metersPerPx(40.3, 12) / metersPerPx(40.3, 20)).toBeCloseTo(256);
  });
});
