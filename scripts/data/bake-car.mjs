/**
 * Bakes a Kenney Car Kit model (CC0) into the small binary Drive mode draws: the car's triangles in meters
 * (x right, y forward, z up, wheels on the ground), each vertex with its colour read off the kit's colour map
 * and shaded by its normal once. One flat array; no glTF parser ships to the browser.
 *
 *   node scripts/data/bake-car.mjs <model.glb> <colormap.png> <out.bin> [length m]
 *
 * File: 'VCAR', version 1 (one byte), the body colour (three bytes: the most common colour on the body, so
 * the layer can repaint it to the driver's choice), the vertex count (uint32), then for each vertex
 * x y z (int16 mm), r g b (uint8, unshaded) and the shade (uint8, 255 is full light): 10 bytes a vertex.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const [glbPath, pngPath, outPath, lengthArg, bodyArg] = process.argv.slice(2);
if (!glbPath || !outPath) {
  console.error('usage: bake-car.mjs <model.glb> <colormap.png|-> <out.bin> [length m] [body r,g,b]');
  process.exit(2);
}
/** The car is fitted to this box (meters: across, along, tall), a 2026 mid size SUV. */
const BOX_M = [2.0, 4.7, 1.85];
if (lengthArg) BOX_M[1] = Number(lengthArg) || BOX_M[1];

const glb = readFileSync(glbPath);
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binLen = glb.readUInt32LE(20 + jsonLen);
const bin = glb.subarray(28 + jsonLen, 28 + jsonLen + binLen);

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews[a.bufferView];
  const T = COMP[a.componentType];
  const n = SIZE[a.type];
  const stride = bv.byteStride ?? n * T.BYTES_PER_ELEMENT;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = [];
  for (let k = 0; k < a.count; k++) {
    const off = bin.byteOffset + base + k * stride;
    const v = new T(bin.buffer, off, n);
    out.push(Array.from(v));
  }
  return out;
}

let cmap = null;
if (pngPath && pngPath !== '-') {
  const img = sharp(readFileSync(pngPath)).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  cmap = { data, w: info.width, h: info.height };
}
function colorAt(uv) {
  if (!cmap) return [0.6, 0.6, 0.62];
  const u = ((uv[0] % 1) + 1) % 1,
    v = ((uv[1] % 1) + 1) % 1;
  const x = Math.min(cmap.w - 1, Math.floor(u * cmap.w)),
    y = Math.min(cmap.h - 1, Math.floor(v * cmap.h));
  const i = (y * cmap.w + x) * 4;
  return [cmap.data[i] / 255, cmap.data[i + 1] / 255, cmap.data[i + 2] / 255];
}

// glTF: y up, the car points along +z. Drive: x right, y forward, z up. (x, y, z) -> (-x, z, y) keeps handedness.
const toCar = ([x, y, z]) => [-x, z, y];
const LIGHT = (() => {
  const l = [0.35, -0.45, 0.82];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();

const verts = []; // [x, y, z, r, g, b, body?]
const bodyCounts = new Map();
function walk(nodeIdx, parentT) {
  const node = gltf.nodes[nodeIdx];
  const t = node.translation ?? [0, 0, 0];
  const T = [parentT[0] + t[0], parentT[1] + t[1], parentT[2] + t[2]];
  if (node.rotation || node.scale) throw new Error(`node ${node.name} has rotation or scale; only translation is handled`);
  if (node.mesh != null) {
    const mesh = gltf.meshes[node.mesh];
    const isBody = /body/i.test(node.name ?? mesh.name ?? '');
    for (const prim of mesh.primitives) {
      const pos = accessor(prim.attributes.POSITION);
      const nrm = accessor(prim.attributes.NORMAL);
      const uv = prim.attributes.TEXCOORD_0 != null ? accessor(prim.attributes.TEXCOORD_0) : null;
      const idx = prim.indices != null ? accessor(prim.indices).map((v) => v[0]) : pos.map((_, i) => i);
      for (const i of idx) {
        const p = toCar([pos[i][0] + T[0], pos[i][1] + T[1], pos[i][2] + T[2]]);
        const n = toCar(nrm[i]);
        const c = uv ? colorAt(uv[i]) : [0.6, 0.6, 0.62];
        const key = c.map((v) => Math.round(v * 255)).join(',');
        if (isBody) bodyCounts.set(key, (bodyCounts.get(key) ?? 0) + 1);
        verts.push({ p, n, c, key, body: isBody });
      }
    }
  }
  for (const ch of node.children ?? []) walk(ch, T);
}
for (const n of gltf.scenes[gltf.scene ?? 0].nodes) walk(n, [0, 0, 0]);

// Fit to the box (each axis on its own: the kit's cars are stubbier than real ones), wheels on the ground, centred.
let min = [Infinity, Infinity, Infinity],
  max = [-Infinity, -Infinity, -Infinity];
for (const v of verts) for (let k = 0; k < 3; k++) (min[k] = Math.min(min[k], v.p[k])), (max[k] = Math.max(max[k], v.p[k]));
const scale = BOX_M.map((m, k) => m / (max[k] - min[k]));
const cx = (min[0] + max[0]) / 2,
  cy = (min[1] + max[1]) / 2;
// The paint: the colour named on the command line, else the most common one on the body.
const ranked = [...bodyCounts.entries()].sort((a, b) => b[1] - a[1]);
const bodyKey = bodyArg ?? ranked[0]?.[0] ?? '160,160,160';
const body = bodyKey.split(',').map(Number);

const out = Buffer.alloc(12 + verts.length * 10);
out.write('VCAR', 0);
out.writeUInt8(1, 4);
out.writeUInt8(body[0], 5);
out.writeUInt8(body[1], 6);
out.writeUInt8(body[2], 7);
out.writeUInt32LE(verts.length, 8);
let o = 12;
for (const v of verts) {
  const x = (v.p[0] - cx) * scale[0],
    y = (v.p[1] - cy) * scale[1],
    z = (v.p[2] - min[2]) * scale[2];
  const nl = Math.hypot(...v.n) || 1;
  const dot = (v.n[0] * LIGHT[0] + v.n[1] * LIGHT[1] + v.n[2] * LIGHT[2]) / nl;
  const shade = 0.72 + 0.28 * Math.max(0, dot);
  out.writeInt16LE(Math.round(x * 1000), o);
  out.writeInt16LE(Math.round(y * 1000), o + 2);
  out.writeInt16LE(Math.round(z * 1000), o + 4);
  // The colour is unshaded (the layer repaints body coloured vertices to the driver's choice); the shade is the tenth byte.
  out.writeUInt8(Math.round(v.c[0] * 255), o + 6);
  out.writeUInt8(Math.round(v.c[1] * 255), o + 7);
  out.writeUInt8(Math.round(v.c[2] * 255), o + 8);
  out.writeUInt8(Math.round(shade * 255), o + 9);
  o += 10;
}
writeFileSync(outPath, out);
console.log(JSON.stringify({ vertices: verts.length, triangles: verts.length / 3, bytes: out.length, box: BOX_M, body: bodyKey, top: ranked.slice(0, 6) }));
