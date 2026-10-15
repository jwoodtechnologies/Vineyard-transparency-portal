/**
 * Where street photos exist: Mapillary's public vector tiles (mly1_public) drawn as blue lines on the
 * map, with the photo spots as dots when close in. Used to show coverage, to highlight the line under the
 * pointer or the dragged person, to show a photo thumbnail on hover, and to turn a tap or drop near a line
 * into the photo there. The tiles take the same client token as the viewer (GET /api/streetview/config).
 */
import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import { getJson } from '../api';
import { distance, nearestOnSegment } from '../measure/geo';
import { PREFER_BAND_M, preferOrder, type Photo, type Pos } from './geo';

export const COVERAGE_SRC = 'vtp-mly';
const LINE = 'vtp-mly-seq';
const LINE_HI = 'vtp-mly-seq-hi';
const DOTS = 'vtp-mly-img';
export const COVERAGE_BLUE = '#1a73e8';

let configPromise: Promise<{ token: string | null; google: boolean }> | null = null;
/** GET /api/streetview/config (asked once a visit): the Mapillary client token, and whether Google Street View can be opened. */
export function streetviewConfig(): Promise<{ token: string | null; google: boolean }> {
  configPromise ??= getJson<{ token: string | null; google?: boolean }>('/api/streetview/config').then(
    (r) => ({ token: typeof r.token === 'string' && r.token ? r.token : null, google: r.google === true }),
    () => {
      configPromise = null;
      return { token: null, google: false };
    },
  );
  return configPromise;
}

/** The Mapillary client token, or null when not set. */
export const mapillaryToken = (): Promise<string | null> => streetviewConfig().then((c) => c.token);

export const tilesUrl = (token: string) => `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`;

export function addCoverage(map: maplibregl.Map, token: string): void {
  if (map.getSource(COVERAGE_SRC)) return;
  map.addSource(COVERAGE_SRC, { type: 'vector', tiles: [tilesUrl(token)], minzoom: 6, maxzoom: 14, attribution: '<a href="https://www.mapillary.com" target="_blank" rel="noopener">Mapillary</a>' });
  // Under the street view pin and cone, over the city's layers.
  const before = map.getLayer('vtp-sv-parcel') ? 'vtp-sv-parcel' : undefined;
  const width = ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 18, 6] as unknown as number;
  map.addLayer(
    { id: LINE, type: 'line', source: COVERAGE_SRC, 'source-layer': 'sequence', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COVERAGE_BLUE, 'line-width': width, 'line-opacity': 0.85 } },
    before,
  );
  map.addLayer(
    {
      id: LINE_HI,
      type: 'line',
      source: COVERAGE_SRC,
      'source-layer': 'sequence',
      filter: ['==', ['get', 'id'], ''],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0b57d0', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 18, 11] as unknown as number },
    },
    before,
  );
  map.addLayer(
    { id: DOTS, type: 'circle', source: COVERAGE_SRC, 'source-layer': 'image', minzoom: 16, paint: { 'circle-radius': 3.5, 'circle-color': '#ffffff', 'circle-stroke-color': COVERAGE_BLUE, 'circle-stroke-width': 2 } },
    before,
  );
}

export function removeCoverage(map: maplibregl.Map): void {
  for (const id of [DOTS, LINE_HI, LINE]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(COVERAGE_SRC)) map.removeSource(COVERAGE_SRC);
}

export function setHighlight(map: maplibregl.Map, sequence: string | null): void {
  if (map.getLayer(LINE_HI)) map.setFilter(LINE_HI, ['==', ['get', 'id'], sequence ?? '']);
}

const box = (p: { x: number; y: number }, r: number): [[number, number], [number, number]] => [
  [p.x - r, p.y - r],
  [p.x + r, p.y + r],
];

/**
 * The photo spot at a screen point, within `r` pixels (photo dots exist from zoom 14 in the tiles). Among
 * spots about as near as the nearest, a 360 degree photo comes first, then the newest day (as rankPhotos).
 */
export function photoNear(map: maplibregl.Map, p: { x: number; y: number }, r = 28): Photo | null {
  if (!map.getLayer(DOTS)) return null;
  // The dots layer draws from zoom 16, but its tiles are there from 14: query the source's features directly.
  const feats = map.querySourceFeatures(COVERAGE_SRC, { sourceLayer: 'image' });
  if (!feats.length) return null;
  const at = map.unproject([p.x, p.y]);
  const ll: Pos = [at.lng, at.lat];
  const edge = map.unproject([p.x + r, p.y]);
  const maxM = distance(ll, [edge.lng, edge.lat]);
  const near: Array<{ p: Photo; score: number }> = [];
  const seen = new Set<string>();
  for (const f of feats) {
    if (f.geometry.type !== 'Point') continue;
    const d = distance(ll, f.geometry.coordinates as Pos);
    const q = f.properties ?? {};
    const id = String(q.id);
    if (d > maxM || seen.has(id)) continue;
    seen.add(id);
    const compass = Number(q.compass_angle);
    near.push({
      score: d,
      p: { id, pos: f.geometry.coordinates as Pos, compass: Number.isFinite(compass) ? compass : null, pano: q.is_pano === true || q.is_pano === 1, capturedAt: Number(q.captured_at) || null },
    });
  }
  if (!near.length) return null;
  const best = Math.min(...near.map((x) => x.score));
  return near.filter((x) => x.score <= best + PREFER_BAND_M).sort(preferOrder)[0].p;
}

