/**
 * Long press on the map (a finger held still for half a second, or a right click on a mouse) drops the
 * street view pin. Pinches, pans and quick taps are left to the map.
 */
import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { Pos } from './geo';

const HOLD_MS = 550;
const SLOP_PX = 8;

export function useLongPress(getMap: () => maplibregl.Map | null, gen: number, ready: boolean, enabled: boolean, onPress: (at: Pos) => void): void {
  const cb = useRef(onPress);
  const on = useRef(enabled);
  useEffect(() => {
    cb.current = onPress;
    on.current = enabled;
  });
  useEffect(() => {
    const map = getMap();
    if (!map || !ready) return;
    const el = map.getCanvasContainer();
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let fired = 0;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    const down = (e: TouchEvent) => {
      cancel();
      if (!on.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      const r = el.getBoundingClientRect();
      start = { x: t.clientX - r.left, y: t.clientY - r.top };
      timer = window.setTimeout(() => {
        if (!start) return;
        const ll = map.unproject([start.x, start.y]);
        fired = Date.now();
        navigator.vibrate?.(15);
        cb.current([ll.lng, ll.lat]);
        start = null;
      }, HOLD_MS);
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const r = el.getBoundingClientRect();
      if (e.touches.length !== 1 || Math.hypot(t.clientX - r.left - start.x, t.clientY - r.top - start.y) > SLOP_PX) cancel();
    };
    // A right click on a mouse; on touch screens that also send it for a long press, the timer already fired.
    const context = (e: maplibregl.MapMouseEvent) => {
      if (!on.current || Date.now() - fired < 1000) return;
      e.preventDefault();
      cb.current([e.lngLat.lng, e.lngLat.lat]);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchcancel', cancel);
    map.on('contextmenu', context);
    return () => {
      cancel();
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', cancel);
      el.removeEventListener('touchcancel', cancel);
      map.off('contextmenu', context);
    };
  }, [getMap, gen, ready]);
}
