/**
 * Builds Drive mode's road graph off the main thread: reads OpenFreeMap's zoom 14 vector tiles over the box it
 * is given (Vineyard and a little around it), keeps the road lines cars use, cuts them at tile edges and joins
 * them (graph.ts). Posts { graph } or { error }.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { buildGraph, clipToTile, type Pos, type Seg } from './graph';

const Z = 14;
const TILEJSON = 'https://tiles.openfreemap.org/planet';

interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

const tileX = (lng: number) => Math.floor(((lng + 180) / 360) * 2 ** Z);
const tileY = (lat: number) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** Z);
const toLngLat = (x: number, y: number, tx: number, ty: number, extent: number): Pos => {
  const n = 2 ** Z;
  const lng = ((tx + x / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + y / extent)) / n))) * 180) / Math.PI;
  return [lng, lat];
};

async function roadsIn(tiles: string, tx: number, ty: number): Promise<Seg[]> {
  const res = await fetch(tiles.replace('{z}', String(Z)).replace('{x}', String(tx)).replace('{y}', String(ty)));
  if (!res.ok) return [];
  const vt = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
  const layer = vt.layers.transportation;
  if (!layer) return [];
  const out: Seg[] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 2) continue;
    const cls = String(f.properties.class ?? '');
    const oneway = Number(f.properties.oneway ?? 0);
    const brunnel = typeof f.properties.brunnel === 'string' && f.properties.brunnel !== 'ford' ? f.properties.brunnel : undefined;
    for (const line of f.loadGeometry())
      for (const piece of clipToTile(
        line.map((p) => [p.x, p.y] as [number, number]),
        layer.extent,
      ))
        out.push({ coords: piece.map(([x, y]) => toLngLat(x, y, tx, ty, layer.extent)), cls, oneway: oneway === 1 ? 1 : oneway === -1 ? -1 : 0, brunnel });
  }
  return out;
}

self.onmessage = async (e: MessageEvent<{ box: Box }>) => {
  try {
    const tj = (await (await fetch(TILEJSON)).json()) as { tiles?: string[] };
    const tiles = tj.tiles?.[0];
    if (!tiles) throw new Error('No road tiles.');
    const { box } = e.data;
    const jobs: Array<Promise<Seg[]>> = [];
    for (let x = tileX(box.west); x <= tileX(box.east); x++) for (let y = tileY(box.north); y <= tileY(box.south); y++) jobs.push(roadsIn(tiles, x, y).catch(() => []));
    const segs = (await Promise.all(jobs)).flat();
    (self as unknown as Worker).postMessage({ graph: buildGraph(segs) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : 'The roads could not be read.' });
  }
};
