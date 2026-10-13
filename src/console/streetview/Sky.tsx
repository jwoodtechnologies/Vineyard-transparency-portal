/**
 * Light clouds drifting slowly across the 3D view's sky. Two soft layers of CSS gradients, moved only by
 * transforms (drawn by the compositor, so turning stays smooth on a phone): one drifts on its own, the
 * other slides with the view's bearing so the clouds turn with you. Shown above the horizon only, fading
 * out toward it. Still with reduced motion.
 */
import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { horizonY } from './geo';

/** The width of the cloud pattern (background-size in console.css). */
const TILE = 900;

export function Sky({ getMap }: { getMap: () => maplibregl.Map | null }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const map = getMap();
    const el = box.current;
    if (!map || !el) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const h = map.getContainer().clientHeight;
      const w = map.getContainer().clientWidth;
      const fov = map.getVerticalFieldOfView();
      const y = horizonY(h, map.getPitch(), fov);
      el.style.setProperty('--sky-h', `${Math.max(0, Math.round(y))}px`);
      // The horizontal field of view in degrees, for how far a turn moves the clouds.
      const hfov = (2 * Math.atan(Math.tan(((fov / 2) * Math.PI) / 180) * (w / Math.max(1, h))) * 180) / Math.PI;
      // The cloud pattern repeats every TILE pixels, so the slide wraps without a jump.
      const shift = (((-map.getBearing() * w) / Math.max(1, hfov)) % TILE) - TILE;
      el.style.setProperty('--sky-x', `${Math.round(shift)}px`);
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    map.on('move', queue);
    map.on('resize', queue);
    return () => {
      cancelAnimationFrame(frame);
      map.off('move', queue);
      map.off('resize', queue);
    };
  }, [getMap]);
  return (
    <div ref={box} className="vc-sv-sky" aria-hidden="true">
      <div className="vc-sv-sky-turn">
        <div className="vc-sv-clouds" />
        <div className="vc-sv-clouds vc-sv-clouds-far" />
      </div>
    </div>
  );
}
