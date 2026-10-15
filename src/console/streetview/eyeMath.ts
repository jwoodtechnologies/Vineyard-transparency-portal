/** The eye level camera's geometry for the 3D street view (eye.ts). Pure. */

/** Eye height above the ground, in meters (a little above a person, so the street is easy to see). */
export const EYE_M = 3;
/** Close enough to stand at eye height. */
export const EYE_MAX_ZOOM = 24;

/** Map center (meters ahead of the pin) and zoom for the eye at `pin`, for a view `heightPx` tall. */
export function eyeGeometry(lat: number, pitch: number, fovDeg: number, heightPx: number, eyeM = EYE_M): { ahead: number; zoom: number } {
  const p = (Math.min(pitch, 89) * Math.PI) / 180;
  const ahead = eyeM * Math.tan(p);
  const dist = eyeM / Math.cos(p);
  // MapLibre's camera stands this many pixels from the center: half the view's height over tan(fov / 2).
  const camPx = (0.5 * heightPx) / Math.tan((fovDeg * Math.PI) / 360);
  const metersPerPx = dist / camPx;
  const zoom = Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * metersPerPx));
  return { ahead, zoom };
}
