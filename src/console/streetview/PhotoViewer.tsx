/**
 * The street photo viewer (MapillaryJS), loaded on demand as its own chunk so /map stays light. Opens a
 * photo turned to face the pin with the pin marked in it, draws zoning districts and the parcel under
 * the pin on the ground (zoningRenderer.ts) with a small label chip per district, and reports where the
 * camera is and which way it looks so the map's camera cone follows.
 */
import { useEffect, useRef, useState } from 'react';
import { Viewer, type Image as MlyImage } from 'mapillary-js';
import 'mapillary-js/dist/mapillary.css';
import { destination, distance } from '../measure/geo';
import { centerOnPin, type Photo, type Pos } from './geo';
import type { Camera } from './mapDraw';
import { inRing, ZoningRenderer, type District } from './zoningRenderer';

interface Props {
  token: string;
  photo: Photo;
  pin: Pos;
  districts: District[];
  parcel: Pos[] | null;
  showZoning: boolean;
  onCamera: (c: Camera) => void;
  onError: () => void;
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

export default function PhotoViewer({ token, photo, pin, districts, parcel, showZoning, onCamera, onError }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const rendererRef = useRef<ZoningRenderer | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  // Where the pin is in the photo, in pixels, or null when it is out of frame.
  const [pinAt, setPinAt] = useState<[number, number] | null>(null);
  const cbs = useRef({ onCamera, onError });
  const cam = useRef<Pos>(photo.pos);
  const look = useRef(0);
  useEffect(() => {
    cbs.current = { onCamera, onError };
  });

  // One viewer per photo search; moving along the street happens inside it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const viewer = new Viewer({ accessToken: token, container: el, imageId: photo.id, component: { cover: false, marker: false, attribution: true, direction: true, sequence: true, keyboard: true, zoom: true } });
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
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        Promise.all([viewer.getPosition(), viewer.getPointOfView(), viewer.getFieldOfView()]).then(
          ([pos, pov, fov]) => {
            if (gone) return;
            cam.current = [pos.lng, pos.lat];
            look.current = pov.bearing;
            cbs.current.onCamera({ pos: [pos.lng, pos.lat], bearing: pov.bearing, fov });
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
      if (first) {
        first = false;
        const pano = /spherical|equirectangular/.test(img.cameraType);
        viewer.setCenter(centerOnPin({ ...photo, pos: [ll.lng, ll.lat], pano, compass: img.computedCompassAngle ?? img.compassAngle ?? photo.compass }, pin));
      }
      report();
    });
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
      ro.disconnect();
      viewer.remove();
      viewerRef.current = null;
      rendererRef.current = null;
    };
    // The viewer is made once per photo search; zoning and the parcel are passed on below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, photo.id]);

  useEffect(() => rendererRef.current?.setVisible(showZoning), [showZoning]);
  useEffect(() => rendererRef.current?.setParcel(parcel), [parcel]);

  return (
    <div className="vc-svp-view">
      <div ref={box} className="vc-svp-canvas" role="img" aria-label="Street photo facing the pin. Drag to look around; use the arrows to move along the street." />
      {pinAt && <span className="vc-svp-pin" style={{ left: pinAt[0], top: pinAt[1] }} role="img" aria-label="The pin is here in the photo" />}
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
