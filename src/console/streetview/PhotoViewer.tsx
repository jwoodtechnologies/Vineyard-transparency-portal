/**
 * The street photo viewer (MapillaryJS), loaded on demand as its own chunk so /map stays light. Opens a
 * photo turned to face the pin with the pin marked in it, draws zoning districts and the parcel under
 * the pin on the ground (zoningRenderer.ts) with a small label chip per district, and reports where the
 * camera is and which way it looks so the map's camera cone follows.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationDirection, Viewer, type Image as MlyImage, type ViewerMouseEvent } from 'mapillary-js';
import 'mapillary-js/dist/mapillary.css';
import { destination, distance } from '../measure/geo';
import { centerOnPin, clampFlatCenter, turn, type Photo, type Pos } from './geo';
import type { Camera } from './mapDraw';
import { inRing, ZoningRenderer, type District } from './zoningRenderer';
import { MiniMap } from './MiniMap';
import { AHEAD_DEG, aheadTo, datesAt, nearestTo, photosAround, type DateChoice } from './nearby';
import { bearing } from '../measure/geo';

interface Props {
  token: string;
  photo: Photo;
  pin: Pos;
  districts: District[];
  parcel: Pos[] | null;
  showZoning: boolean;
  onCamera: (c: Camera) => void;
  onError: () => void;
  dark: boolean;
  /** Beside the map on a wider screen: no small map (the map beside it shows the person and cone). */
  wide: boolean;
}

interface Chip {
  zone: string;
  color: string;
  x: number;
  y: number;
}

const ringCentroid = (r: Pos[]): Pos => {
  let x = 0,
    y = 0;
  for (const p of r) {
    x += p[0];
    y += p[1];
  }
  return [x / r.length, y / r.length];
};

/**
 * Where a district's chip goes: at the pin when the pin is in it, else inside the district a little way in
 * from its corner nearest the pin (the camera's own spot is under it, out of view).
 */
function chipPoint(ring: Pos[], pin: Pos): Pos {
  if (inRing(pin, ring)) return pin;
  let best = ring[0];
  for (const p of ring) if (distance(p, pin) < distance(best, pin)) best = p;
  const c = ringCentroid(ring);
  for (const t of [0.15, 0.3, 0.5, 0.8]) {
    const q: Pos = [best[0] + (c[0] - best[0]) * t, best[1] + (c[1] - best[1]) * t];
    if (inRing(q, ring)) return q;
  }
  return c;
}

