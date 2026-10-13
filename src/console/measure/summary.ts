/**
 * What a measurement comes to, for the readout, the screen reader announcement, the copied text and the
 * GeoJSON export: one summary computed from the shape, written in the chosen units.
 */
import { bearing, circleRing, distance, pathLength, polygonArea, type Pos } from './geo';
import type { Mode, Shape } from './shape';
import { acresOf, AREA_LABEL, areaUnitsFor, BIKE_MPS, fmtArea, fmtBearing, fmtDuration, fmtLength, WALK_MPS, type Units } from './units';

export interface Segment {
  from: Pos;
  to: Pos;
  meters: number;
  bearing: number;
}

/** The parcel a Parcel measurement landed on (from /api/map/parcel). */
export interface ParcelInfo {
  number: string | null;
  address: string | null;
  /** The county's recorded acreage, when the record has one. */
  recordedAcres: number | null;
  ring: Pos[] | null;
  area: number;
}

export interface Summary {
  mode: Mode;
  /** Path length, perimeter or circumference, in meters. */
  length: number;
  /** Square meters (areas, circles and parcels). */
  area: number;
  radius: number;
  segments: Segment[];
  /** The outline drawn on the map. */
  ring: Pos[] | null;
}

export function segmentsOf(pts: Pos[], closed: boolean): Segment[] {
  const out: Segment[] = [];
  const list = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
  for (let i = 1; i < list.length; i++)
    out.push({
      from: list[i - 1],
      to: list[i],
      meters: distance(list[i - 1], list[i]),
      bearing: bearing(list[i - 1], list[i]),
    });
  return out;
}

export function summarize(s: Shape, parcel: ParcelInfo | null = null): Summary {
  const base: Summary = {
    mode: s.mode,
    length: 0,
    area: 0,
    radius: 0,
    segments: [],
    ring: null,
  };
  switch (s.mode) {
    case 'distance': {
      const segments = segmentsOf(s.pts, s.closed);
      return { ...base, segments, length: pathLength(s.pts, s.closed) };
    }
    case 'area': {
      const segments = s.pts.length > 2 ? segmentsOf(s.pts, true) : segmentsOf(s.pts, false);
      return {
        ...base,
        segments,
        length: segments.reduce((t, x) => t + x.meters, 0),
        area: s.pts.length > 2 ? polygonArea(s.pts) : 0,
        ring: s.pts.length > 2 ? [...s.pts, s.pts[0]] : null,
      };
    }
    case 'circle': {
      if (s.pts.length < 2) return base;
      const r = distance(s.pts[0], s.pts[1]);
      return {
        ...base,
        radius: r,
        length: 2 * Math.PI * r,
        area: Math.PI * r * r,
        ring: circleRing(s.pts[0], r),
      };
    }
    case 'parcel':
      if (!parcel?.ring) return base;
      return {
        ...base,
        area: parcel.area,
        length: pathLength(parcel.ring),
        ring: parcel.ring,
      };
  }
}

/** One line per number, as shown, for Copy numbers and the screen reader. */
export function summaryLines(sum: Summary, u: Units, parcel: ParcelInfo | null = null): string[] {
  const L = (m: number) => fmtLength(m, u.system);
  const areas = () => areaUnitsFor(u).map((a) => `${AREA_LABEL[a]}: ${fmtArea(sum.area, a)}`);
  switch (sum.mode) {
    case 'distance': {
      if (!sum.segments.length) return [];
      const lines = [`Total distance: ${L(sum.length)}`, `Walking: ${fmtDuration(sum.length / WALK_MPS)}`, `Biking: ${fmtDuration(sum.length / BIKE_MPS)}`];
      if (sum.segments.length > 1) sum.segments.forEach((x, i) => lines.push(`Segment ${i + 1}: ${L(x.meters)}, bearing ${fmtBearing(x.bearing)}`));
      else lines.push(`Bearing: ${fmtBearing(sum.segments[0].bearing)}`);
      return lines;
    }
    case 'area':
      return sum.area ? [...areas(), `Perimeter: ${L(sum.length)}`] : [];
    case 'circle':
      return sum.radius ? [`Radius: ${L(sum.radius)}`, `Diameter: ${L(sum.radius * 2)}`, ...areas(), `Circumference: ${L(sum.length)}`] : [];
    case 'parcel': {
      if (!parcel) return [];
      const lines = [parcel.address ? `Address: ${parcel.address}` : null, parcel.number ? `Parcel number: ${parcel.number}` : null].filter((x): x is string => Boolean(x));
      if (!sum.area) return lines;
      lines.push(`Area from the map shape: ${fmtArea(sum.area, 'acres')}`);
      if (parcel.recordedAcres) {
        const diff = acresOf(sum.area) - parcel.recordedAcres;
        lines.push(
          `County recorded acreage: ${fmtArea(parcel.recordedAcres * 4046.8564224, 'acres')}`,
          `Difference: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} acres (${((diff / parcel.recordedAcres) * 100).toFixed(1)}%)`,
        );
      }
      lines.push(`Perimeter: ${L(sum.length)}`);
      return lines;
    }
  }
}

export const ACCURACY = 'Measured on the map, for planning only. Not a survey.';

/** The text Copy numbers puts on the clipboard. */
export function copyText(sum: Summary, u: Units, parcel: ParcelInfo | null, link: string): string {
  const title = {
    distance: 'Distance',
    area: 'Area',
    circle: 'Circle',
    parcel: 'Parcel',
  }[sum.mode];
  return [`${title} measured on vineyardportal.org`, ...summaryLines(sum, u, parcel), ACCURACY, link].join('\n');
}

/** The measurement as a GeoJSON FeatureCollection (WGS84, lengths in meters and areas in square meters). */
export function toGeoJson(s: Shape, sum: Summary, parcel: ParcelInfo | null): object {
  const props: Record<string, unknown> = { mode: s.mode, note: ACCURACY };
  let geometry: object | null = null;
  if (s.mode === 'distance' && s.pts.length > 1) {
    geometry = {
      type: 'LineString',
      coordinates: s.closed ? [...s.pts, s.pts[0]] : s.pts,
    };
    Object.assign(props, {
      length_m: round(sum.length),
      segments_m: sum.segments.map((x) => round(x.meters)),
      bearings_deg: sum.segments.map((x) => round(x.bearing, 1)),
    });
  } else if (sum.ring) {
    geometry = { type: 'Polygon', coordinates: [sum.ring] };
    Object.assign(props, {
      area_m2: round(sum.area),
      area_acres: round(acresOf(sum.area), 4),
      perimeter_m: round(sum.length),
    });
    if (s.mode === 'circle') Object.assign(props, { center: s.pts[0], radius_m: round(sum.radius) });
    if (s.mode === 'parcel' && parcel)
      Object.assign(props, {
        parcel_number: parcel.number,
        address: parcel.address,
        county_recorded_acres: parcel.recordedAcres,
      });
  }
  return {
    type: 'FeatureCollection',
    features: geometry ? [{ type: 'Feature', geometry, properties: props }] : [],
  };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
