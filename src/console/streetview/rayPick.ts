/**
 * Which raised building a click or tap in the 3D view lands on. MapLibre cannot report rendered features
 * on tilted terrain, so the line of sight is walked here instead: from the camera toward the ground point
 * under the pointer, the first building whose footprint and height it passes through is the one seen there.
 * Its footprint's middle then stands for the click (street view and Drive look up the zone or project under
 * that, not the ground behind the building).
 */
import { inRing } from './clickRoute';

type Pos = [number, number];

export interface Box {
  /** The footprint's outer ring. */
  ring: Pos[];
  /** Bottom and top above the ground, in meters. */
  base: number;
  top: number;
}

/** Where along the line of sight (0 at the camera, 1 at the ground point) to look, this many times. */
const STEPS = 160;

/**
 * The first box the line from `eye` to `ground` passes through, or null. Points are [lng, lat, meters above
 * sea level]; `groundAlt` is the ground's height under the boxes (the valley floor is flat enough for one).
 */
export function firstHit(eye: [number, number, number], ground: [number, number, number], boxes: Box[], groundAlt = ground[2]): Box | null {
  return firstHitAt(eye, ground, boxes, groundAlt)?.box ?? null;
}

/**
 * The first box the line of sight enters, and the ground spot just before it (where to stand to be in front
 * of that building). A building the eye stands inside is passed over.
 */
export function firstHitAt(eye: [number, number, number], ground: [number, number, number], boxes: Box[], groundAlt = ground[2]): { box: Box; before: Pos } | null {
  boxes = boxes.filter((b) => !inRing([eye[0], eye[1]], b.ring));
  if (!boxes.length) return null;
  // Footprint extents once, so most boxes are passed over cheaply at each step.
  const ext = boxes.map((b) => {
    let w = Infinity,
      s = Infinity,
      e = -Infinity,
      n = -Infinity;
    for (const [x, y] of b.ring) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    return { b, w, s, e, n };
  });
  let prev: Pos = [eye[0], eye[1]];
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const p: Pos = [eye[0] + (ground[0] - eye[0]) * t, eye[1] + (ground[1] - eye[1]) * t];
    const h = eye[2] + (ground[2] - eye[2]) * t - groundAlt;
    for (const x of ext) {
      if (p[0] < x.w || p[0] > x.e || p[1] < x.s || p[1] > x.n) continue;
      if (h < x.b.base - 0.5 || h > x.b.top + 0.5) continue;
      if (inRing(p, x.b.ring)) return { box: x.b, before: prev };
    }
    prev = p;
  }
  return null;
}

/** The middle of a footprint (the average of its corners). */
export function middle(ring: Pos[]): Pos {
  let x = 0,
    y = 0;
  for (const [a, b] of ring) {
    x += a;
    y += b;
  }
  return [x / ring.length, y / ring.length];
}
