/**
 * Looking around in the 3D street level view, like Google's: one finger or a mouse drag turns the view all
 * the way around the pin and tilts it (up to 85 degrees, eye level); two fingers twist and pinch; a right or
 * Ctrl drag also turns. Turn and step helpers drive the on screen buttons and the keys. While it is on, the
 * map draws at no more than twice the screen's pixel density, so turning stays smooth on a phone.
 */
import type * as maplibregl from 'maplibre-gl';
import { destination, type Pos } from '../measure/geo';

const TURN_PER_PX = 0.35;
const TILT_PER_PX = 0.22;
export const MAX_PITCH_3D = 85;

/** Switches the map's gestures to looking around; returns how to put them back. */
export function enableOrbit(map: maplibregl.Map): () => void {
  const before = {
    dragPan: map.dragPan.isEnabled(),
    dragRotate: map.dragRotate.isEnabled(),
    keyboard: map.keyboard.isEnabled(),
    touchPitch: map.touchPitch.isEnabled(),
    pixelRatio: map.getPixelRatio(),
  };
  map.dragPan.disable();
  map.keyboard.disable();
  map.dragRotate.enable();
  map.touchPitch.enable();
  map.touchZoomRotate.enableRotation();
  map.setMaxPitch(MAX_PITCH_3D);
  if (window.devicePixelRatio > 2) map.setPixelRatio(2);

  const el = map.getCanvasContainer();
  const down = new Map<number, { x: number; y: number }>();
  let frame = 0;
  let pending: { bearing: number; pitch: number } | null = null;
  const apply = () => {
    frame = 0;
    if (pending) map.jumpTo(pending);
    pending = null;
  };
  const start = (e: PointerEvent) => {
    // Plain drags only: right and Ctrl drags are the map's own rotate, which also works.
    if (e.button !== 0 || e.ctrlKey) return;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e: PointerEvent) => {
    const last = down.get(e.pointerId);
    if (!last) return;
    down.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Two fingers are the map's twist and pinch.
    if (down.size !== 1) return;
    const base = pending ?? { bearing: map.getBearing(), pitch: map.getPitch() };
    pending = {
      bearing: base.bearing - (e.clientX - last.x) * TURN_PER_PX,
      pitch: Math.max(0, Math.min(MAX_PITCH_3D, base.pitch - (e.clientY - last.y) * TILT_PER_PX)),
    };
    if (!frame) frame = requestAnimationFrame(apply);
  };
  const end = (e: PointerEvent) => down.delete(e.pointerId);
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);

  return () => {
    cancelAnimationFrame(frame);
    el.removeEventListener('pointerdown', start);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.removeEventListener('pointerleave', end);
    try {
      if (before.dragPan) map.dragPan.enable();
      if (before.keyboard) map.keyboard.enable();
      if (!before.dragRotate) map.dragRotate.disable();
      if (!before.touchPitch) map.touchPitch.disable();
      map.touchZoomRotate.disableRotation();
      map.setPixelRatio(before.pixelRatio);
    } catch {
      // Map removed.
    }
  };
}

const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Turns the view by `deg` degrees (positive is clockwise). */
export function turn(map: maplibregl.Map, deg: number): void {
  map.easeTo({ bearing: map.getBearing() + deg, duration: still() ? 0 : 250 });
}

/** The spot `meters` ahead of the view's center along the way it faces (negative is back). */
export function stepFrom(map: maplibregl.Map, meters: number): Pos {
  const c = map.getCenter();
  return destination([c.lng, c.lat], map.getBearing(), meters);
}
