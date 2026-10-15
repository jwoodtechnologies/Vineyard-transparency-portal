/**
 * Drive mode's car: it follows a path made of the lanes it drives (graph.ts), joined at each intersection by a
 * smooth curve (a U turn at a dead end), at a steady speed for the road, slowing for curves and turns ahead
 * and speeding up again gently. Plain arithmetic, stepped once a frame by DriveMode.tsx.
 */
import { bearing, destination, distance } from '../measure/geo';
import { cruiseSpeed, laneOffset, legCoords, offsetLine, turnOptions, type Graph, type Leg, type Pos, type SpeedMode, type TurnOptions } from './graph';

const ACCEL = 1.6; // m/s², a gentle start
const BRAKE = 3; // m/s², a firm but comfortable stop
const LATERAL = 2.2; // m/s² of sideways pull allowed in curves
const PLAN_AHEAD_M = 25; // the next road is joined on (and the choice locked) this far before the intersection
const OPTIONS_AHEAD_M = 130; // the turn buttons show from this far before an intersection
const TURN_SPEED = 5; // m/s (about 11 mph) through a turn
const LOOK_M = 60; // speed is planned over this much path ahead

export type Choice = 'left' | 'straight' | 'right';

function cubic(p0: Pos, p1: Pos, p2: Pos, p3: Pos, n: number): Pos[] {
  const out: Pos[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n,
      u = 1 - t;
    const a = u * u * u,
      b = 3 * u * u * t,
      c = 3 * u * t * t,
      d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

/** The point `m` meters along a polyline, with the index of the segment it is on. */
function along(pts: Pos[], cum: number[], m: number): { p: Pos; i: number } {
  if (m <= 0) return { p: pts[0], i: 0 };
  if (m >= cum[cum.length - 1]) return { p: pts[pts.length - 1], i: pts.length - 2 };
  let lo = 0,
    hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= m) lo = mid;
    else hi = mid;
  }
  const t = (m - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
  return { p: [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t], i: lo };
}

export class Car {
  private pts: Pos[] = [];
  private cum: number[] = [0];
  /** Where the current leg's lane ends on the path (meters), where its intersection is. */
  private legEndAt = 0;
  s = 0;
  v = 0;
  leg: Leg;
  /** The leg after the current one, once joined on. */
  private next: Leg | null = null;
  choice: Choice | null = null;
  stopped = false;
  mode: SpeedMode = 'normal';
  private opts: TurnOptions | null = null;

  constructor(
    private g: Graph,
    start: Leg,
    /** Where on the leg to begin (meters from its start). */
    from = 0,
  ) {
    this.leg = start;
    this.append(this.lane(start), false);
    this.legEndAt = this.cum[this.cum.length - 1];
    this.s = Math.min(from, Math.max(0, this.legEndAt - 1));
  }

  private lane(l: Leg): Pos[] {
    return offsetLine(legCoords(this.g, l), laneOffset(this.g.edges[l.edge]));
  }

  /** Adds lane points to the path, joining the corner with a curve (or a U turn). */
  private append(add: Pos[], join: boolean, uturn = false): void {
    if (!add.length) return;
    if (!this.pts.length || !join) {
      this.pts.push(...add);
    } else {
      const a = this.pts[this.pts.length - 1];
      const b = add[0];
      if (uturn) {
        const h = bearing(this.pts[Math.max(0, this.pts.length - 2)], a);
        this.pts.push(...cubic(a, destination(a, h, 7), destination(b, h, 7), b, 14));
        this.pts.push(...add);
      } else {
        // Trim up to 6 m off each side of the corner and bridge with a curve through the corner.
        const r = 6;
        let k = this.pts.length - 1;
        while (k > 1 && distance(this.pts[k - 1], a) < r) k--;
        const p0 = this.pts[k];
        this.pts.length = k + 1;
        let j = 0;
        while (j < add.length - 2 && distance(add[0], add[j + 1]) < r) j++;
        const p3 = add[Math.min(add.length - 1, j + 1)];
        const corner: Pos = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        this.pts.push(...cubic(p0, corner, corner, p3, 8));
        this.pts.push(...add.slice(Math.min(add.length - 1, j + 1)));
      }
    }
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + distance(this.pts[i - 1], this.pts[i]));
  }

  /** The ways on at the coming intersection, while it is near (for the turn buttons), else null. */
  options(): TurnOptions | null {
    const toNode = (this.pendingSwitch ?? this.legEndAt) - this.s;
    if (toNode > OPTIONS_AHEAD_M) return null;
    this.opts ??= turnOptions(this.g, this.leg);
    return this.opts;
  }

  /** True once the way on is joined to the path: the turn can no longer change. */
  get locked(): boolean {
    return this.next != null;
  }

  /** Whether the way it will take at the coming intersection is a turn (or a U turn), not straight on. */
  private turning(): boolean {
    const o = this.opts ?? turnOptions(this.g, this.leg);
    this.opts = o;
    const leg = (this.choice ? o[this.choice] : null) ?? o.auto;
    return leg !== o.straight;
  }

  private planNext(): void {
    const o = (this.opts ??= turnOptions(this.g, this.leg));
    const picked = this.choice ? o[this.choice] : null;
    const leg = picked ?? o.auto;
    const uturn = leg.edge === this.leg.edge && leg.forward !== this.leg.forward;
    this.next = leg;
    const end = this.legEndAt;
    this.append(this.lane(leg), true, uturn);
    // The new leg's lane ends where the whole path now ends.
    this.legEndAt = this.cum[this.cum.length - 1];
    this.pendingSwitch = end;
  }
  /** Where on the path the car passes from the current leg onto the next one. */
  private pendingSwitch: number | null = null;

  /** The fastest speed allowed at each point ahead, braking in time for curves. */
  private allowed(): number {
    const target = this.stopped ? 0 : cruiseSpeed(this.g.edges[this.leg.edge].cls, this.mode);
    let limit = target;
    const start = along(this.pts, this.cum, this.s).i;
    for (let i = Math.max(1, start); i < this.pts.length - 1 && this.cum[i] - this.s < LOOK_M; i++) {
      const d1 = this.cum[i] - this.cum[i - 1],
        d2 = this.cum[i + 1] - this.cum[i];
      if (d1 < 0.3 || d2 < 0.3) continue;
      const turn = Math.abs(((bearing(this.pts[i], this.pts[i + 1]) - bearing(this.pts[i - 1], this.pts[i]) + 540) % 360) - 180);
      const kappa = ((turn * Math.PI) / 180) / ((d1 + d2) / 2);
      if (kappa < 1e-4) continue;
      const vCurve = Math.max(2.5, Math.sqrt(LATERAL / kappa));
      const ahead = Math.max(0, this.cum[i] - this.s);
      limit = Math.min(limit, Math.sqrt(vCurve * vCurve + 2 * BRAKE * ahead));
    }
    // Slow down early for a turn at the coming intersection, before its curve is joined on.
    if (!this.next && !this.stopped) {
      const toNode = this.legEndAt - this.s;
      if (toNode < OPTIONS_AHEAD_M && this.turning()) limit = Math.min(limit, Math.sqrt(TURN_SPEED * TURN_SPEED + 2 * BRAKE * 0.8 * Math.max(0, toNode - 8)));
    }
    // Never run off the end of the path.
    const left = this.cum[this.cum.length - 1] - this.s;
    return Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, left - 1)));
  }

  /** Moves the car on by `dt` seconds (capped, so a slow frame or a hidden tab never jumps it far). */
  step(dt: number): void {
    dt = Math.min(dt, 0.1);
    const total = this.cum[this.cum.length - 1];
    if (!this.next && total - this.s < PLAN_AHEAD_M) this.planNext();
    const want = this.allowed();
    this.v = this.v < want ? Math.min(want, this.v + ACCEL * dt) : Math.max(want, this.v - BRAKE * dt);
    this.s += this.v * dt;
    if (this.pendingSwitch != null && this.s >= this.pendingSwitch && this.next) {
      this.leg = this.next;
      this.next = null;
      this.choice = null;
      this.opts = null;
      this.pendingSwitch = null;
    }
    // Forget the path well behind the car.
    if (this.s > 400) {
      const keep = along(this.pts, this.cum, this.s - 100).i;
      this.pts = this.pts.slice(keep);
      const drop = this.cum[keep];
      this.cum = this.cum.slice(keep).map((c) => c - drop);
      this.s -= drop;
      this.legEndAt -= drop;
      if (this.pendingSwitch != null) this.pendingSwitch -= drop;
    }
  }

  /** Where the car is and which way it faces (looking a few meters ahead, so it turns smoothly). */
  pose(): { at: Pos; heading: number } {
    const at = along(this.pts, this.cum, this.s).p;
    const ahead = along(this.pts, this.cum, this.s + 4).p;
    const behind = along(this.pts, this.cum, Math.max(0, this.s - 1)).p;
    return { at, heading: distance(at, ahead) > 0.2 ? bearing(behind, ahead) : bearing(behind, at) };
  }

  /** The road the car is on: its class, for the speed shown. */
  roadClass(): string {
    return this.g.edges[this.leg.edge].cls;
  }
}