export default function PhotoViewer({ token, photo, pin, districts, parcel, showZoning, onCamera, onError, dark, wide }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const rendererRef = useRef<ZoningRenderer | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  // Where the pin is in the photo, in pixels, or null when it is out of frame.
  const [pinAt, setPinAt] = useState<[number, number] | null>(null);
  const cbs = useRef({ onCamera, onError });
  const cam = useRef<Pos>(photo.pos);
  const look = useRef(0);
  const shownId = useRef<string | null>(null);
  // The heading to keep after a step forward, and the shown photo's frame when it is flat (null for 360).
  const keepHeading = useRef<number | null>(null);
  const flat = useRef<{ focal: number; w: number; h: number } | null>(null);
  const [camera, setCamera] = useState<Camera | null>({ pos: photo.pos, bearing: photo.compass ?? 0, fov: 60 });
  const [taken, setTaken] = useState<number | null>(photo.capturedAt);
  const [shown, setShown] = useState(photo.id);
  const [dates, setDates] = useState<DateChoice[]>([]);
  useEffect(() => {
    cbs.current = { onCamera, onError };
  });

  /** Moves to a photo by id; a photo that cannot be reached from here is left alone. */
  const go = useCallback((id: string) => {
    viewerRef.current?.moveTo(id).catch(() => undefined);
  }, []);
  /**
   * Moves toward a spot on the ground (a click on the road, or a tap on the small map). A click straight
   * ahead steps forward along the street and keeps facing the same way; elsewhere, the photo nearest it.
   */
  const goToward = useCallback(
    (target: Pos) => {
      const from = cam.current,
        heading = look.current;
      void photosAround(token, target, 20).then((list) => {
        const step = aheadTo(list, from, heading, target, shownId.current);
        if (step) {
          keepHeading.current = heading;
          return go(step.id);
        }
        if (Math.abs(turn(heading, bearing(from, target))) <= AHEAD_DEG) {
          keepHeading.current = heading;
          void viewerRef.current?.moveDir(NavigationDirection.StepForward).catch(() => (keepHeading.current = null));
          return;
        }
        const next = nearestTo(list, target, shownId.current);
        if (next) go(next.id);
      });
    },
    [token, go],
  );

  // One viewer per photo search; moving along the street happens inside it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Large arrows on the road for forward and back (the direction component), drag to look, wheel or pinch to zoom.
    const viewer = new Viewer({
      accessToken: token,
      container: el,
      imageId: photo.id,
      component: { cover: false, marker: false, attribution: true, direction: { minWidth: 300, maxWidth: 560 }, sequence: true, keyboard: true, zoom: true },
    });
    viewerRef.current = viewer;
    const renderer = new ZoningRenderer(districts, parcel);
    viewer.addCustomRenderer(renderer);
    rendererRef.current = renderer;
    let first = true;
    let frame = 0;
    let settle = 0;
    let gone = false;
    const placeChips = () => {
      const near = districts
        .flatMap((d) => d.rings.map((r) => ({ d, r, at: chipPoint(r, pin) })))
        .filter((x) => distance(x.at, cam.current) < 250)
        .sort((a, b) => distance(a.at, cam.current) - distance(b.at, cam.current))
        .slice(0, 5);
      const w = el.clientWidth,
        h = el.clientHeight;
      const at = (p: Pos) => {
        const px = renderer.projectGround(p, w, h);
        return px && px[0] >= 0 && px[1] >= 0 && px[0] <= w && px[1] <= h ? px : null;
      };
      setPinAt(at(pin));
      const seen = new Set<string>();
      const out: Chip[] = [];
      // A district's chip at its spot near the pin, or failing that 25 m ahead in the view when that is in the district.
      const ahead = destination(cam.current, look.current, 25);
      for (const x of near) {
        const px = at(x.at) ?? (inRing(ahead, x.r) ? at(ahead) : null);
        // Off the photo (a flat photo shows only what is in front of it): no chip.
        if (!px || seen.has(x.d.zone)) continue;
        seen.add(x.d.zone);
        out.push({ zone: x.d.zone, color: x.d.color, x: px[0], y: px[1] });
      }
      setChips(out);
    };
    // A flat photo shows black past its edges: the view is kept on the photo.
    const clamp = () => {
      const f = flat.current;
      if (!f || !el.clientHeight) return;
      Promise.all([viewer.getCenter(), viewer.getFieldOfView()]).then(([c, fov]) => {
        if (gone || flat.current !== f) return;
        const [x, y] = clampFlatCenter([c[0], c[1]], fov, el.clientWidth / el.clientHeight, f.focal, f.w, f.h);
        if (Math.abs(x - c[0]) > 1e-4 || Math.abs(y - c[1]) > 1e-4) viewer.setCenter([x, y]);
      }, () => undefined);
    };
    const report = () => {
      cancelAnimationFrame(frame);
      clamp();
      frame = requestAnimationFrame(() => {
        Promise.all([viewer.getPosition(), viewer.getPointOfView(), viewer.getFieldOfView()]).then(
          ([pos, pov, fov]) => {
            if (gone) return;
            cam.current = [pos.lng, pos.lat];
            look.current = pov.bearing;
            cbs.current.onCamera({ pos: [pos.lng, pos.lat], bearing: pov.bearing, fov });
            setCamera({ pos: [pos.lng, pos.lat], bearing: pov.bearing, fov });
            placeChips();
            // Once more after the next drawn frame and after the view settles: the overlay reads the drawn view.
            requestAnimationFrame(() => !gone && placeChips());
            clearTimeout(settle);
            settle = window.setTimeout(() => !gone && placeChips(), 350);
          },
          () => undefined,
        );
      });
    };
    viewer.on('image', (ev: { image: MlyImage }) => {
      const img = ev.image;
      const ll = img.computedLngLat ?? img.lngLat;
      renderer.setCamera([ll.lng, ll.lat], img.computedAltitude);
      shownId.current = img.id;
      const pano = /spherical|equirectangular/.test(img.cameraType);
      const focal = Number(img.cameraParameters?.[0]);
      flat.current = pano ? null : { focal: focal > 0.1 ? focal : 0.85, w: img.width || 4, h: img.height || 3 };
      const compass = img.computedCompassAngle ?? img.compassAngle;
      setTaken(img.capturedAt || null);
      setShown(img.id);
      // Other days photos were taken here: the Dates menu (only when there is more than one).
      const here: Pos = [ll.lng, ll.lat];
      void photosAround(token, here, 25).then((list) => {
        if (!gone && shownId.current === img.id) setDates(datesAt(list, here));
      });
      if (first) {
        first = false;
        // Opened on the pin itself (a photo picked on a blue line): it keeps facing along the street.
        if (distance([ll.lng, ll.lat], pin) > 4) viewer.setCenter(centerOnPin({ ...photo, pos: [ll.lng, ll.lat], pano, compass: compass ?? photo.compass }, pin));
      } else if (keepHeading.current != null) {
        // A step forward: a 360 degree photo is turned to keep facing the same way (a flat one already does).
        if (pano && compass != null) viewer.setCenter([(((0.5 + turn(compass, keepHeading.current) / 360) % 1) + 1) % 1, 0.5]);
      }
      keepHeading.current = null;
      report();
    });
    // Like Google's: a ground circle shows where a click would go; a click on the road moves to the photo
    // nearest that spot, a double click or double tap steps forward.
    let downAt: number[] | null = null;
    let cursorFrame = 0;
    viewer.on('mousemove', (e: ViewerMouseEvent) => {
      cancelAnimationFrame(cursorFrame);
      cursorFrame = requestAnimationFrame(() => renderer.setCursor(renderer.unprojectGround(e.pixelPoint[0], e.pixelPoint[1], el.clientWidth, el.clientHeight)));
    });
    viewer.on('mouseout', () => renderer.setCursor(null));
    viewer.on('mousedown', (e: ViewerMouseEvent) => (downAt = e.pixelPoint));
    const goTo = (x: number, y: number) => {
      const target = renderer.unprojectGround(x, y, el.clientWidth, el.clientHeight);
      if (!target) return;
      renderer.setCursor(target);
      goToward(target);
    };
    viewer.on('click', (e: ViewerMouseEvent) => {
      if (e.originalEvent instanceof PointerEvent && e.originalEvent.pointerType === 'touch') return; // taps below
      const moved = downAt ? Math.hypot(e.pixelPoint[0] - downAt[0], e.pixelPoint[1] - downAt[1]) : 0;
      downAt = null;
      if (moved > 6) return; // a drag to look around
      goTo(e.pixelPoint[0], e.pixelPoint[1]);
    });
    viewer.on('dblclick', () => void viewer.moveDir(NavigationDirection.StepForward).catch(() => undefined));
    // Touch: the viewer reports no clicks for taps. A quick still tap goes to the spot; two taps step forward.
    let touch: { x: number; y: number; t: number } | null = null;
    let tapTimer = 0;
    let lastTap = 0;
    const tStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const r = el.getBoundingClientRect();
      touch = e.touches.length === 1 ? { x: t.clientX - r.left, y: t.clientY - r.top, t: Date.now() } : null;
    };
    const tEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!touch || !t) return;
      const r = el.getBoundingClientRect();
      const x = t.clientX - r.left,
        y = t.clientY - r.top;
      const still = Math.hypot(x - touch.x, y - touch.y) < 10 && Date.now() - touch.t < 350;
      touch = null;
      if (!still) return;
      clearTimeout(tapTimer);
      if (Date.now() - lastTap < 320) {
        lastTap = 0;
        void viewer.moveDir(NavigationDirection.StepForward).catch(() => undefined);
        return;
      }
      lastTap = Date.now();
      tapTimer = window.setTimeout(() => goTo(x, y), 320);
    };
    el.addEventListener('touchstart', tStart, { passive: true });
    el.addEventListener('touchend', tEnd, { passive: true });
    viewer.on('position', report);
    viewer.on('pov', report);
    viewer.on('fov', report);
    // The viewer opens the photo from its imageId option; one that has not shown in 12 seconds counts as failed
    // (photos usually show in under 4).
    const watchdog = window.setTimeout(() => {
      if (gone || !first) return;
      console.warn('Street photo could not be opened: no image after 12 seconds.');
      cbs.current.onError();
    }, 12000);
    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(el);
    return () => {
      gone = true;
      clearTimeout(watchdog);
      clearTimeout(settle);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(cursorFrame);
      clearTimeout(tapTimer);
      el.removeEventListener('touchstart', tStart);
      el.removeEventListener('touchend', tEnd);
      ro.disconnect();
      viewer.remove();
      viewerRef.current = null;
      rendererRef.current = null;
    };
    // The viewer is made once per photo search; zoning and the parcel are passed on below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, photo.id]);

  useEffect(() => rendererRef.current?.setVisible(showZoning), [showZoning]);

  // Keys: W or the up arrow forward, S or down back, A and D turn (the arrows inside the photo are the viewer's own).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable || box.current?.contains(t))) return;
      const v = viewerRef.current;
      if (!v || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') void v.moveDir(NavigationDirection.StepForward).catch(() => undefined);
      else if (k === 's' || k === 'arrowdown') void v.moveDir(NavigationDirection.StepBackward).catch(() => undefined);
      else if (k === 'a' || k === 'd' || k === 'arrowleft' || k === 'arrowright') void v.getCenter().then((c) => v.setCenter([(((c[0] + (k === 'a' || k === 'arrowleft' ? -0.04 : 0.04)) % 1) + 1) % 1, c[1]]));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => rendererRef.current?.setParcel(parcel), [parcel]);

  const takenLabel = taken ? new Date(taken).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const current = dates.find((d) => d.photo.id === shown)?.day ?? (taken ? new Date(taken).toISOString().slice(0, 10) : '');

  return (
    <div className="vc-svp-view" data-image={shown}>
      <div ref={box} className="vc-svp-canvas" role="img" aria-label="Street photo facing the pin. Drag to look around; use the arrows to move along the street." />
      {pinAt && <span className="vc-svp-pin" style={{ left: pinAt[0], top: pinAt[1] }} role="img" aria-label="The pin is here in the photo" />}
      <div className="vc-svp-when">
        {dates.length > 1 ? (
          <label>
            <span className="vc-sr">Photo date</span>
            <select value={current} onChange={(e) => go(dates.find((d) => d.day === e.target.value)?.photo.id ?? '')} aria-label="Dates: photos taken here on other days">
              {dates.map((d) => (
                <option key={d.day} value={d.day}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          takenLabel && <span>Taken {takenLabel}</span>
        )}
      </div>
      {/* Phones only (the photo is full screen): beside the map, the map itself shows the person and cone. */}
      {!wide && (
        <div className="vc-svp-mini">
          <MiniMap token={token} camera={camera} dark={dark} onPick={(p, at) => (p ? go(p.id) : goToward(at))} />
        </div>
      )}
      {showZoning && (
        <div className="vc-svp-chips" aria-hidden="true">
          {chips.map((c) => (
            <span key={c.zone} className="vc-svp-chip" style={{ left: c.x, top: c.y }}>
              <i style={{ background: c.color }} />
              {c.zone}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
