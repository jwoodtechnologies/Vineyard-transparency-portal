/**
 * Scenery for the street level 3D view: a light snowcap on the high Wasatch, and Utah Lake and the harbors
 * drawn as open water instead of the green the aerial photos show. Both lie between the aerial photos and
 * the hillshade, so the slopes keep their shading and the photo shows through.
 *
 * The snow is a color relief from the same elevation tiles as the terrain: clear below SNOW_START, then
 * patchy from about 2,550 m and solid white from about 2,850 m (Timpanogos's summit ridge and upper bowls, and
 * the tops of Cascade and Provo Peak). The tiles are about 30 m apart, so the edge
 * is soft on its own. The water is OpenFreeMap's water shapes in a natural lake blue that covers most of
 * the green in the aerial photos. (No blurred shore line: the shapes are cut at tile edges, and a line along
 * them drew seams across the lake.)
 */
import type * as maplibregl from 'maplibre-gl';

/** Where snow starts to show, in meters (patchy up to SNOW_FULL). */
export const SNOW_START = 2550;
/** Where it is solid, bright white, in meters (Timpanogos's summit is 3,582 m; its upper bowls are 3,000 to 3,400). */
export const SNOW_FULL = 2850;

export const SNOW_LAYER = 'vtp-sv-snow';
export const WATER_LAYER = 'vtp-sv-water';
export const WATER_EDGE = 'vtp-sv-water-edge';

/** A natural lake blue, not a bright map blue: Utah Lake's open water seen from the shore on a clear day. */
export const WATER_COLOR = '#4f7f9c';

/**
 * Pure white (no grey or blue cast), clear below SNOW_START, then rising and falling a little with height so
 * the lower snow lies in patches along the slopes, solid from SNOW_FULL up. The hillshade drawn over it keeps
 * the ridges and gullies readable.
 */
export const snowColor = (): maplibregl.ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['elevation'],
  SNOW_START,
  'rgba(255, 255, 255, 0)',
  2610,
  'rgba(255, 255, 255, 0.4)',
  2660,
  'rgba(255, 255, 255, 0.25)',
  2730,
  'rgba(255, 255, 255, 0.75)',
  2790,
  'rgba(255, 255, 255, 0.6)',
  SNOW_FULL,
  'rgba(255, 255, 255, 0.98)',
  2950,
  'rgba(255, 255, 255, 1)',
];

/** Lakes, ponds, docks and harbors; not swimming pools. */
export const WATER_FILTER: maplibregl.FilterSpecification = ['!=', ['get', 'class'], 'swimming_pool'];

/** `vector` is null on the streets map, which already draws water. */
export function addScenery(map: maplibregl.Map, dem: string, vector: string | null, before: string | undefined): void {
  if (vector && !map.getLayer(WATER_LAYER))
    map.addLayer(
      { id: WATER_LAYER, type: 'fill', source: vector, 'source-layer': 'water', filter: WATER_FILTER, paint: { 'fill-color': WATER_COLOR, 'fill-opacity': 0.85, 'fill-antialias': true } },
      before,
    );
  if (!map.getLayer(SNOW_LAYER)) map.addLayer({ id: SNOW_LAYER, type: 'color-relief', source: dem, paint: { 'color-relief-color': snowColor(), 'color-relief-opacity': 1 } }, before);
}

export function removeScenery(map: maplibregl.Map): void {
  for (const id of [SNOW_LAYER, WATER_EDGE, WATER_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
}
