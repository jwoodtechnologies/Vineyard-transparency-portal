import { describe, expect, it } from 'vitest';
import { bearing, destination, distance } from '../src/console/measure/geo';
import { Car } from '../src/console/drive/sim';
import { buildGraph, canDrive, clipToTile, cruiseSpeed, laneOffset, legCoords, nearestEdge, offsetLine, turnOptions, type Pos, type Seg } from '../src/console/drive/graph';

// A plus shaped crossing 100 m on each side, at Center Street and Main Street in Vineyard.
const C: Pos = [-111.7455, 40.3035];
const N = destination(C, 0, 100),
  S = destination(C, 180, 100),
  E = destination(C, 90, 100),
  W = destination(C, 270, 100);
const seg = (coords: Pos[], cls = 'minor', oneway: 0 | 1 | -1 = 0): Seg => ({ coords, cls, oneway });

describe('drive route graph', () => {
  it('joins the roads at the crossing and splits them there', () => {
    const g = buildGraph([seg([S, C, N]), seg([W, C, E])]);
    expect(g.edges).toHaveLength(4);
    const center = g.nodes.findIndex((p) => distance(p, C) < 1);
    expect(g.at[center]).toHaveLength(4);
  });

  it('offers left, straight and right at a four way crossing, by the way the car arrives', () => {
    const g = buildGraph([seg([S, C, N]), seg([W, C, E])]);
    // Driving north from S toward C.
    const fromSouth = g.edges.find((e) => distance(e.coords[0], S) < 1 || distance(e.coords[e.coords.length - 1], S) < 1)!;
    const leg = { edge: fromSouth.id, forward: distance(fromSouth.coords[0], S) < 1 };
    const t = turnOptions(g, leg);
    const end = (l: { edge: number; forward: boolean } | null) => (l ? legCoords(g, l).at(-1)! : null);
    expect(distance(end(t.straight)!, N)).toBeLessThan(1);
    expect(distance(end(t.left)!, W)).toBeLessThan(1);
    expect(distance(end(t.right)!, E)).toBeLessThan(1);
    expect(t.auto).toEqual(t.straight);
    expect(t.deadEnd).toBe(false);
  });

  it('keeps one way roads one way: no turn into one against its direction', () => {
    // East of the crossing is one way toward the crossing (east to west), so a car cannot turn right onto it.
    const g = buildGraph([seg([S, C, N]), seg([W, C]), seg([E, C], 'minor', 1)]);
    const fromSouth = g.edges.find((e) => distance(e.coords[0], S) < 1)!;
    const t = turnOptions(g, { edge: fromSouth.id, forward: true });
    expect(t.right).toBeNull();
    expect(t.left).not.toBeNull();
    const east = g.edges.find((e) => e.oneway === 1)!;
    expect(canDrive(east, true)).toBe(true);
    expect(canDrive(east, false)).toBe(false);
    expect(laneOffset(east)).toBe(0);
  });

  it('turns around at a dead end', () => {
    const g = buildGraph([seg([S, C])]);
    const t = turnOptions(g, { edge: 0, forward: true });
    expect(t.deadEnd).toBe(true);
    expect(t.auto).toEqual({ edge: 0, forward: false });
    expect(t.left ?? t.straight ?? t.right).toBeNull();
  });

  it('follows the road with no choice when it bends', () => {
    const bend = destination(destination(C, 0, 60), 60, 80);
    const g = buildGraph([seg([S, C]), seg([C, destination(C, 0, 60), bend])]);
    const t = turnOptions(g, { edge: g.edges.findIndex((e) => distance(e.coords[0], S) < 1), forward: true });
    expect(t.deadEnd).toBe(false);
    expect(distance(legCoords(g, t.auto).at(-1)!, bend)).toBeLessThan(1);
  });

  it('drives half a lane right of the center line on two way roads, both directions', () => {
    const g = buildGraph([seg([S, N])]);
    const e = g.edges[0];
    expect(laneOffset(e)).toBe(1.6);
    expect(laneOffset({ ...e, cls: 'secondary' })).toBe(1.8);
    const north = offsetLine([S, N], laneOffset(e));
    const south = offsetLine([N, S], laneOffset(e));
    // Northbound keeps to the east side, southbound to the west, 1.6 m from the center each.
    expect(north[0][0]).toBeGreaterThan(S[0]);
    expect(south[0][0]).toBeLessThan(N[0]);
    expect(distance(north[0], S)).toBeCloseTo(1.6, 1);
    expect(distance(north[0], [south[1][0], south[1][1]])).toBeCloseTo(3.2, 1);
    expect(Math.abs(bearing(north[0], north[1]))).toBeLessThan(1);
  });

  it('sets a steady 25 to 35 mph by road class', () => {
    expect(cruiseSpeed('minor') / 0.44704).toBeCloseTo(25);
    expect(cruiseSpeed('tertiary') / 0.44704).toBeCloseTo(30);
    expect(cruiseSpeed('primary') / 0.44704).toBeCloseTo(35);
    expect(cruiseSpeed('minor', 'slow')).toBeLessThan(cruiseSpeed('minor'));
    expect(cruiseSpeed('minor', 'fast')).toBeGreaterThan(cruiseSpeed('minor'));
  });

  it('cuts lines at tile edges so pieces from next door tiles meet end to end', () => {
    expect(clipToTile([[-50, 100], [200, 100]], 4096)).toEqual([[[0, 100], [200, 100]]]);
    expect(clipToTile([[100, 100], [5000, 100], [5000, 300], [100, 300]], 4096)).toEqual([
      [[100, 100], [4096, 100]],
      [[4096, 300], [100, 300]],
    ]);
    expect(clipToTile([[-10, -10], [-5, -20]], 4096)).toEqual([]);
  });

  it('finds the road nearest a tap', () => {
    const g = buildGraph([seg([S, N]), seg([W, E])]);
    const tap = destination(destination(C, 0, 40), 90, 8);
    const hit = nearestEdge(g, tap)!;
    expect(hit.d).toBeCloseTo(8, 0);
    expect(nearestEdge(g, destination(C, 45, 200), 30)).toBeNull();
  });
});

