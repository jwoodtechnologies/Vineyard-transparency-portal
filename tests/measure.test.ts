import { describe, expect, it } from 'vitest';
import { bearing, circleRing, distance, geometryArea, pathLength, polygonArea, type Pos } from '../src/console/measure/geo';
import { decodeShape, emptyState, encodeShape, reduce, type Shape } from '../src/console/measure/shape';
import { fmtArea, fmtBearing, fmtDuration, fmtLength } from '../src/console/measure/units';
import { copyText, summarize, toGeoJson } from '../src/console/measure/summary';

// Utah County parcel 468440001 as the county serves it (diagnostics run 38354589772); recorded ACREAGE 11.994316.
const PARCEL: Pos[] = [
  [-111.7403497, 40.3003081],
  [-111.7384018, 40.2977477],
  [-111.7382261, 40.2978259],
  [-111.7370389, 40.2982225],
  [-111.7370855, 40.2982907],
  [-111.7371292, 40.2983607],
  [-111.7371701, 40.2984325],
  [-111.7371838, 40.2984617],
  [-111.7371936, 40.2984923],
  [-111.7372469, 40.2987023],
  [-111.7372518, 40.2987186],
  [-111.7372852, 40.2988237],
  [-111.7373117, 40.2989307],
  [-111.7373313, 40.2990392],
  [-111.7373438, 40.2991488],
  [-111.7373493, 40.2992589],
  [-111.7373669, 40.3003368],
  [-111.7403497, 40.3003081],
];

// Reference values from GeographicLib on the WGS84 ellipsoid.
describe('geodesic math', () => {
  it('matches the ellipsoid for east-west, north-south and diagonal lines', () => {
    expect(distance([-111.75, 40.3], [-111.74, 40.3])).toBeCloseTo(850.1898, 2);
    expect(distance([-111.75, 40.3], [-111.75, 40.31])).toBeCloseTo(1110.405, 2);
    expect(distance([-111.76, 40.29], [-111.71, 40.33]) / 6147.6222).toBeCloseTo(1, 5);
    expect(distance([-111.75, 40.3], [-111.75, 40.30001])).toBeCloseTo(1.1104, 3);
    expect(distance([-111.75, 40.3], [-111.75, 40.3])).toBe(0);
  });

  it('gives bearings clockwise from north', () => {
    expect(bearing([-111.75, 40.3], [-111.75, 40.31])).toBeCloseTo(0, 6);
    expect(bearing([-111.75, 40.3], [-111.74, 40.3])).toBeCloseTo(90, 6);
    expect(bearing([-111.76, 40.29], [-111.71, 40.33])).toBeCloseTo(43.723, 1);
    expect(bearing([-111.74, 40.3], [-111.75, 40.3])).toBeCloseTo(270, 6);
  });

  it('measures a square of 0.01 degrees: area and perimeter', () => {
    const sq: Pos[] = [
      [-111.75, 40.3],
      [-111.74, 40.3],
      [-111.74, 40.31],
      [-111.75, 40.31],
    ];
    expect(polygonArea(sq) / 943985.42).toBeCloseTo(1, 5);
    expect(polygonArea([...sq, sq[0]])).toBeCloseTo(polygonArea(sq), 6);
    expect(polygonArea([...sq].reverse())).toBeCloseTo(polygonArea(sq), 6);
    expect(pathLength(sq, true)).toBeCloseTo(3921.064, 1);
  });

  it('measures a real parcel within 0.1 percent of the county recorded acreage', () => {
    const acres = polygonArea(PARCEL) / 4046.8564224;
    expect(acres).toBeCloseTo(11.9969, 3); // GeographicLib: 11.99691
    expect(Math.abs(acres - 11.994316) / 11.994316).toBeLessThan(0.001);
    expect(geometryArea({ type: 'Polygon', coordinates: [PARCEL] })).toBeCloseTo(polygonArea(PARCEL), 6);
  });

  it('takes holes out of an area', () => {
    const outer: Pos[] = [
      [-111.75, 40.3],
      [-111.74, 40.3],
      [-111.74, 40.31],
      [-111.75, 40.31],
      [-111.75, 40.3],
    ];
    const hole: Pos[] = [
      [-111.748, 40.302],
      [-111.746, 40.302],
      [-111.746, 40.304],
      [-111.748, 40.304],
      [-111.748, 40.302],
    ];
    expect(geometryArea({ type: 'Polygon', coordinates: [outer, hole] })).toBeCloseTo(polygonArea(outer) - polygonArea(hole), 3);
  });

  it('draws a circle whose points all sit at the radius', () => {
    const ring = circleRing([-111.745, 40.305], 250);
    for (const p of ring) expect(distance([-111.745, 40.305], p)).toBeCloseTo(250, 2);
    expect(polygonArea(ring) / (Math.PI * 250 * 250)).toBeCloseTo(1, 2);
  });
});

describe('units', () => {
  it('writes lengths, areas, bearings and times', () => {
    expect(fmtLength(100, 'imperial')).toBe('328 ft');
    expect(fmtLength(1609.344 * 1.5, 'imperial')).toBe('1.50 mi');
    expect(fmtLength(250, 'metric')).toBe('250 m');
    expect(fmtLength(2500, 'metric')).toBe('2.50 km');
    expect(fmtArea(4046.8564224, 'acres')).toBe('1.00 acre');
    expect(fmtArea(4046.8564224, 'sqft')).toBe('43,560 sq ft');
    expect(fmtArea(10000, 'ha')).toBe('1.00 ha');
    expect(fmtBearing(44.6)).toBe('45° NE');
    expect(fmtBearing(359.8)).toBe('0° N');
    expect(fmtDuration(65 * 60)).toBe('1 hr 5 min');
  });
});

