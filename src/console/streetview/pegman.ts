/**
 * The person button, as in Google Maps: press it and drag onto the map (mouse or finger). While dragging,
 * a small person follows the pointer, the blue street photo lines show, and the line under the person is
 * highlighted; letting go over the map drops it there. A plain tap or click (or Enter) is handled by the
 * button's own click, which asks for a tap on the map instead.
 */
import { useEffect, useRef, type RefObject } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { lineNear, setHighlight } from './coverage';

const START_PX = 6;

export interface PersonDrop {
  /** The point under the person, in map pixels. */
  point: { x: number; y: number };
  lngLat: [number, number];
}

const PERSON_SVG =
  '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><circle cx="12" cy="4.5" r="2.6" fill="#fbbc04" stroke="#7a5b00" stroke-width="1"/><path d="M8.2 9.2c0-1 .8-1.8 1.8-1.8h4c1 0 1.8.8 1.8 1.8v5.3h-1.9V22h-3.8v-7.5H8.2z" fill="#fbbc04" stroke="#7a5b00" stroke-width="1"/></svg>';

/**
 * Wires the drag. `onDragging(true)` shows the lines; `onDrop` gets where it landed on the map (nothing when
 * dropped off the map). Returns a function the button's click calls to skip the click that ends a drag.
 */
export function usePersonDrag(button: RefObject<HTMLButtonElement | null>, getMap: () => maplibregl.Map | null, ready: boolean, onDragging: (on: boolean) => void, onDrop: (d: PersonDrop) => void): () => boolean {
  const cbs = useRef({ onDragging, onDrop });
  const justDragged = useRef(false);
  useEffect(() => {
    cbs.current = { onDragging, onDrop };
  });
  useEffect(() => {
    const btn = button.current;
    if (!btn || !ready) return;
    let start: { x: number; y: number; id: number } | null = null;
    let ghost: HTMLDivElement | null = null;
    let frame = 0;
    const where = (e: PointerEvent) => {
      const map = getMap();
      if (!map) return null;
      const r = map.getContainer().getBoundingClientRect();
      // The person's feet are the point that counts.
      const x = e.clientX - r.left,
        y = e.clientY - r.top + 14;
      if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
      return { map, point: { x, y } };
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      // Keep the pointer from the start: a quick drag leaves the button before the drag begins.
      btn.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      if (!ghost) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < START_PX) return;
        ghost = document.createElement('div');
        ghost.className = 'vc-pegman-ghost';
        ghost.innerHTML = PERSON_SVG;
        document.body.appendChild(ghost);
        cbs.current.onDragging(true);
      }
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = where(e);
        if (!w) return;
        const hit = lineNear(w.map, w.point, 14);
        setHighlight(w.map, hit?.sequence ?? null);
        ghost?.classList.toggle('on-line', Boolean(hit));
      });
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (!ghost) return;
      ghost.remove();
      ghost = null;
      cancelAnimationFrame(frame);
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 400);
      const w = where(e);
      cbs.current.onDragging(false);
      if (w) {
        setHighlight(w.map, null);
        const ll = w.map.unproject([w.point.x, w.point.y]);
        cbs.current.onDrop({ point: w.point, lngLat: [ll.lng, ll.lat] });
      }
    };
    const cancel = () => {
      start = null;
      ghost?.remove();
      ghost = null;
      cbs.current.onDragging(false);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', cancel);
    return () => {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', cancel);
      cancelAnimationFrame(frame);
      ghost?.remove();
    };
  }, [button, getMap, ready]);
  return () => {
    const was = justDragged.current;
    justDragged.current = false;
    return was;
  };
}