describe('drive simulation', () => {
  const run = (car: Car, seconds: number, each?: (c: Car) => void) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      car.step(1 / 60);
      each?.(car);
    }
  };
  const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  it('turns right at the crossing when asked, keeping to the right lane', () => {
    const g = buildGraph([seg([S, C, N]), seg([W, C, E])]);
    const start = g.edges.findIndex((e) => distance(e.coords[0], S) < 1);
    const car = new Car(g, { edge: start, forward: true });
    car.choice = 'right';
    // Until it is halfway to the east end.
    for (let t = 0; t < 60 && car.pose().at[0] < (C[0] + E[0]) / 2; t += 1 / 60) car.step(1 / 60);
    const { at, heading } = car.pose();
    expect(angle(heading, 90)).toBeLessThan(15);
    // East of the crossing and south of the road's center line (the right side heading east).
    expect(at[0]).toBeGreaterThan(C[0]);
    expect(at[1]).toBeLessThan(C[1]);
  });

  it('turns around at a dead end and comes back on the other side of the road', () => {
    const g = buildGraph([seg([S, C])]);
    const car = new Car(g, { edge: 0, forward: true });
    // Up to the end, round, and back to halfway.
    let turned = false;
    for (let t = 0; t < 60; t += 1 / 60) {
      car.step(1 / 60);
      if (distance(car.pose().at, C) < 3) turned = true;
      if (turned && distance(car.pose().at, C) > 50) break;
    }
    const { at, heading } = car.pose();
    expect(angle(heading, 180)).toBeLessThan(15);
    expect(at[0]).toBeLessThan(C[0]); // southbound keeps to the west side
  });

  it('holds a steady 25 mph on a minor road and slows for a right angle turn', () => {
    const g = buildGraph([seg([S, C]), seg([C, E])]);
    const car = new Car(g, { edge: g.edges.findIndex((e) => distance(e.coords[0], S) < 1), forward: true });
    let top = 0;
    let atTurn = Infinity;
    run(car, 25, (c) => {
      top = Math.max(top, c.v);
      if (distance(c.pose().at, C) < 6) atTurn = Math.min(atTurn, c.v);
    });
    expect(top).toBeLessThanOrEqual(cruiseSpeed('minor') + 1e-6);
    expect(top).toBeGreaterThan(cruiseSpeed('minor') * 0.95);
    expect(atTurn).toBeLessThan(top * 0.7);
  });

  it('stops and goes', () => {
    const g = buildGraph([seg([S, N])]);
    const car = new Car(g, { edge: 0, forward: true });
    run(car, 5);
    car.stopped = true;
    run(car, 6);
    expect(car.v).toBe(0);
    car.stopped = false;
    run(car, 1);
    expect(car.v).toBeGreaterThan(0);
  });
});

describe('junctions the tiles left out', () => {
  it('joins two straight roads that cross with no shared point', () => {
    const g = buildGraph([seg([S, N]), seg([W, E])]);
    const center = g.nodes.findIndex((p) => distance(p, C) < 1);
    expect(center).toBeGreaterThanOrEqual(0);
    expect(g.at[center]).toHaveLength(4);
  });

  it('joins a road that ends just short of another (a T junction) and leaves bridges alone', () => {
    const short = destination(C, 270, 1); // stops a meter short of the north south road
    const g = buildGraph([seg([S, N]), seg([W, short])]);
    const t = g.nodes.findIndex((p) => distance(p, C) < 1.2);
    expect(g.at[t]).toHaveLength(3);
    const bridged = buildGraph([seg([S, N]), { ...seg([W, E]), brunnel: 'bridge' }]);
    expect(bridged.edges).toHaveLength(2);
  });
});
