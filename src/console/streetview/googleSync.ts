/**
 * The arithmetic that keeps the Google map and the Google panorama in step (GoogleView.tsx), kept free of
 * the browser so it can be tested: zoom between our map and Google's, the heading cone, when the map must
 * follow the panorama, the divider between the two halves, and the parcel tiles to draw.
 */
import { coneRing, type Pos } from './geo';

/** Our map (MapLibre) uses 512 pixel tiles and Google 256, so the same view is one zoom level higher in Google. */
export const toGoogleZoom = (z: number) => Math.round(Math.max(3, Math.min(21, z + 1)));
export const fromGoogleZoom = (z: number) => Math.max(2, Math.min(22, z - 1));

/** A heading in degrees, 0 to 360. */
export const normHeading = (h: number) => ((h % 360) + 360) % 360;

/** The panorama's horizontal view angle at a Street View zoom (zoom 1 is about 90 degrees). */
export const panoFov = (zoom: number) => Math.max(10, Math.min(120, 180 / 2 ** Math.max(0, zoom)));

/** The cone drawn on the Google map: from the camera, the way it faces, as wide as it sees. */
export function headingCone(pos: Pos, heading: number, zoom: number, meters = 28): Pos[] {
  return coneRing(pos, normHeading(heading), panoFov(zoom), meters);
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Whether the map must move to keep the panorama's spot in view: true once it is within `margin` (a share of
 * the width and height) of an edge, or outside. Inside the middle the map stays still, so walking does not
 * shake it.
 */
export function needsPan(b: Bounds, [lng, lat]: Pos, margin = 0.15): boolean {
  const mx = (b.east - b.west) * margin;
  const my = (b.north - b.south) * margin;
  return lng < b.west + mx || lng > b.east - mx || lat < b.south + my || lat > b.north - my;
}

/** The share of the space the panorama takes, kept so neither half is too small to use. */
export const clampSplit = (r: number, min = 0.3, max = 0.75) => Math.max(min, Math.min(max, Number.isFinite(r) ? r : 0.5));

/**
 * The panorama's share after dragging the divider to `at` pixels, along a box `size` pixels long that starts
 * at `start`. Side by side the panorama is on the right; stacked it is on top.
 */
export function splitAt(at: number, start: number, size: number, stacked: boolean): number {
  const t = (at - start) / Math.max(1, size);
  return clampSplit(stacked ? t : 1 - t);
}

/** Zoom 16 tile numbers covering a box, at most `max` of them (none when the box is wider than that). */
export function parcelTiles(b: Bounds, max = 12): Array<[number, number]> {
  const z = 16;
  const n = 2 ** z;
  const tx = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const [x0, x1, y0, y1] = [tx(b.west), tx(b.east), ty(b.north), ty(b.south)];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > max) return [];
  const out: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}
