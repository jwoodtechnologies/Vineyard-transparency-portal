/**
 * Basemaps for /map, built so the streets map draws as soon
 * as possible:
 *  - the OpenFreeMap style and its tile index (TileJSON) are fetched at the same time, not one after
 *    the other, and the tile index is written into the style so MapLibre makes no extra round trip;
 *  - the result is kept for the session, so theme switches and revisits draw at once;
 *  - every style has a background layer, and the map box uses the same color while loading, so
 *    there is never a blank grey box.
 * Satellite is Utah County's newest aerial imagery (3 and 6 inch photography), with the USGS
 * imagery service as a fallback if the county service does not answer. The county service draws
 * each tile on request, so high density screens get 512 pixel images for the same 256 pixel tile.
 */
import type * as maplibregl from 'maplibre-gl';

export const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const OFM = 'https://tiles.openfreemap.org';
const STREETS = (dark: boolean) => `${OFM}/styles/${dark ? 'dark' : 'positron'}`;
/** The tile index both OpenFreeMap styles point at. */
const OFM_TILEJSON = `${OFM}/planet`;

/** Background colors of each basemap, used for the map box while it loads. */
export const BASE_BG = { streetsLight: '#f2f3f0', streetsDark: '#0e0e10', satellite: '#1f2427', blankLight: '#ffffff', blankDark: '#0a0a0b' };
export const streetsBg = (dark: boolean) => (dark ? BASE_BG.streetsDark : BASE_BG.streetsLight);

const COUNTY_IMAGERY = (px: number) => `https://gisaerials.utahcounty.gov/arcgis/rest/services/NewestImagery/NewestImagery_WGS84/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpgpng&f=image`;
/**
 * Image size and deepest tile zoom asked of the county service. The finest county photos are 3 inch
 * (about 0.08 m); a 256 pixel tile at tile zoom 20 (map zoom 19) is about 0.11 m per pixel in
 * Vineyard, so 512 pixel images at tile zoom 20 (high density screens) or 256 pixel images up to
 * tile zoom 21 reach that detail. Past it MapLibre enlarges the last tiles smoothly.
 */
function countyTiles(): { px: number; maxzoom: number } {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return dpr >= 1.5 ? { px: 512, maxzoom: 20 } : { px: 256, maxzoom: 21 };
}
/** The county aerial as the street scene reads it for roof colours (scene/aerial.ts): the address template and tile size. */
export function countyAerial(): { template: string; px: number } {
  const { px } = countyTiles();
  return { template: COUNTY_IMAGERY(px), px };
}
const USGS_IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const USGS_ATTR = '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>';

/** Utah County aerials, with the USGS layer hidden underneath until it is needed (see watchSatellite). */
export function satelliteStyle(): maplibregl.StyleSpecification {
  const { px, maxzoom } = countyTiles();
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      county: { type: 'raster', tiles: [COUNTY_IMAGERY(px)], tileSize: 256, minzoom: 0, maxzoom, attribution: 'Imagery: Utah County GIS' },
      usgs: { type: 'raster', tiles: [USGS_IMAGERY], tileSize: 256, maxzoom: 16, attribution: `Imagery: ${USGS_ATTR}` },
    },
    layers: [
      { id: 'sat-bg', type: 'background', paint: { 'background-color': BASE_BG.satellite } },
      { id: 'sat-usgs', type: 'raster', source: 'usgs', layout: { visibility: 'none' } },
      { id: 'sat-county', type: 'raster', source: 'county' },
    ],
  };
}

export function blankStyle(dark: boolean): maplibregl.StyleSpecification {
  return { version: 8, glyphs: GLYPHS, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': dark ? BASE_BG.blankDark : BASE_BG.blankLight } }] };
}

/**
 * If the county imagery service fails before any of its tiles has loaded (three errors, or nothing at all
 * within 7 seconds, as when its requests are refused without an error the map hears), show the USGS imagery
 * instead (same map, no reload). Call right after creating a map with satelliteStyle().
 */
export function watchSatellite(map: maplibregl.Map): void {
  let ok = false;
  let failures = 0;
  const useUsgs = () => {
    if (ok) return;
    ok = true; // switch once
    try {
      map.setLayoutProperty('sat-usgs', 'visibility', 'visible');
      map.setLayoutProperty('sat-county', 'visibility', 'none');
    } catch {
      /* style replaced meanwhile */
    }
  };
  const timer = setTimeout(useUsgs, 7000);
  map.on('sourcedata', (e) => {
    // One county tile actually drawn is enough (a slow service still counts as working).
    if (e.sourceId === 'county' && (e as { tile?: { state?: string } }).tile?.state === 'loaded') {
      ok = true;
      clearTimeout(timer);
    }
  });
  map.on('error', (e) => {
    const src = (e as { sourceId?: string }).sourceId;
    if (ok || src !== 'county' || ++failures < 3) return;
    clearTimeout(timer);
    useUsgs();
  });
  map.once('remove', () => clearTimeout(timer));
}

type Json = Record<string, unknown>;
const styles = new Map<string, Promise<maplibregl.StyleSpecification>>();
const tileJsons = new Map<string, Promise<Json | null>>();

function getJsonWithin(url: string, ms: number): Promise<Json> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = setTimeout(() => ctl?.abort(), ms);
  return fetch(url, { signal: ctl?.signal, credentials: 'omit' })
    .then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json() as Promise<Json>;
    })
    .finally(() => clearTimeout(t));
}

