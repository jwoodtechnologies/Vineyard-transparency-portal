#!/usr/bin/env node
/**
 * Gathers what the 3D street scene needs, from the diagnostics runner (this container cannot reach these
 * hosts): OpenStreetMap's stop signs, traffic signals, crossings, sidewalks, footways and building tags for
 * Vineyard and a little around it (Overpass, one query, saved as GeoJSON); whether the county aerial service
 * allows browser reads of its pixels (for roof colours); and Kenney's CC0 car kit (an SUV model).
 *
 *   node scripts/data/fetch-world.mjs --out <dir>
 */
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] ?? 'true']] : acc), []));
const OUT = args.out ?? 'world';
mkdirSync(OUT, { recursive: true });
const log = {};
// Vineyard and about 1.5 km around it.
const BOX = { south: 40.264, west: -111.79, north: 40.352, east: -111.69 };
const bbox = `${BOX.south},${BOX.west},${BOX.north},${BOX.east}`;

// 1) OpenStreetMap through Overpass, as GeoJSON (nodes as points, ways as lines or polygons).
const query = `[out:json][timeout:120];
(
  node["highway"~"^(stop|give_way|traffic_signals|crossing)$"](${bbox});
  node["crossing"](${bbox});
  way["highway"~"^(footway|path|cycleway|pedestrian|steps)$"](${bbox});
  way["sidewalk"](${bbox});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|living_street)(_link)?$"](${bbox});
  way["building"](${bbox});
  relation["building"](${bbox});
  node["amenity"~"^(parking|school|place_of_worship)$"](${bbox});
  way["leisure"~"^(park|pitch|playground)$"](${bbox});
  way["natural"="tree_row"](${bbox});
  node["natural"="tree"](${bbox});
);
out body;
>;
out skel qt;`;
try {
  // Overpass answered a plain POST with 406: a GET with the query in the address, a user agent, and a mirror.
  let data = null;
  log.overpass = [];
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const res = await fetch(`${host}?data=${encodeURIComponent(query)}`, { headers: { 'user-agent': 'vineyardportal.org street scene build (one query)', accept: 'application/json' } });
      const text = await res.text();
      log.overpass.push({ host, status: res.status, head: text.slice(0, 80) });
      if (res.ok && text.trimStart().startsWith('{')) {
        data = JSON.parse(text);
        break;
      }
    } catch (e) {
      log.overpass.push({ host, error: String(e).slice(0, 120) });
    }
  }
  if (!data) throw new Error('no Overpass answer');
  const nodes = new Map();
  for (const e of data.elements) if (e.type === 'node') nodes.set(e.id, e);
  const features = [];
  const counts = {};
  for (const e of data.elements) {
    if (e.type === 'node' && e.tags) {
      features.push({ type: 'Feature', id: `n${e.id}`, properties: e.tags, geometry: { type: 'Point', coordinates: [e.lon, e.lat] } });
      const k = e.tags.highway ?? e.tags.natural ?? e.tags.amenity ?? 'node';
      counts[k] = (counts[k] ?? 0) + 1;
    } else if (e.type === 'way' && e.tags) {
      const coords = e.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => [n.lon, n.lat]);
      if (coords.length < 2) continue;
      const closed = coords.length > 3 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1];
      const area = closed && (e.tags.building || e.tags.leisure || e.tags.amenity);
      features.push({ type: 'Feature', id: `w${e.id}`, properties: e.tags, geometry: area ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords } });
      const k = e.tags.building ? 'building' : e.tags.highway ?? e.tags.leisure ?? 'way';
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  log.counts = counts;
  log.buildingTags = {};
  for (const f of features) if (f.properties.building) for (const k of ['roof:shape', 'roof:colour', 'building:colour', 'height', 'building:levels', 'roof:levels', 'roof:material']) if (f.properties[k]) log.buildingTags[k] = (log.buildingTags[k] ?? 0) + 1;
  writeFileSync(join(OUT, 'osm-vineyard.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  log.features = features.length;
} catch (e) {
  log.overpassError = String(e).slice(0, 300);
}

// 2) The county aerial: does it allow browser reads of its pixels?
try {
  const url = 'https://gisaerials.utahcounty.gov/arcgis/rest/services/NewestImagery/NewestImagery_WGS84/ImageServer/exportImage?bbox=-12437000,4907000,-12436800,4907200&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image';
  const res = await fetch(url, { headers: { origin: 'https://vineyardportal.org' } });
  log.county = { status: res.status, type: res.headers.get('content-type'), acao: res.headers.get('access-control-allow-origin'), cors: res.headers.get('access-control-allow-origin') === '*' || res.headers.get('access-control-allow-origin') === 'https://vineyardportal.org' };
} catch (e) {
  log.countyError = String(e).slice(0, 300);
}

// 3) Kenney's car kit (CC0): the SUV and any other car models, as glTF binaries.
try {
  const zip = join(OUT, 'kenney-car-kit.zip');
  // The zip's address is found on the kit's page.
  const page = await (await fetch('https://kenney.nl/assets/car-kit', { headers: { 'user-agent': 'vineyardportal.org street scene build' } })).text();
  const m = page.match(/https?:\/\/kenney\.nl\/media\/[^"']+?\.zip/) ?? page.match(/\/media\/[^"']+?\.zip/);
  log.kenneyLink = m?.[0] ?? null;
  const res = await fetch(m ? (m[0].startsWith('http') ? m[0] : `https://kenney.nl${m[0]}`) : 'https://kenney.nl/media/pages/assets/car-kit/kenney_car-kit.zip', { headers: { 'user-agent': 'vineyardportal.org street scene build' } });
  log.kenney = { status: res.status, type: res.headers.get('content-type') };
  if (res.ok) {
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const dir = join(OUT, 'car-kit');
    mkdirSync(dir, { recursive: true });
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
    const files = [];
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(`${p.slice(dir.length + 1)} ${statSync(p).size}`);
      }
    };
    walk(dir);
    log.kenneyFiles = files.filter((f) => /glb|gltf|License|obj/i.test(f)).slice(0, 80);
    log.kenneyAll = files.length;
  }
} catch (e) {
  log.kenneyError = String(e).slice(0, 300);
}
writeFileSync(join(OUT, 'fetch-world.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
