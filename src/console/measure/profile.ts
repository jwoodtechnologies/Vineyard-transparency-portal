/**
 * Elevation along a distance line, from GET /api/map/elevation (the USGS point service through the
 * portal, at most 50 points): samples spaced evenly along the line, then gain, loss, low and high point.
 */
import { along, pathLength, type Pos } from './geo';

export const MAX_SAMPLES = 50;

export interface ProfilePoint {
  /** Meters from the start of the line. */
  at: number;
  /** Meters above sea level. */
  elevation: number;
  pos: Pos;
}

export interface Profile {
  points: ProfilePoint[];
  gain: number;
  loss: number;
  low: ProfilePoint;
  high: ProfilePoint;
  length: number;
}

/** Evenly spaced samples: about one every 20 meters, at least 2 and at most 50. */
export function samplePoints(pts: Pos[], closed: boolean): Pos[] {
  const path = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
  if (path.length < 2) return [];
  const n = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil(pathLength(path) / 20) + 1));
  return Array.from({ length: n }, (_, i) => along(path, i / (n - 1)));
}

export const elevationUrl = (samples: Pos[]) => `/api/map/elevation?p=${samples.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(';')}`;

/** The profile from the samples and their elevations (null where USGS had none), or null with fewer than two values. */
export function buildProfile(samples: Pos[], elevations: Array<number | null>): Profile | null {
  const total = pathLength(samples);
  const step = samples.length > 1 ? total / (samples.length - 1) : 0;
  const points: ProfilePoint[] = [];
  samples.forEach((pos, i) => {
    const e = elevations[i];
    if (e != null && Number.isFinite(e)) points.push({ at: i * step, elevation: e, pos });
  });
  if (points.length < 2) return null;
  let gain = 0,
    loss = 0;
  for (let i = 1; i < points.length; i++) {
    const d = points[i].elevation - points[i - 1].elevation;
    if (d > 0) gain += d;
    else loss -= d;
  }
  const low = points.reduce((a, b) => (b.elevation < a.elevation ? b : a));
  const high = points.reduce((a, b) => (b.elevation > a.elevation ? b : a));
  return { points, gain, loss, low, high, length: total };
}

const cache = new Map<string, Promise<Array<number | null>>>();

/** Elevations for the samples; each distinct request is made once per visit. */
export function fetchElevations(samples: Pos[]): Promise<Array<number | null>> {
  const url = elevationUrl(samples);
  let p = cache.get(url);
  if (!p) {
    p = fetch(url, { headers: { accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ points: Array<{ elevation: number | null }> }>;
      })
      .then((b) => b.points.map((x) => x.elevation));
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}
