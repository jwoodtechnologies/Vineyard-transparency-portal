/**
 * The compass in the 3D street level view: its needle points north as the view turns, and dragging it
 * around spins the view (the arrow keys and the turn buttons do the same in steps). Tapping it faces north.
 */
import { useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';

export function Compass({ getMap }: { getMap: () => maplibregl.Map | null }) {
  const [bearing, setBearing] = useState(() => getMap()?.getBearing() ?? 0);
  const box = useRef<HTMLButtonElement>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const map = getMap();
    if (!map) return;
    const on = () => setBearing(map.getBearing());
    map.on('rotate', on);
    return () => {
      map.off('rotate', on);
    };
  }, [getMap]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let active = false;
    const angle = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    };
    let from = 0;
    let base = 0;
    const down = (e: PointerEvent) => {
      const map = getMap();
      if (!map) return;
      active = true;
      dragged.current = false;
      el.setPointerCapture(e.pointerId);
      from = angle(e);
      base = map.getBearing();
    };
    const move = (e: PointerEvent) => {
      const map = getMap();
      if (!active || !map) return;
      const d = angle(e) - from;
      if (Math.abs(d) > 2) dragged.current = true;
      // Turning the compass clockwise turns the view clockwise.
      map.setBearing(base - d);
    };
    const up = () => (active = false);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [getMap]);

  const heading = Math.round(((bearing % 360) + 360) % 360);
  return (
    <button
      ref={box}
      type="button"
      className="vc-sv-compass"
      onClick={() => {
        if (!dragged.current) getMap()?.easeTo({ bearing: 0, duration: 300 });
        dragged.current = false;
      }}
      aria-label={`Compass: facing ${heading} degrees. Drag to turn; tap to face north.`}
      title="Drag to turn, tap to face north"
    >
      <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
        <polygon points="20,9 24.5,21 15.5,21" fill="#e03131" />
        <polygon points="20,33 24.5,21 15.5,21" fill="#adb5bd" />
        <text x="20" y="8" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="currentColor">
          N
        </text>
      </svg>
    </button>
  );
}
