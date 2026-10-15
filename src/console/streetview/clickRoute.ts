/**
 * Which zone or project lies under a ground point in street view and Drive mode, from the shapes themselves.
 * (What a tap does with it is in StreetView.tsx: it moves, except inside a project, which opens its card.)
 */
import type { Pos } from './geo';

/** Shoelace area in squared degrees (only compared, so the units do not matter). */
function ringArea(r: Pos[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

export function inRing(p: Pos, r: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > p[1] !== r[j][1] > p[1] && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
  }
  return inside;
}

export interface GroundFeature {
  /** 'zoning' or 'projects'. */
  layer: string;
  /** The district's zone or the project's name. */
  name: string;
  rings: Pos[][];
}

/** A project counts as this share of its area against zones, so a street project wins over the zone it is in. */
export const PROJECT_WEIGHT = 0.25;

/**
 * The feature under a ground point: the smallest shape there, with projects weighted (PROJECT_WEIGHT) so a
 * project wins over the zone around it, but a project drawn over the whole city (a water rights purchase)
 * does not hide every zone.
 */
export function featureAt<T extends GroundFeature>(list: T[], at: Pos): T | null {
  let best: { f: T; score: number } | null = null;
  for (const f of list)
    for (const r of f.rings) {
      if (!inRing(at, r)) continue;
      const score = ringArea(r) * (f.layer === 'projects' ? PROJECT_WEIGHT : 1);
      if (!best || score < best.score) best = { f, score };
    }
  return best?.f ?? null;
}