describe('the ?m= link', () => {
  const shapes: Shape[] = [
    {
      mode: 'distance',
      pts: [
        [-111.745123, 40.305456],
        [-111.74, 40.31],
        [-111.738, 40.299],
      ],
      closed: false,
    },
    {
      mode: 'distance',
      pts: [
        [-111.745, 40.305],
        [-111.74, 40.31],
        [-111.738, 40.299],
      ],
      closed: true,
    },
    {
      mode: 'area',
      pts: PARCEL.slice(0, -1).map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6] as Pos),
      closed: false,
    },
    {
      mode: 'circle',
      pts: [
        [-111.745, 40.305],
        [-111.744, 40.3055],
      ],
      closed: false,
    },
    { mode: 'parcel', pts: [[-111.7387, 40.2989]], closed: false },
  ];

  it('reopens every kind of shape exactly', () => {
    for (const s of shapes) {
      const v = encodeShape(s);
      expect(v).toMatch(/^[dacp]l?:/);
      // Through a real URL, as Copy link makes it.
      const u = new URL('https://vineyardportal.org/map');
      u.searchParams.set('m', v);
      expect(decodeShape(new URL(u.toString()).searchParams.get('m'))).toEqual(s);
    }
  });

  it('refuses links it did not write or that point far from Vineyard', () => {
    expect(decodeShape('x:abc')).toBeNull();
    expect(decodeShape('d:')).toBeNull();
    expect(decodeShape('d:\u0001')).toBeNull();
    expect(
      decodeShape(
        'al:' +
          encodeShape({
            mode: 'area',
            pts: [[-111.7, 40.3]],
            closed: false,
          }).slice(2),
      ),
    ).toBeNull();
    expect(
      decodeShape(
        encodeShape({
          mode: 'distance',
          pts: [
            [-74.0, 40.7],
            [-74.1, 40.7],
          ],
          closed: false,
        }),
      ),
    ).toBeNull();
    expect(decodeShape(encodeShape({ mode: 'circle', pts: [[-111.7, 40.3]], closed: false }))).toBeNull();
  });
});

describe('editing', () => {
  it('adds, moves, inserts, closes, undoes and clears', () => {
    let s = emptyState('distance');
    s = reduce(s, { type: 'add', at: [0, 0] });
    s = reduce(s, { type: 'add', at: [1, 0] });
    s = reduce(s, { type: 'add', at: [1, 1] });
    s = reduce(s, { type: 'insert', after: 0, at: [0.5, 0] });
    expect(s.pts).toEqual([
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 1],
    ]);
    s = reduce(s, { type: 'move', index: 3, at: [2, 2] });
    s = reduce(s, { type: 'close' });
    expect(s.closed).toBe(true);
    s = reduce(s, { type: 'undo' });
    expect(s.closed).toBe(false);
    s = reduce(s, { type: 'undo' });
    expect(s.pts[3]).toEqual([1, 1]);
    s = reduce(s, { type: 'clear' });
    expect(s.pts).toEqual([]);
    s = reduce(s, { type: 'undo' });
    expect(s.pts).toHaveLength(4);
  });

  it('a circle keeps a center and one edge point; finishing stops new points', () => {
    let c = emptyState('circle');
    c = reduce(c, { type: 'add', at: [0, 0] });
    c = reduce(c, { type: 'add', at: [1, 0] });
    c = reduce(c, { type: 'add', at: [2, 0] });
    expect(c.pts).toEqual([
      [0, 0],
      [2, 0],
    ]);
    let d = reduce(reduce(emptyState('distance'), { type: 'add', at: [0, 0] }), { type: 'finish' });
    d = reduce(d, { type: 'add', at: [1, 1] });
    expect(d.pts).toHaveLength(1);
  });
});

describe('summary', () => {
  it('copies the numbers as plain text and exports GeoJSON', () => {
    const s: Shape = {
      mode: 'area',
      pts: [
        [-111.75, 40.3],
        [-111.74, 40.3],
        [-111.74, 40.31],
        [-111.75, 40.31],
      ],
      closed: false,
    };
    const sum = summarize(s);
    const text = copyText(sum, { system: 'imperial', area: 'acres' }, null, 'https://vineyardportal.org/map?m=x');
    expect(text).toContain('Acres: 233');
    expect(text).toContain('Perimeter: 2.44 mi');
    expect(text).toContain('Not a survey.');
    expect(text).not.toMatch(/[\u2013\u2014]/);
    const gj = toGeoJson(s, sum, null) as {
      features: Array<{
        geometry: { type: string; coordinates: Pos[][] };
        properties: Record<string, number>;
      }>;
    };
    expect(gj.features[0].geometry.type).toBe('Polygon');
    expect(gj.features[0].geometry.coordinates[0]).toHaveLength(5);
    expect(gj.features[0].properties.area_acres).toBeCloseTo(233.26, 1);
  });
});
