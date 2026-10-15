import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { projectsOf, ringKm2 } from '../src/console/streetview/ground';

const box = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
const fc = (features: Array<[string, number[][]]>): FeatureCollection => ({
  type: 'FeatureCollection',
  features: features.map(([name, ring]) => ({ type: 'Feature', properties: { Project_Name: name }, geometry: { type: 'Polygon', coordinates: [ring] } })),
});

describe('projects as shapes on the street', () => {
  it('measures a ring in square kilometers', () => {
    // About 1 km by 1 km at Vineyard's latitude.
    expect(ringKm2(box(-111.75, 40.3, -111.75 + 1 / 85.0, 40.3 + 1 / 110.54) as Array<[number, number]>)).toBeCloseTo(1, 1);
  });

  it('keeps a park or street project and leaves out one drawn over the whole city', () => {
    const list = projectsOf(fc([
      ['Gammon Park field', box(-111.7517, 40.2955, -111.7484, 40.2970)],
      ['Water Shares Purchase', box(-111.773, 40.278, -111.732, 40.334)],
    ]));
    expect(list.map((p) => p.zone)).toEqual(['Gammon Park field']);
  });
});
