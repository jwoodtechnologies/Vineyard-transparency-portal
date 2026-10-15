import { describe, expect, it } from 'vitest';
import { centerOf, CLASS_M, heightFor, mergedBlocks, OMT_UNKNOWN_M, ROOF_M, ROOF_SCALE, STORY_M, StoryIndex, tilesAround, UNKNOWN_M, WALL_SHARE, withHeights } from '../src/console/streetview/heights';
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
    expect(Math.max(...fc.features.map((f) => f.properties.h))).toBeCloseTo(3 * STORY_M + ROOF_M, 6);
    expect(centerOf(square(0, 0, 2))).toEqual([1, 1]);
  });

  it('draws a home as walls and a smaller roof block, once, and a large or recorded building as one box', () => {
    const index = new StoryIndex();
    const home = { geometry: square(-111.7499, 40.3001, 0.0001), properties: { render_height: OMT_UNKNOWN_M } };
    // The same home from two tiles: drawn once.
    const fc = withHeights([home, { ...home }], index);
    expect(fc.features).toHaveLength(2);
    const [walls, roof] = fc.features;
    expect(walls.properties).toMatchObject({ h: UNKNOWN_M * WALL_SHARE, b: 0, r: 0 });
    expect([0, 1, 2, 3]).toContain(walls.properties.k);
    expect(roof.properties.k).toBe(walls.properties.k);
    expect(roof.properties.r).toBe(1);
    expect(roof.properties.b).toBeCloseTo(UNKNOWN_M * WALL_SHARE, 6);
    expect(roof.properties.h).toBe(UNKNOWN_M);
    const w = (g: typeof roof.geometry) => {
      const r = (g as { coordinates: number[][][] }).coordinates[0];
      return Math.max(...r.map((p) => p[0])) - Math.min(...r.map((p) => p[0]));
    };
    expect(w(roof.geometry) / w(walls.geometry)).toBeCloseTo(ROOF_SCALE, 6);
    // A school (large) and a building with a recorded height: one plain box each.
    const big = withHeights([{ geometry: square(-111.75, 40.3, 0.001), properties: {} }], index);
    expect(big.features).toHaveLength(1);
    expect(withHeights([{ geometry: square(-111.7499, 40.3001, 0.0001), properties: { render_height: 12 } }], index).features).toHaveLength(1);
  });

  it('leaves out a block of houses merged into one long shape, keeping the houses and a lone large building', () => {
    const rect = (x: number, y: number, w: number, h: number): Polygon => ({ type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] });
    const houses = [0, 1, 2].map((i) => ({ geometry: rect(-111.75 + i * 0.0003, 40.3, 0.0002, 0.0002), properties: {} }));
    const block = { geometry: rect(-111.7501, 40.29995, 0.0009, 0.0003), properties: {} };
    const school = { geometry: rect(-111.74, 40.3, 0.001, 0.001), properties: {} };
    expect([...mergedBlocks([...houses, block, school])]).toEqual([3]);
    const fc = withHeights([...houses, block, school], new StoryIndex());
    // Three homes (walls and roof each) and the school; no block.
    expect(fc.features).toHaveLength(7);
  });

  it('lists the zoom 16 tiles around a point', () => {
    const t = tilesAround([-111.745, 40.305]);
    expect(t).toHaveLength(9);
    expect(t[4]).toEqual([12425, 24737]);
  });
});
