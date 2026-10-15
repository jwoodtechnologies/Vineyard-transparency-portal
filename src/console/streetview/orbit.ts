/**
 * Looking around in the 3D street level view, like Google's: one finger or a mouse drag turns the view all
 * the way around the pin and tilts it (up to 85 degrees, eye level); two fingers twist and pinch; a right or
 * Ctrl drag also turns. Turn and step helpers drive the on screen buttons and the keys. While it is on, the
 * map draws at no more than twice the screen's pixel density, so turning stays smooth on a phone.
 */
import type * as maplibregl from 'maplibre-gl';
import { destination, type Pos } from '../measure/geo';
import { eyeView } from './eye';

const TURN_PER_PX = 0.35;
const TILT_PER_PX = 0.22;
export const MAX_PITCH_3D = 85;

/** Switches the map's gestures to looking around; returns how to put them back. */
/** `pin`: where the camera stands; turning and tilting pivot on it. */
export function enableOrbit(map: maplibregl.Map, pin: () => Pos | null): () => void {
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
  // With drag pan off the map drops its touch-action rule, and the browser would take a finger drag as a scroll.
  const touchAction = el.style.touchAction;
  el.style.touchAction = 'none';
  const down = new Map<number, { x: number; y: number }>();
  let frame = 0;
  let pending: { bearing: number; pitch: number } | null = null;
  const apply = () => {
    frame = 0;
    const at = pin();
    if (pending) map.jumpTo(at ? eyeView(map, at, pending.bearing, pending.pitch) : pending);
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
    el.style.touchAction = touchAction;
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

/** Turns the view by `deg` degrees (positive is clockwise), standing at `pin`. */
export function turn(map: maplibregl.Map, deg: number, pin: Pos | null): void {
  const bearing = map.getBearing() + deg;
  map.easeTo({ ...(pin ? eyeView(map, pin, bearing, map.getPitch()) : { bearing }), duration: still() ? 0 : 250 });
}

/** The spot `meters` ahead of the pin along the way the view faces (negative is back). */
export function stepFrom(map: maplibregl.Map, meters: number, pin: Pos | null): Pos {
  const c = map.getCenter();
  return destination(pin ?? [c.lng, c.lat], map.getBearing(), meters);
}
