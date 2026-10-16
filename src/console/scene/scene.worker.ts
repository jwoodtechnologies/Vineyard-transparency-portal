/**
 * Builds the street scene's building meshes off the main thread: fetches the county aerial tiles that cover
 * the buildings (the site may read their pixels), reads each roof's colour off the photo, and turns every
 * footprint into walls and a roof (buildingMesh.ts). Answers with one Float32Array (moved, not copied) and
 * each building's outline and top for hit testing.
 */
import { roofColor, tileAt, tileBounds, tileUrl, type RGB } from './aerial';
import { buildingsMesh, topOf, type BuildingIn } from './buildingMesh';
import { toLocal, type XY } from './footprint';
import { roadsMesh, roadWidth, type CrossingIn, type PathIn, type RoadIn, type SignIn } from './roadMesh';

export interface SceneBuilding {
  /** Outline in longitude and latitude. */
  ring: Array<[number, number]>;
  height: number;
  base: number;
  recorded?: boolean;
  /** Ground height at the building above the origin's, meters. */
  dz: number;
  wall: RGB;
  /** The roof colour to use when the photo gives none. */
  roof: RGB;
}

/** A road, path, sign or crossing from the OpenStreetMap data (scene/data), in longitude and latitude. */
export interface SceneRoad {
  coords: Array<[number, number]>;
  dz: number[];
  highway: string;
  lanes?: number;
  oneway?: boolean;
}
export interface ScenePath {
  coords: Array<[number, number]>;
  dz: number[];
  sidewalk?: boolean;
}
export interface SceneNode {
  at: [number, number];
  dz: number;
  kind: string;
}

export interface SceneRequest {
  id: number;
  origin: [number, number, number];
  buildings: SceneBuilding[];
  roads?: SceneRoad[];
  paths?: ScenePath[];
  signs?: SceneNode[];
  crossings?: SceneNode[];
  /** The county aerial's tile address template ({bbox-epsg-3857}) and tile size in pixels, or null to skip the photo. */
  aerial: { template: string; px: number } | null;
}

export interface ScenePick {
  ring: Array<[number, number]>;
  base: number;
  top: number;
}

export interface SceneAnswer {
  id: number;
  origin: [number, number, number];
  mesh: Float32Array;
  picks: ScenePick[];
  /** How many roofs got their colour from the photo. */
  photoRoofs: number;
  note?: string;
}

/** Aerial tiles at this zoom: about 300 m across in Vineyard, 0.6 m a pixel at 512 px. */
const TILE_Z = 17;

const tiles = new Map<string, Promise<{ rgba: Uint8ClampedArray; px: number; bounds: [number, number, number, number] } | null>>();

async function tilePixels(template: string, px: number, z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(tileUrl(template, z, x, y), { mode: 'cors', credentials: 'omit' });
        if (!res.ok) return null;
        const bmp = await createImageBitmap(await res.blob());
        const c = new OffscreenCanvas(px, px);
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return null;
        g.drawImage(bmp, 0, 0, px, px);
        bmp.close();
        return { rgba: g.getImageData(0, 0, px, px).data, px, bounds: tileBounds(z, x, y) };
      } catch {
        return null;
      }
    })();
    tiles.set(key, p);
    if (tiles.size > 60) tiles.delete(tiles.keys().next().value as string);
  }
  return p;
}

async function build(req: SceneRequest): Promise<SceneAnswer> {
  const local = toLocal([req.origin[0], req.origin[1]]);
  let photoRoofs = 0;
  let note: string | undefined;
  const list: BuildingIn[] = [];
  const picks: ScenePick[] = [];
  // Roof colours: every building's tile first (fetched once each), then the colours.
  const colors: Array<RGB | null> = new Array(req.buildings.length).fill(null);
  if (req.aerial) {
    const jobs = req.buildings.map(async (b, i) => {
      const c = b.ring[0];
      const [x, y] = tileAt(c[0], c[1], TILE_Z);
      const t = await tilePixels(req.aerial!.template, req.aerial!.px, TILE_Z, x, y);
      if (t) colors[i] = roofColor(b.ring, t.rgba, t.px, t.bounds);
    });
    await Promise.all(jobs);
    if (!colors.some(Boolean)) note = 'aerial not readable';
  }
  req.buildings.forEach((b, i) => {
    const ring: XY[] = b.ring.map(local);
    const roof = colors[i] ?? b.roof;
    if (colors[i]) photoRoofs++;
    const inB: BuildingIn = { ring: ring.map(([x, y]) => [x, y + 0] as XY), height: b.height + b.dz, base: b.base + b.dz, wall: b.wall, roof, recorded: b.recorded };
    list.push(inB);
    picks.push({ ring: b.ring, base: b.base, top: topOf({ ...inB, height: b.height, base: b.base }) });
  });
  const buildings = buildingsMesh(list);
  const furniture = roadFurniture(req, local);
  const mesh = new Float32Array(buildings.length + furniture.length);
  mesh.set(buildings, 0);
  mesh.set(furniture, buildings.length);
  return { id: req.id, origin: req.origin, mesh, picks, photoRoofs, note };
}

/** The direction (radians from east) and width of the road nearest a point, within 25 m. */
function roadAt(roads: RoadIn[], p: XY): { along: number; width: number } | null {
  let best: { d: number; along: number; width: number } | null = null;
  for (const r of roads)
    for (let i = 0; i + 1 < r.coords.length; i++) {
      const a = r.coords[i],
        b = r.coords[i + 1];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      const d = Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
      if (d < 25 && (!best || d < best.d)) best = { d, along: Math.atan2(dy, dx), width: roadWidth(r.highway, r.lanes) };
    }
  return best ? { along: best.along, width: best.width } : null;
}

/** Roads, sidewalks, crossings and signs near the view as one mesh. */
function roadFurniture(req: SceneRequest, local: (p: [number, number]) => XY): Float32Array {
  const roads: RoadIn[] = (req.roads ?? []).map((r) => ({ coords: r.coords.map(local), dz: r.dz, highway: r.highway, lanes: r.lanes, oneway: r.oneway }));
  const paths: PathIn[] = (req.paths ?? []).map((p) => ({ coords: p.coords.map(local), dz: p.dz, sidewalk: p.sidewalk }));
  const signs: SignIn[] = [];
  for (const n of req.signs ?? []) {
    const at = local(n.at);
    const r = roadAt(roads, at);
    if (!r) continue;
    // The sign stands at the road's right edge for traffic coming along it, the plate across the road.
    const kind = n.kind === 'give_way' ? 'give_way' : n.kind === 'traffic_signals' ? 'traffic_signals' : 'stop';
    const side = r.width / 2 + 0.6;
    signs.push({ at: [at[0] + Math.sin(r.along) * side, at[1] - Math.cos(r.along) * side], dz: n.dz, kind, along: r.along });
  }
  const crossings: CrossingIn[] = [];
  for (const n of req.crossings ?? []) {
    const at = local(n.at);
    const r = roadAt(roads, at);
    if (r) crossings.push({ at, dz: n.dz, along: r.along, width: r.width });
  }
  return roadsMesh(roads, paths, signs, crossings);
}

self.onmessage = async (e: MessageEvent<SceneRequest>) => {
  try {
    const a = await build(e.data);
    (self as unknown as Worker).postMessage(a, [a.mesh.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, error: String(err) });
  }
};
