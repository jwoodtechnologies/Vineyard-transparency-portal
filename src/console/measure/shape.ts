/**
 * A measurement: its mode and points, the edits made to it (with undo), and the ?m= link that reopens it.
 * Distance is a path (closed into a loop on request), Area a polygon, Circle a center and a point on the
 * edge, Parcel the point tapped on a parcel.
 */
import type { Pos } from './geo';

export type Mode = 'distance' | 'area' | 'circle' | 'parcel';

export interface Shape {
  mode: Mode;
  pts: Pos[];
  /** A distance path closed into a loop. */
  closed: boolean;
}

export interface State extends Shape {
  /** Finished: taps no longer add points (points can still be dragged). */
  done: boolean;
  /** Earlier versions of the points, newest last, for undo. */
  past: Array<{ pts: Pos[]; closed: boolean }>;
}

export type Action =
  | { type: 'mode'; mode: Mode }
  | { type: 'add'; at: Pos }
  | { type: 'move'; index: number; at: Pos; record?: boolean }
  | { type: 'insert'; after: number; at: Pos }
  | { type: 'undo' }
  | { type: 'clear' }
  | { type: 'close' }
  | { type: 'finish' }
  | { type: 'load'; shape: Shape };

/** The most points one measurement keeps. */
export const MAX_POINTS = 200;
const PAST = 100;

export const emptyState = (mode: Mode = 'distance'): State => ({
  mode,
  pts: [],
  closed: false,
  done: false,
  past: [],
});

const remember = (s: State): State['past'] => [...s.past.slice(-(PAST - 1)), { pts: s.pts, closed: s.closed }];

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case 'mode':
      return a.mode === s.mode ? s : emptyState(a.mode);
    case 'load':
      return { ...a.shape, done: true, past: [] };
    case 'clear':
      return s.pts.length ? { ...emptyState(s.mode), past: remember(s) } : s;
    case 'add': {
      if (s.mode === 'parcel') return { ...s, pts: [a.at], done: true, past: remember(s) };
      if (s.mode === 'circle') {
        // The first point is the center; the next sets the edge, and later ones move it.
        const pts: Pos[] = s.pts.length ? [s.pts[0], a.at] : [a.at];
        return { ...s, pts, done: pts.length === 2, past: remember(s) };
      }
      if (s.done || s.pts.length >= MAX_POINTS) return s;
      // The same spot twice in a row (a double tap, Add point pressed twice) adds nothing.
      const last = s.pts[s.pts.length - 1];
      if (last && Math.abs(last[0] - a.at[0]) < 1e-7 && Math.abs(last[1] - a.at[1]) < 1e-7) return s;
      return { ...s, pts: [...s.pts, a.at], past: remember(s) };
    }
    case 'move': {
      if (!s.pts[a.index]) return s;
      const pts = s.pts.slice();
      // Moving a circle's center carries the edge point with it, so the radius stays.
      if (s.mode === 'circle' && a.index === 0 && pts[1]) pts[1] = [pts[1][0] + a.at[0] - pts[0][0], pts[1][1] + a.at[1] - pts[0][1]];
      pts[a.index] = a.at;
      return { ...s, pts, past: a.record === false ? s.past : remember(s) };
    }
    case 'insert': {
      if (s.mode === 'circle' || s.mode === 'parcel' || s.pts.length >= MAX_POINTS || a.after < 0 || a.after >= s.pts.length) return s;
      const pts = s.pts.slice();
      pts.splice(a.after + 1, 0, a.at);
      return { ...s, pts, past: remember(s) };
    }
    case 'undo': {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return {
        ...s,
        pts: prev.pts,
        closed: prev.closed,
        done: s.mode === 'circle' ? prev.pts.length === 2 : s.mode === 'parcel' ? prev.pts.length > 0 : false,
        past: s.past.slice(0, -1),
      };
    }
    case 'close':
      if (s.mode !== 'distance' || s.pts.length < 3) return s;
      return { ...s, closed: !s.closed, past: remember(s) };
    case 'finish':
      return s.pts.length ? { ...s, done: true } : s;
  }
}

// Google's encoded polyline format at six decimal places (about 10 cm): short, and safe in a link.
function encodeNumber(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

export function encodePoints(pts: Pos[]): string {
  let lat = 0,
    lng = 0,
    out = '';
  for (const [x, y] of pts) {
    const la = Math.round(y * 1e6),
      lo = Math.round(x * 1e6);
    out += encodeNumber(la - lat) + encodeNumber(lo - lng);
    lat = la;
    lng = lo;
  }
  return out;
}

export function decodePoints(s: string): Pos[] | null {
  const pts: Pos[] = [];
  let i = 0,
    lat = 0,
    lng = 0;
  const next = (): number | null => {
    let shift = 0,
      result = 0,
      b: number;
    do {
      if (i >= s.length || shift > 30) return null;
      b = s.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    const dLat = next();
    const dLng = next();
    if (dLat == null || dLng == null) return null;
    lat += dLat;
    lng += dLng;
    pts.push([lng / 1e6, lat / 1e6]);
    if (pts.length > MAX_POINTS) return null;
  }
  return pts;
}

const CODE: Record<Mode, string> = {
  distance: 'd',
  area: 'a',
  circle: 'c',
  parcel: 'p',
};
const MODE_OF: Record<string, Mode> = {
  d: 'distance',
  a: 'area',
  c: 'circle',
  p: 'parcel',
};

/** The ?m= value for a shape: d:, dl: (a loop), a:, c: or p:, then the points. Empty when there is nothing to keep. */
export function encodeShape(s: Shape): string {
  if (!s.pts.length) return '';
  return `${CODE[s.mode]}${s.mode === 'distance' && s.closed ? 'l' : ''}:${encodePoints(s.pts)}`;
}

/** A shape from a ?m= value, or null when it is not one this tool wrote or lies far from Vineyard. */
export function decodeShape(v: string | null | undefined): Shape | null {
  const m = /^([dacp])(l?):(.+)$/.exec(v ?? '');
  if (!m) return null;
  const mode = MODE_OF[m[1]];
  if (m[2] && mode !== 'distance') return null;
  const pts = decodePoints(m[3]);
  if (!pts?.length) return null;
  // Utah County and a margin: a link never points the map somewhere else.
  if (pts.some(([x, y]) => x < -113 || x > -110.5 || y < 39.5 || y > 41)) return null;
  if (mode === 'circle' && pts.length !== 2) return null;
  if (mode === 'parcel' && pts.length !== 1) return null;
  return { mode, pts, closed: m[2] === 'l' };
}
