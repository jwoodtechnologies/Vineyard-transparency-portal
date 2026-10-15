/**
 * The ground spot a click or tap in the 3D view means (street view and Drive mode): on a raised building,
 * the middle of that building's footprint, so its zone or project is the one under it, not the ground behind
 * it; elsewhere the ground at that point. MapLibre reports rendered buildings only on a flat map, so on
 * tilted terrain the line of sight is walked against the buildings' footprints and heights (rayPick.ts).
 */
import type * as maplibregl from 'maplibre-gl';
import { OMT_UNKNOWN_M, UNKNOWN_M } from './heights';
import { firstHit, middle, type Box } from './rayPick';
import { FULL_DETAIL_Z, tileZoom } from './threeD';

type Pos = [number, number];

/** The raised buildings of the 3D view (threeD.ts): the recorded heights over the plain ones. */
const LAYERS = ['vtp-sv-buildings-h', 'vtp-sv-buildings'];

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** The buildings loaded near the line from `a` to `b` (a box around it), as footprints with heights. */
function boxesNear(map: maplibregl.Map, a: Pos, b: Pos): Box[] {
  const pad = 0.0006;
  const w = Math.min(a[0], b[0]) - pad,
    e = Math.max(a[0], b[0]) + pad,
    s = Math.min(a[1], b[1]) - pad,
    n = Math.max(a[1], b[1]) + pad;
  const out: Box[] = [];
  for (const id of LAYERS) {
    const layer = map.getLayer(id) as unknown as { source?: string; sourceLayer?: string } | undefined;
    if (!layer?.source || map.getLayoutProperty(id, 'visibility') === 'none') continue;
    const recorded = id.endsWith('-h');
    const feats = map.querySourceFeatures(layer.source, layer.sourceLayer ? { sourceLayer: layer.sourceLayer } : undefined);
    for (const f of feats) {
      if (!recorded && tileZoom(f) < FULL_DETAIL_Z) continue;
      const g = f.geometry;
      const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map((p) => p[0]) : [];
      const p = f.properties ?? {};
      const top = recorded ? num(p.h, UNKNOWN_M) : (() => {
        const h = num(p.render_height, NaN);
        return Number.isFinite(h) && h !== OMT_UNKNOWN_M ? h : UNKNOWN_M;
      })();
      const base = recorded ? num(p.b, 0) : num(p.render_min_height, 0);
      for (const r of rings) {
        const ring = r as Pos[];
        if (!ring?.length) continue;
        const [x, y] = ring[0];
        if (x < w || x > e || y < s || y > n) continue;
        out.push({ ring, base, top });
      }
    }
  }
  return out;
}

/**
 * Where the camera is: [lng, lat, meters above sea level]. It looks at the map's center from the distance
 * that gives the zoom (MapLibre's 512 px tiles and vertical field of view), tilted by the pitch.
 */
export function cameraAt(map: maplibregl.Map): [number, number, number] {
  const c = map.getCenter();
  const fov = (map.getVerticalFieldOfView() * Math.PI) / 180;
  const metersPerPx = (40075016.686 * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const d = ((0.5 * map.getCanvas().clientHeight) / Math.tan(fov / 2)) * metersPerPx;
  const pitch = (map.getPitch() * Math.PI) / 180;
  const back = ((map.getBearing() + 180) * Math.PI) / 180;
  const run = d * Math.sin(pitch);
  return [c.lng + (run * Math.sin(back)) / (111320 * Math.cos((c.lat * Math.PI) / 180)), c.lat + (run * Math.cos(back)) / 110540, map.getCenterElevation() + d * Math.cos(pitch)];
}

export function groundUnder(map: maplibregl.Map, x: number, y: number): maplibregl.LngLat {
  const ll = map.unproject([x, y]);
  try {
    const eye = cameraAt(map);
    const alt = map.queryTerrainElevation(ll) ?? 0;
    const boxes = boxesNear(map, [eye[0], eye[1]], [ll.lng, ll.lat]);
    const hit = firstHit(eye, [ll.lng, ll.lat, alt], boxes);
    if (!hit) return ll;
    const [lng, lat] = middle(hit.ring);
    return new (ll.constructor as typeof maplibregl.LngLat)(lng, lat);
  } catch {
    return ll;
  }
}
