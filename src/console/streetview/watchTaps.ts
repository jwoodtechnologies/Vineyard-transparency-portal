/** Wires TapGuard (tapGuard.ts) to an element's pointer events. */
import { TapGuard, type Tap } from './tapGuard';

/**
 * Listens on `el` (in the capture phase, so it sees every press before the map or viewer) and calls
 * `onTap` with the point in the element's own pixels. Returns how to stop. `onDrag` hears when a press
 * turns into a drag, so a hover hint can hide.
 */
export function watchTaps(el: HTMLElement, onTap: (tap: Tap) => void, onDrag?: () => void): () => void {
  const g = new TapGuard();
  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: PointerEvent) => {
    const [x, y] = local(e);
    g.down(e.pointerId, x, y, e.timeStamp, e.pointerType !== 'mouse', e.pointerType === 'mouse' ? e.button : 0);
  };
  const move = (e: PointerEvent) => {
    const was = g.dragging;
    const [x, y] = local(e);
    g.move(e.pointerId, x, y);
    if (!was && g.dragging) onDrag?.();
  };
  const up = (e: PointerEvent) => {
    const [x, y] = local(e);
    const tap = g.up(e.pointerId, x, y, e.timeStamp);
    if (tap) onTap(tap);
  };
  const cancel = (e: PointerEvent) => g.cancel(e.pointerId);
  const wheel = () => g.wheel();
  const opts = { capture: true, passive: true } as const;
  el.addEventListener('pointerdown', down, opts);
  el.addEventListener('pointermove', move, opts);
  el.addEventListener('pointerup', up, opts);
  el.addEventListener('pointercancel', cancel, opts);
  el.addEventListener('wheel', wheel, opts);
  return () => {
    el.removeEventListener('pointerdown', down, opts);
    el.removeEventListener('pointermove', move, opts);
    el.removeEventListener('pointerup', up, opts);
    el.removeEventListener('pointercancel', cancel, opts);
    el.removeEventListener('wheel', wheel, opts);
  };
}
