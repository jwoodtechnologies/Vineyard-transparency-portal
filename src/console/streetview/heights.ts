/**
 * How tall each building stands in the 3D view, from the best record available. OpenFreeMap's buildings
 * carry render_height, worked out by OpenMapTiles from OpenStreetMap's height tag, or building:levels at
 * 3.66 m a floor; a building with neither gets exactly 5 m there. Those are replaced by a default of
 * UNKNOWN_M, a two story home, the most common building in Vineyard.
 */
import type * as maplibregl from 'maplibre-gl';

/** OpenMapTiles' value for a building with no height or levels recorded. */
export const OMT_UNKNOWN_M = 5;
/** A typical two story home. */
export const UNKNOWN_M = 7.5;

/** The fill-extrusion-height expression. */
export function buildingHeight(): maplibregl.DataDrivenPropertyValueSpecification<number> {
  return ['case', ['all', ['has', 'render_height'], ['!=', ['to-number', ['get', 'render_height']], OMT_UNKNOWN_M]], ['to-number', ['get', 'render_height']], UNKNOWN_M] as unknown as maplibregl.DataDrivenPropertyValueSpecification<number>;
}