function tileJson(url: string): Promise<Json | null> {
  let p = tileJsons.get(url);
  if (!p) {
    p = getJsonWithin(url, 10000).catch(() => {
      tileJsons.delete(url);
      return null;
    });
    tileJsons.set(url, p);
  }
  return p;
}

/**
 * The OpenFreeMap streets style with its tile index written in. Rejects if the style cannot be
 * loaded within 10 seconds (callers then draw on a plain background).
 */
export function streetsStyle(dark: boolean): Promise<maplibregl.StyleSpecification> {
  const url = STREETS(dark);
  let p = styles.get(url);
  if (p) return p;
  // Both requests leave at once; the style names the tile index, which is almost always this one.
  void tileJson(OFM_TILEJSON);
  p = getJsonWithin(url, 10000)
    .then(async (style) => {
      const sources = (style.sources ?? {}) as Record<string, Json>;
      await Promise.all(
        Object.entries(sources).map(async ([id, src]) => {
          if (typeof src.url !== 'string' || src.tiles) return;
          const tj = await tileJson(src.url);
          if (!tj || !Array.isArray(tj.tiles)) return; // MapLibre fetches it itself
          const { url: _u, ...rest } = src;
          void _u;
          // Same merge MapLibre does when it reads the tile index itself: the index's values win.
          sources[id] = { ...rest, ...pick(tj, ['minzoom', 'maxzoom', 'bounds', 'scheme', 'attribution', 'encoding']), tiles: tj.tiles };
        }),
      );
      return style as unknown as maplibregl.StyleSpecification;
    })
    .catch((e: unknown) => {
      styles.delete(url);
      throw e;
    });
  styles.set(url, p);
  return p;
}

/* Outlines: a bright line over a dark casing, so shapes read at a glance on streets and imagery. */

/** The casing drawn under every outline. */
export const CASING = { color: '#000000', opacity: 0.6 } as const;

/** A line width that grows with zoom: [[zoom, width], ...]. */
export function byZoom(stops: Array<[number, number]>): maplibregl.ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as unknown as maplibregl.ExpressionSpecification;
}

/**
 * The basemap's first label layer: overlays go just under it, so outlines sit above the map but
 * below street and place names. Undefined for a basemap with no labels (imagery).
 */
export function firstLabelLayer(map: maplibregl.Map, isOverlay: (id: string) => boolean): string | undefined {
  return (map.getStyle()?.layers ?? []).find((l) => l.type === 'symbol' && !isOverlay(l.id))?.id;
}

function pick(o: Json, keys: string[]): Json {
  const out: Json = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

/**
 * Calls `done` once the basemap has drawn its first screen of tiles (or the map is idle, or 15
 * seconds have passed, so a loading notice never stays up for good). Returns a cancel function.
 */
export function whenBasePainted(map: maplibregl.Map, done: () => void): () => void {
  let fired = false;
  let baseIds: string[] = [];
  const finish = () => {
    if (fired) return;
    fired = true;
    clearTimeout(cap);
    map.off('idle', finish);
    map.off('sourcedata', onData);
    done();
  };
  const loadedAll = () =>
    baseIds.every((id) => {
      try {
        return map.isSourceLoaded(id);
      } catch {
        return true;
      }
    });
  const onData = (e: maplibregl.MapSourceDataEvent) => {
    if (!baseIds.length || !e.tile || !baseIds.includes(e.sourceId)) return;
    if (loadedAll()) finish();
  };
  const cap = setTimeout(finish, 15000);
  const start = () => {
    // Sources present when the style loads are the basemap's; overlays are added later.
    const style = map.getStyle();
    baseIds = Object.keys(style?.sources ?? {}).filter((id) => !id.startsWith('vtp-') && id !== 'plans');
    if (!baseIds.length) finish();
  };
  if (map.isStyleLoaded()) start();
  else map.once('style.load', start);
  map.on('sourcedata', onData);
  map.on('idle', finish);
  return () => {
    fired = true;
    clearTimeout(cap);
    map.off('idle', finish);
    map.off('sourcedata', onData);
  };
}
