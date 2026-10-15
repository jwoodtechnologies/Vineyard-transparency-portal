/**
 * Drive mode's camera: it follows the car at an angle and distance the driver chooses. One finger (or the
 * mouse) dragged turns it all the way around the car and tilts it; a pinch or the wheel brings it from close
 * behind the car out to a high view over the town. Every value eases toward where it is asked to be, each
 * frame, so nothing jumps; Reset view eases back to the chase view.
 */

export interface View {
  /** Degrees around the car from straight behind it (positive: the camera swings to the car's left). */
  yaw: number;
  /** Degrees from looking straight down (0) toward the horizon (90). */
  pitch: number;
  /** Map zoom: about 20.3 is close behind the car, 12 the whole city from high above. */
  zoom: number;
}

export const CHASE: View = { yaw: 0, pitch: 66, zoom: 20.3 };
export const PITCH_MIN = 25;
export const PITCH_MAX = 80;
export const ZOOM_MIN = 12;
export const ZOOM_MAX = 20.8;

/** Degrees turned per pixel dragged sideways, and tilted per pixel dragged up or down. */
export const YAW_PER_PX = 0.35;
export const PITCH_PER_PX = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** An angle in degrees from -180 to 180. */
export const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** The view after a drag of (dx, dy) pixels: a full circle is about 1,030 px of dragging. */
export function dragged(v: View, dx: number, dy: number): View {
  return { ...v, yaw: wrap(v.yaw - dx * YAW_PER_PX), pitch: clamp(v.pitch - dy * PITCH_PER_PX, PITCH_MIN, PITCH_MAX) };
}

/** The view after zooming by `dz` (a pinch to twice the spread is +1; the wheel gives fractions). */
export function zoomed(v: View, dz: number): View {
  return { ...v, zoom: clamp(v.zoom + dz, ZOOM_MIN, ZOOM_MAX) };
}

/**
 * One frame of easing from `cur` toward `target`: about 63% of the way in `1 / rate` seconds whatever the
 * frame rate, the short way round for the angle.
 */
export function ease(cur: View, target: View, dt: number, rate = 8): View {
  const k = 1 - Math.exp(-Math.max(0, dt) * rate);
  return {
    yaw: wrap(cur.yaw + wrap(target.yaw - cur.yaw) * k),
    pitch: cur.pitch + (target.pitch - cur.pitch) * k,
    zoom: cur.zoom + (target.zoom - cur.zoom) * k,
  };
}

/** An eased heading (degrees), following `to` the short way round. */
export function easeAngle(cur: number, to: number, dt: number, rate: number): number {
  return wrap(cur + wrap(to - cur) * (1 - Math.exp(-Math.max(0, dt) * rate)));
}

/**
 * How far ahead of the car (meters, along the camera's heading) the map's center sits: close in, a little
 * ahead so the car is low in the view; far out, on the car.
 */
export function lead(zoom: number): number {
  return 7 * clamp((zoom - 17) / (CHASE.zoom - 17), 0, 1.2);
}

/** Whether the view is (close to) the chase view, so Reset view can show as not needed. */
export function isChase(v: View): boolean {
  return Math.abs(wrap(v.yaw)) < 1 && Math.abs(v.pitch - CHASE.pitch) < 1 && Math.abs(v.zoom - CHASE.zoom) < 0.05;
}
