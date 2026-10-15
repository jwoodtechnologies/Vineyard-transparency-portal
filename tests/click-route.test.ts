import { describe, expect, it } from 'vitest';
import { featureAt } from '../src/console/streetview/clickRoute';

describe('feature under a ground point', () => {
  const square = (x: number, y: number, s: number) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] as Array<[number, number]>;
  const zone = { layer: 'zoning', name: 'R-1-10', rings: [square(0, 0, 10)] };
  const small = { layer: 'zoning', name: 'C-2', rings: [square(2, 2, 2)] };
  const project = { layer: 'projects', name: 'Main Street', rings: [square(1, 1, 8)] };

  const citywide = { layer: 'projects', name: 'Water Shares Purchase', rings: [square(-50, -50, 100)] };

  it('picks a project over the zone around it, else the smallest zone; a city wide project never hides the zones', () => {
    expect(featureAt([zone, small, project], [6, 6])?.name).toBe('Main Street');
    expect(featureAt([zone, small, project], [3, 3])?.name).toBe('C-2');
    expect(featureAt([zone, small, citywide], [8, 8])?.name).toBe('R-1-10');
    expect(featureAt([citywide], [30, 30])?.name).toBe('Water Shares Purchase');
    expect(featureAt([zone, small], [3, 3])?.name).toBe('C-2');
    expect(featureAt([zone, small], [8, 8])?.name).toBe('R-1-10');
    expect(featureAt([zone], [20, 20])).toBeNull();
  });
});
