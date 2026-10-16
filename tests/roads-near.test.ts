import { describe, expect, it } from 'vitest';
import { nearestRoad, nearestRoadPoint } from '../src/console/scene/roadsNear';

describe('nearest road point', () => {
  const roads = [{ coords: [[-111.75, 40.3], [-111.74, 40.3]] as Array<[number, number]> }];
  it('drops a point onto the road within reach and says when none is near', () => {
    const q = nearestRoadPoint(roads, [-111.745, 40.3002], 40)!;
    expect(q).not.toBeNull();
    expect(q[1]).toBeCloseTo(40.3, 6);
    expect(q[0]).toBeCloseTo(-111.745, 6);
    expect(nearestRoadPoint(roads, [-111.745, 40.301], 40)).toBeNull();
    // Past the end of the road the nearest point is its end.
    expect(nearestRoadPoint(roads, [-111.7399, 40.3], 40)![0]).toBeCloseTo(-111.74, 6);
    expect(nearestRoad(roads, [-111.745, 40.3002], 40)!.d).toBeCloseTo(22.1, 0);
  });
});
