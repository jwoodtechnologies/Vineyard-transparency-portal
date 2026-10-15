/**
 * The 3D street view's camera stands at the pin at eye height and looks out from there, as a person standing
 * on the street would. (Centered on the pin at zoom 18.4, the camera had stood about 180 m behind it and 22 m
 * up, so the houses in between filled the view as long grey blocks.) Turning, tilting and stepping all pivot
 * on the pin.
 *
 * Worked out here rather than with MapLibre's camera helpers, which need the elevation tiles loaded: from
 * eye height h, tilted p degrees from straight down, the line of sight meets the ground h * tan(p) ahead.
 * The map is centered there, at the zoom that puts the camera h / cos(p) from it; MapLibre keeps that over
 * the terrain on its own.
 */
import type * as maplibregl from 'maplibre-gl';
import { destination, type Pos } from '../measure/geo';
import { eyeGeometry } from './eyeMath';

export { EYE_M, EYE_MAX_ZOOM } from './eyeMath';

/** The camera at the pin, at eye height, facing `bearing`, tilted `pitch`. */
export function eyeView(map: maplibregl.Map, pin: Pos, bearing: number, pitch: number): maplibregl.CameraOptions {
  const { ahead, zoom } = eyeGeometry(pin[1], pitch, map.getVerticalFieldOfView(), map.getCanvas().clientHeight || 600);
  return { center: destination(pin, bearing, ahead), zoom, bearing, pitch };
}
