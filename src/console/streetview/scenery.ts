/**
 * Scenery for the street level 3D view: a light snowcap on the high Wasatch, and Utah Lake and the harbors
 * drawn as open water instead of the green the aerial photos show. Both lie between the aerial photos and
 * the hillshade, so the slopes keep their shading and the photo shows through.
 *
 * The snow is a color relief from the same elevation tiles as the terrain: clear below SNOW_START, then
 * fading in to a partly see-through white by about 3,100 m. The tiles are about 30 m apart, so the edge
 * is soft on its own. The water is OpenFreeMap's water shapes, tinted a muted lake blue that lowers the
 * green, with a blurred line along the shore so the edge is not a hard cut.
 */
import type * as maplibregl from 'maplibre-gl';

/** Where snow starts to show, in meters. */
export const SNOW_START = 2750;
/** Where it is at its fullest, in meters (Timpanogos's summit is 3,582 m). */
export const SNOW_FULL = 3150;
export const SNOW_MAX_OPACITY = 0.78;

export const SNOW_LAYER = 'vtp-sv-snow';
export const WATER_LAYER = 'vtp-sv-water';
export const WATER_EDGE = 'vtp-sv-water-edge';

/** A muted, slightly gray lake blue: Utah Lake's open water seen from the shore on a clear day. */
export const WATER_COLOR = '#5e88a3';

export const snowColor = (): maplibregl.ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['elevation'],
  SNOW_START,
  'rgba(244, 247, 251, 0)',
  2900,
  `rgba(244, 247, 251, ${(SNOW_MAX_OPACITY * 0.45).toFixed(2)})`,
  SNOW_FULL,
  `rgba(248, 250, 253, ${SNOW_MAX_OPACITY})`,
];

/** Lakes, ponds, docks and harbors; not swimming pools. */
export const WATER_FILTER: maplibregl.FilterSpecification = ['!=', ['get', 'class'], 'swimming_pool'];

/** `vector` is null on the streets map, which already draws water. */
export function addScenery(map: maplibregl.Map, dem: string, vector: string | null, before: string | undefined): void {
  if (vector && !map.getLayer(WATER_LAYER))
    map.addLayer(
      { id: WATER_LAYER, type: 'fill', source: vector, 'source-layer': 'water', filter: WATER_FILTER, paint: { 'fill-color': WATER_COLOR, 'fill-opacity': 0.55, 'fill-antialias': true } },
      before,
    );
  if (vector && !map.getLayer(WATER_EDGE))
    map.addLayer(
      {
        id: WATER_EDGE,
        type: 'line',
        source: vector,
        'source-layer': 'water',
        filter: WATER_FILTER,
        paint: { 'line-color': WATER_COLOR, 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 10, 19, 24], 'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 10, 19, 24] },
      },
      before,
    );
  if (!map.getLayer(SNOW_LAYER)) map.addLayer({ id: SNOW_LAYER, type: 'color-relief', source: dem, paint: { 'color-relief-color': snowColor(), 'color-relief-opacity': 1 } }, before);
}

export function removeScenery(map: maplibregl.Map): void {
  for (const id of [SNOW_LAYER, WATER_EDGE, WATER_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
}
