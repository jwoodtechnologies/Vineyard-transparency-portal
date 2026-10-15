/**
 * What a deliberate click or tap does in street view (after tapGuard.ts has ruled out drags):
 *
 * - With Zoning and Projects off, a click moves there at once.
 * - With either on, a click on a zone or project opens its details card, and a double click (or double tap)
 *   moves there. The single click waits for the double click window so a double click never also opens
 *   the card; a click on bare ground does nothing.
 */
import type { Pos } from './geo';

export const DOUBLE_MS = 320;
/** Two clicks this close (in pixels) and this quick are a double click. */
export const DOUBLE_PX = 24;

export type Action = { kind: 'move' } | { kind: 'card' } | { kind: 'none' };

export class ClickRouter {
  private last: { x: number; y: number; t: number } | null = null;

  /**
   * A click at (x, y) at time t. `now` is what to do at once; `later` (only with layers on) is what to do
   * after DOUBLE_MS if no second click comes, which the caller cancels on the next click.
   */
  click(x: number, y: number, t: number, layersOn: boolean, onFeature: boolean): { now: Action; later: Action | null } {
    const prev = this.last;
    const double = prev != null && t - prev.t <= DOUBLE_MS && Math.hypot(x - prev.x, y - prev.y) <= DOUBLE_PX;
    if (!layersOn) {
      this.last = { x, y, t };
      return { now: { kind: 'move' }, later: null };
    }
    if (double) {
      this.last = null;
      return { now: { kind: 'move' }, later: null };
    }
    this.last = { x, y, t };
    return { now: { kind: 'none' }, later: onFeature ? { kind: 'card' } : null };
  }
}

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

/** The feature under a ground point: projects before zoning, then the smallest shape. */
export function featureAt<T extends GroundFeature>(list: T[], at: Pos): T | null {
  let best: { f: T; rank: number; area: number } | null = null;
  for (const f of list)
    for (const r of f.rings) {
      if (!inRing(at, r)) continue;
      const rank = f.layer === 'projects' ? 0 : 1;
      const area = ringArea(r);
      if (!best || rank < best.rank || (rank === best.rank && area < best.area)) best = { f, rank, area };
    }
  return best?.f ?? null;
}