/** The blue line under a screen point (within `r` pixels): its sequence id and the nearest point on it. */
export function lineNear(map: maplibregl.Map, p: { x: number; y: number }, r = 16): { sequence: string; image: string | null; at: Pos; meters: number } | null {
  if (!map.getLayer(LINE)) return null;
  const feats = map.queryRenderedFeatures(box(p, r), { layers: [LINE] });
  const c = map.unproject([p.x, p.y]);
  const here: Pos = [c.lng, c.lat];
  let best: { sequence: string; image: string | null; at: Pos; meters: number } | null = null;
  for (const f of feats) {
    const g = f.geometry;
    const lines = (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []) as Pos[][];
    for (const l of lines)
      for (let i = 1; i < l.length; i++) {
        const n = nearestOnSegment(here, l[i - 1], l[i]);
        if (!best || n.d < best.meters) best = { sequence: String(f.properties?.id ?? ''), image: f.properties?.image_id != null ? String(f.properties.image_id) : null, at: n.at, meters: n.d };
      }
  }
  return best;
}

/** A point snapped onto the nearest blue line when one is within `maxM` meters, else the point itself. */
export function snapToLine(map: maplibregl.Map, at: Pos, maxM = 25): Pos {
  const p = map.project(at);
  const edge = map.unproject([p.x + 1, p.y]);
  const mPerPx = Math.max(0.05, distance(at, [edge.lng, edge.lat]));
  const hit = lineNear(map, p, Math.min(60, maxM / mPerPx));
  return hit && hit.meters <= maxM ? hit.at : at;
}

const thumbs = new Map<string, Promise<string | null>>();
/** A small photo for a spot (Graph API thumb_256_url), asked once per photo. */
export function thumbnail(token: string, id: string): Promise<string | null> {
  let t = thumbs.get(id);
  if (!t) {
    t = fetch(`https://graph.mapillary.com/${encodeURIComponent(id)}?access_token=${encodeURIComponent(token)}&fields=thumb_256_url`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { thumb_256_url?: string } | null) => (b?.thumb_256_url && /^https:\/\/[a-z0-9.-]+\.fbcdn\.net\//.test(b.thumb_256_url) ? b.thumb_256_url : null))
      .catch(() => null);
    thumbs.set(id, t);
  }
  return t;
}

/**
 * Shows the blue lines while `visible`, and on a mouse, a thumbnail of the photo nearest the pointer when
 * it rests on a line. Returns nothing; the map page passes whether coverage is wanted.
 */
export function useCoverage(getMap: () => maplibregl.Map | null, gen: number, ready: boolean, visible: boolean): void {
  const tip = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const map = getMap();
    if (!map || !ready || !visible) return;
    let gone = false;
    let frame = 0;
    let last = '';
    const hideTip = () => {
      if (tip.current) tip.current.hidden = true;
    };
    const move = (e: maplibregl.MapMouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = lineNear(map, e.point, 12);
        setHighlight(map, line?.sequence ?? null);
        map.getCanvas().style.cursor = line ? 'pointer' : '';
        // The photo at that spot, or (zoomed out, where the tiles carry no spots) the line's own key photo.
        const spot = line ? photoNear(map, e.point, 40) : null;
        const photo = spot ?? (line?.image ? { id: line.image, pos: line.at, compass: null, pano: false, capturedAt: null } : null);
        if (!photo) {
          last = '';
          return hideTip();
        }
        if (photo.id === last) return;
        last = photo.id;
        void mapillaryToken()
          .then((t) => (t ? thumbnail(t, photo.id) : null))
          .then((url) => {
            if (!url) console.info('Street photo thumbnail: none for', photo.id);
            if (gone || last !== photo.id || !url) return;
            if (!tip.current) {
              const el = document.createElement('div');
              el.className = 'vc-mly-tip';
              el.innerHTML = '<img alt="" /><span></span>';
              map.getContainer().appendChild(el);
              tip.current = el;
            }
            const el = tip.current;
            el.hidden = false;
            (el.querySelector('img') as HTMLImageElement).src = url;
            el.querySelector('span')!.textContent = photo.capturedAt ? new Date(photo.capturedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Street photo';
            el.style.left = `${e.point.x}px`;
            el.style.top = `${e.point.y}px`;
          });
      });
    };
    const leave = () => {
      setHighlight(map, null);
      hideTip();
    };
    void mapillaryToken().then((t) => {
      if (gone || !t) return;
      addCoverage(map, t);
      // Mouse pointers only (a phone has no hover): the thumbnail on a line.
      if (!window.matchMedia?.('(pointer: coarse)').matches) {
        map.on('mousemove', move);
        map.on('mouseout', leave);
      }
    });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      map.off('mousemove', move);
      map.off('mouseout', leave);
      tip.current?.remove();
      tip.current = null;
      try {
        map.getCanvas().style.cursor = '';
        removeCoverage(map);
      } catch {
        // Map removed.
      }
    };
  }, [getMap, gen, ready, visible]);
}
