/**
 * Light clouds drifting slowly across the 3D view's sky. Two soft layers of CSS gradients, moved only by
 * transforms (drawn by the compositor, so turning stays smooth on a phone): one drifts on its own, the
 * other slides with the view's bearing so the clouds turn with you. Shown above the horizon only, fading
 * out toward it. Still with reduced motion.
 *
 * A soft sun glow sits where the sun really is for Vineyard at this moment (sun.ts), and is gone while the
 * sun is below the horizon or behind the view. The hillshade is lit from the same direction.
 *
 * The whole sky sits behind the map's canvas (the map draws no sky of its own in 3D, so above its terrain the
 * canvas is clear): the blue, then the skyline panorama of the mountains with their snow (skyline.ts, from
 * the viewpoint nearest the view), then the clouds. The map's ground, slopes, buildings and car draw over it.
 */
import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { horizonY } from './geo';
import { nearestView, SKYLINE, skylineLayout } from './skyline';
import { screenPoint, sunPosition, type SunPos } from './sun';

/** The panorama files, by name. */
const PANORAMAS = import.meta.glob('./skyline/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const panoramaUrl = (file: string) => PANORAMAS[`./skyline/${file}`];
const images = new Map<string, HTMLImageElement>();
function panorama(file: string, onLoad: () => void): HTMLImageElement | null {
  const url = panoramaUrl(file);
  if (!url) return null;
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = url;
    images.set(url, img);
  }
  if (img.complete && img.naturalWidth) return img;
  img.addEventListener('load', onLoad, { once: true });
  return null;
}

const SHADE = 'vtp-sv-hillshade';

/** Now, or a set time for review screenshots (localStorage vtp:sun-at, an ISO time). */
function sunTime(): number {
  try {
    const at = Date.parse(localStorage.getItem('vtp:sun-at') ?? '');
    if (Number.isFinite(at)) return at;
  } catch {
    // Storage blocked: the real time.
  }
  return Date.now();
}

/** The width of the cloud pattern (background-size in console.css). */
const TILE = 900;

export function Sky({ getMap }: { getMap: () => maplibregl.Map | null }) {
  const box = useRef<HTMLDivElement>(null);
  const sunEl = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const map = getMap();
    const el = box.current;
    const glow = sunEl.current;
    const cv = canvas.current;
    if (!map || !el || !glow || !cv) return;
    let frame = 0;
    // The skyline: the panorama from the nearest viewpoint, cut into strips across the view.
    const drawSkyline = () => {
      const w = map.getContainer().clientWidth,
        h = map.getContainer().clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const c = map.getCenter();
      const img = panorama(SKYLINE.views[nearestView(c.lng, c.lat)].file, queue);
      if (!img) return;
      const lay = skylineLayout(w, h, map.getBearing(), map.getPitch(), map.getVerticalFieldOfView());
      g.imageSmoothingEnabled = true;
      for (const s of lay.strips) g.drawImage(img, s.sx, 0, Math.max(0.01, s.sw), SKYLINE.rows, s.dx, lay.top, s.dw + 0.5, lay.height);
    };
    let sun: SunPos = { azimuth: 0, altitude: -90 };
    const lightFromSun = () => {
      const c = map.getCenter();
      sun = sunPosition(sunTime(), c.lat, c.lng);
      if (sun.altitude > 0 && map.getLayer(SHADE)) {
        map.setPaintProperty(SHADE, 'hillshade-illumination-anchor', 'map');
        map.setPaintProperty(SHADE, 'hillshade-illumination-direction', Math.round(sun.azimuth));
      }
    };
    const place = () => {
      frame = 0;
      const h = map.getContainer().clientHeight;
      const w = map.getContainer().clientWidth;
      const fov = map.getVerticalFieldOfView();
      const y = horizonY(h, map.getPitch(), fov);
      el.style.setProperty('--sky-h', `${Math.max(0, Math.round(y))}px`);
      const p = sun.altitude > 0 ? screenPoint(sun.azimuth, sun.altitude, { width: w, height: h, bearing: map.getBearing(), pitch: map.getPitch(), fov }) : null;
      // Off screen by more than the glow's reach: hidden.
      const shown = p != null && p.x > -200 && p.x < w + 200 && p.y > -200 && p.y < y;
      glow.hidden = !shown;
      if (shown) glow.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
      // The horizontal field of view in degrees, for how far a turn moves the clouds.
      const hfov = (2 * Math.atan(Math.tan(((fov / 2) * Math.PI) / 180) * (w / Math.max(1, h))) * 180) / Math.PI;
      // The cloud pattern repeats every TILE pixels, so the slide wraps without a jump.
      const shift = (((-map.getBearing() * w) / Math.max(1, hfov)) % TILE) - TILE;
      el.style.setProperty('--sky-x', `${Math.round(shift)}px`);
      drawSkyline();
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    lightFromSun();
    place();
    // The sun moves about a quarter of a degree a minute.
    const tick = window.setInterval(() => {
      lightFromSun();
      queue();
    }, 60_000);
    // The hillshade layer is added a moment after the view opens.
    map.once('idle', lightFromSun);
    map.on('move', queue);
    map.on('resize', queue);
    return () => {
      window.clearInterval(tick);
      map.off('idle', lightFromSun);
      cancelAnimationFrame(frame);
      map.off('move', queue);
      map.off('resize', queue);
    };
  }, [getMap]);
  return (
    <div ref={box} className="vc-sv-sky" aria-hidden="true">
      <canvas ref={canvas} className="vc-sv-skyline" />
      <div className="vc-sv-sun-clip">
        <div ref={sunEl} className="vc-sv-sun" hidden />
      </div>
      <div className="vc-sv-sky-mask">
        <div className="vc-sv-sky-turn">
          <div className="vc-sv-clouds" />
          <div className="vc-sv-clouds vc-sv-clouds-far" />
        </div>
      </div>
    </div>
  );
}
