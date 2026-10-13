import { describe, expect, it } from 'vitest';
import { centerOf, CLASS_M, heightFor, OMT_UNKNOWN_M, ROOF_M, STORY_M, StoryIndex, tilesAround, UNKNOWN_M, withHeights } from '../src/console/streetview/heights';
import type { Polygon } from 'geojson';

const square = (x: number, y: number, d: number): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });

describe('building heights in 3D', () => {
  it('takes the first record there is: OSM, the parcel floors, its class, then a default', () => {
    expect(heightFor(12, { f: 1, c: 'Residential' })).toBe(12);
    expect(heightFor(OMT_UNKNOWN_M, { f: 2, c: 'Residential' })).toBeCloseTo(2 * STORY_M + ROOF_M, 6);
    expect(heightFor(undefined, { c: 'Tax Exempt' })).toBe(CLASS_M['Tax Exempt']);
    expect(heightFor(OMT_UNKNOWN_M, null)).toBe(UNKNOWN_M);
    expect(heightFor(OMT_UNKNOWN_M, { c: 'Somewhere else' })).toBe(UNKNOWN_M);
  });

  it('finds the parcel under a building and raises it to the recorded floors', () => {
    const index = new StoryIndex();
    index.add({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square(-111.75, 40.3, 0.0004), properties: { f: 3, c: 'Commercial' } }] });
    expect(index.size).toBe(1);
    expect(index.at([-111.7498, 40.3002])).toEqual({ f: 3, c: 'Commercial' });
    expect(index.at([-111.74, 40.3002])).toBeNull();
    const fc = withHeights([{ geometry: square(-111.7499, 40.3001, 0.0001), properties: { render_height: OMT_UNKNOWN_M } }], index);
    expect(fc.features[0].properties.h).toBeCloseTo(3 * STORY_M + ROOF_M, 6);
    expect(centerOf(square(0, 0, 2))).toEqual([1, 1]);
  });

  it('lists the zoom 16 tiles around a point', () => {
    const t = tilesAround([-111.745, 40.305]);
    expect(t).toHaveLength(9);
    expect(t[4]).toEqual([12425, 24737]);
  });
});
