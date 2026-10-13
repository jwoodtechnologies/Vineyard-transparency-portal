/**
 * The street photo viewer (MapillaryJS), loaded on demand as its own chunk so /map stays light. Opens a
 * photo turned to face the pin with the pin marked in it, draws zoning districts and the parcel under
 * the pin on the ground (zoningRenderer.ts) with a small label chip per district, and reports where the
 * camera is and which way it looks so the map's camera cone follows.
 */
import { useEffect, useRef, useState } from 'react';
import { MarkerComponent, SimpleMarker, Viewer, type Image as MlyImage } from 'mapillary-js';
import 'mapillary-js/dist/mapillary.css';
import { distance } from '../measure/geo';
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

/** Where a district's chip goes: inside the district, a little way in from its edge nearest the camera. */
function chipPoint(ring: Pos[], cam: Pos): Pos {
  if (inRing(cam, ring)) return cam;
  let best = ring[0];
  for (const p of ring) if (distance(p, cam) < distance(best, cam)) best = p;
  const c = ringCentroid(ring);
  for (const t of [0.15, 0.3, 0.5, 0.8]) {
    const q: Pos = [best[0] + (c[0] - best[0]) * t, best[1] + (c[1] - best[1]) * t];
    if (inRing(q, ring) && distance(q, cam) > 6) return q;
  }
  return c;
}

export default function PhotoViewer({ token, photo, pin, districts, parcel, showZoning, onCamera, onError }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const rendererRef = useRef<ZoningRenderer | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const cbs = useRef({ onCamera, onError });
  const cam = useRef<Pos>(photo.pos);
  useEffect(() => {
    cbs.current = { onCamera, onError };
  });

  // One viewer per photo search; moving along the street happens inside it.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const viewer = new Viewer({ accessToken: token, container: el, imageId: photo.id, component: { cover: false, marker: true, attribution: true, direction: true, sequence: true, keyboard: true, zoom: true } });
    viewerRef.current = viewer;
    const renderer = new ZoningRenderer(districts, parcel);
    viewer.addCustomRenderer(renderer);
    rendererRef.current = renderer;
    const markers = viewer.getComponent('marker') as MarkerComponent;
    markers.add([new SimpleMarker('pin', { lng: pin[0], lat: pin[1] }, { ballColor: '#ff5a1f', color: '#ff5a1f', interactive: false })]);
    let first = true;
    let frame = 0;
    let gone = false;
    const placeChips = () => {
      const near = districts
        .flatMap((d) => d.rings.map((r) => ({ d, r, at: chipPoint(r, cam.current) })))
        .filter((x) => distance(x.at, cam.current) < 250)
        .sort((a, b) => distance(a.at, cam.current) - distance(b.at, cam.current))
        .slice(0, 5);
      Promise.all(near.map((x) => viewer.project({ lng: x.at[0], lat: x.at[1] }).catch(() => null))).then((px) => {
        if (gone) return;
        const seen = new Set<string>();
        const out: Chip[] = [];
        px.forEach((p, i) => {
          const z = near[i].d.zone;
          if (!p || seen.has(z)) return;
          seen.add(z);
          out.push({ zone: z, color: near[i].d.color, x: p[0], y: p[1] });
        });
        setChips(out);
      });
    };
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        Promise.all([viewer.getPosition(), viewer.getPointOfView(), viewer.getFieldOfView()]).then(
          ([pos, pov, fov]) => {
            if (gone) return;
            cam.current = [pos.lng, pos.lat];
            cbs.current.onCamera({ pos: [pos.lng, pos.lat], bearing: pov.bearing, fov });
            placeChips();
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
    viewer.moveTo(photo.id).catch(() => !gone && cbs.current.onError());
    const ro = new ResizeObserver(() => viewer.resize());
    ro.observe(el);
    return () => {
      gone = true;
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
