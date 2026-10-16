#!/usr/bin/env node
/**
 * Trims the OpenStreetMap pull (scripts/data/fetch-world.mjs) to what the street scene uses in Vineyard and
 * about 600 m around it: stop signs, give way signs, traffic signals and crossings (points), sidewalks,
 * footways, paths, cycleways and steps (lines), roads with their lane, one way, speed and sidewalk tags
 * (lines), parks, pitches and playgrounds (outlines) and trees (points). Buildings are left out: the map's
 * own tiles carry them. Coordinates are rounded to six decimals (about 10 cm).
 *
 *   node scripts/data/trim-osm.mjs <osm-vineyard.geojson> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [inPath, outPath] = process.argv.slice(2);
const BOX = { west: -111.782, south: 40.272, east: -111.705, north: 40.342 };
const src = JSON.parse(readFileSync(inPath, 'utf8'));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const inside = (c) => c[0] >= BOX.west && c[0] <= BOX.east && c[1] >= BOX.south && c[1] <= BOX.north;
const ROAD = /^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)(_link)?$/;
const PATH = /^(footway|path|cycleway|pedestrian|steps)$/;
const keepTags = (p, keys) => Object.fromEntries(keys.filter((k) => p[k] != null).map((k) => [k, p[k]]));

const out = { signs: [], crossings: [], paths: [], roads: [], green: [], trees: [] };
for (const f of src.features) {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (g.type === 'Point') {
    const c = g.coordinates.map(r6);
    if (!inside(c)) continue;
    if (p.highway === 'stop' || p.highway === 'give_way' || p.highway === 'traffic_signals') out.signs.push({ at: c, kind: p.highway, dir: p.direction ?? null, stop: p.stop ?? null });
    else if ((p.highway === 'crossing' || p.crossing) && (p.crossing === 'marked' || p.crossing === 'zebra' || p['crossing:markings'] === 'yes' || p['crossing:markings'] === 'zebra')) out.crossings.push({ at: c, kind: p.crossing ?? 'marked' });
    else if (p.natural === 'tree') out.trees.push(c);
  } else if (g.type === 'LineString') {
    const coords = g.coordinates.map((c) => c.map(r6));
    if (!coords.some(inside)) continue;
    if (PATH.test(p.highway ?? '')) out.paths.push({ coords, kind: p.highway, sidewalk: p.footway === 'sidewalk' || undefined, crossing: p.footway === 'crossing' || undefined });
    else if (ROAD.test(p.highway ?? '')) out.roads.push({ coords, ...keepTags(p, ['highway', 'name', 'lanes', 'oneway', 'maxspeed', 'sidewalk', 'sidewalk:both', 'sidewalk:left', 'sidewalk:right', 'lanes:forward', 'lanes:backward', 'turn:lanes']) });
  } else if (g.type === 'Polygon') {
    const ring = g.coordinates[0].map((c) => c.map(r6));
    if (!ring.some(inside)) continue;
    if (p.leisure) out.green.push({ ring, kind: p.leisure });
  }
}
const text = JSON.stringify(out);
writeFileSync(outPath, text);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])), `${(text.length / 1e6).toFixed(2)} MB`);
