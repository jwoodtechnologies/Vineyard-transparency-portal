/**
 * The small map in the corner of the street photo viewer: the blue street photo lines and the camera cone,
 * following the camera. Tapping a street with photos on it jumps there. Part of the viewer's chunk.
 */
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { satelliteStyle, watchSatellite } from '../mapBase';
import { addCoverage, lineNear, photoNear } from './coverage';
import { watchTaps } from './watchTaps';
import type { Photo, Pos } from './geo';
import { addSvLayers, drawSv, type Camera } from './mapDraw';

interface Props {
  token: string;
  camera: Camera | null;
  /** Kept for a future streets style; the small map uses the aerial photos in both themes. */
  dark?: boolean;
  onPick: (photo: Photo | null, at: Pos) => void;
}

export function MiniMap({ token, camera, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pick = useRef(onPick);
  const cam = useRef(camera);
  useEffect(() => {
    pick.current = onPick;
    cam.current = camera;
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let gone = false;
    let map: maplibregl.Map | null = null;
    // The county's aerial photos: ready at once (no style to fetch) and easy to match with the street photo.
    void Promise.resolve(satelliteStyle()).then((style) => {
      if (gone || !box.current) return;
      const c = cam.current?.pos ?? [-111.745, 40.305];
      map = new maplibregl.Map({ container: el, style, center: c, zoom: 17, attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 19, minZoom: 12 });
      map.touchZoomRotate.disableRotation();
      // Where the county's aerials have no tile, the USGS imagery shows instead, never an empty box.
      watchSatellite(map);
      // No (i) here: the viewer's credit line below names the photos and the aerial imagery.
      mapRef.current = map;
      map.on('load', () => {
        if (!map) return;
        addCoverage(map, token);
        addSvLayers(map);
        drawSv(map, cam.current, null);
      });
      // Only a deliberate click or tap picks a photo, never the end of a pan or pinch (tapGuard.ts).
      watchTaps(map.getCanvasContainer(), ({ x, y }) => {
        if (!map) return;
        const photo = photoNear(map, { x, y }, 24);
        const line = photo ? null : lineNear(map, { x, y }, 16);
        if (photo || line) pick.current(photo, photo ? photo.pos : line!.at);
      });
    });
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => {
      gone = true;
      ro.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, [token]);

  // The cone follows the camera; the map keeps it in view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera || !map.isStyleLoaded()) return;
    drawSv(map, camera, null);
    const p = map.project(camera.pos);
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const margin = 0.4;
    if (p.x < w * margin || p.x > w * (1 - margin) || p.y < h * margin || p.y > h * (1 - margin)) map.easeTo({ center: camera.pos, duration: 300 });
  }, [camera]);

  return <div ref={box} className="vc-svp-mini-map" role="img" aria-label="Small map: the cone shows where the photo looks. Tap a street to go there." />;
}
