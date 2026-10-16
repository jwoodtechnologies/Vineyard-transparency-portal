/**
 * The baked car model Drive mode draws (scripts/data/bake-car.mjs writes it from Kenney's CC0 Car Kit):
 * 'VCAR', version 2, the paint colour (three bytes), the vertex count (uint32), then twelve bytes a vertex:
 * x y z (int16 mm; x right, y forward, z up, wheels on the ground), r g b (uint8, unshaded), the shade
 * (uint8), flags (bit 0: painted bodywork) and a spare byte. Pure: parsing and turning it into the layer's
 * triangles (x, y, z, r, g, b floats) with the bodywork repainted to the driver's colour, keeping each
 * vertex's own light and dark against the paint.
 */
export interface CarModel {
  count: number;
  /** Millimeters, three a vertex. */
  pos: Int16Array;
  /** Unshaded colour bytes, three a vertex. */
  rgb: Uint8Array;
  /** Light on the vertex, 255 is full. */
  shade: Uint8Array;
  /** 1 where the vertex is painted bodywork. */
  paint: Uint8Array;
  /** The colour the kit painted the body: painted vertices take the driver's colour instead. */
  body: [number, number, number];
}
const STRIDE = 12;

export function parseCar(buf: ArrayBuffer): CarModel {
  const v = new DataView(buf);
  if (buf.byteLength < 12 || String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)) !== 'VCAR') throw new Error('not a car model');
  if (v.getUint8(4) !== 2) throw new Error(`car model version ${v.getUint8(4)}`);
  const body: [number, number, number] = [v.getUint8(5), v.getUint8(6), v.getUint8(7)];
  const count = v.getUint32(8, true);
  if (buf.byteLength < 12 + count * STRIDE) throw new Error('car model cut short');
  const pos = new Int16Array(count * 3);
  const rgb = new Uint8Array(count * 3);
  const shade = new Uint8Array(count);
  const paint = new Uint8Array(count);
  for (let i = 0, o = 12; i < count; i++, o += STRIDE) {
    pos[i * 3] = v.getInt16(o, true);
    pos[i * 3 + 1] = v.getInt16(o + 2, true);
    pos[i * 3 + 2] = v.getInt16(o + 4, true);
    rgb[i * 3] = v.getUint8(o + 6);
    rgb[i * 3 + 1] = v.getUint8(o + 7);
    rgb[i * 3 + 2] = v.getUint8(o + 8);
    shade[i] = v.getUint8(o + 9);
    paint[i] = v.getUint8(o + 10) & 1;
  }
  return { count, pos, rgb, shade, paint, body };
}

/** Triangles for the layer: meters and shaded colours, the bodywork in `hex`. */
export function carMesh(m: CarModel, hex: string): Float32Array {
  const n = parseInt(hex.replace('#', ''), 16);
  const paint = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b || 1;
  const bodyLum = lum(m.body[0], m.body[1], m.body[2]);
  const out = new Float32Array(m.count * 6);
  for (let i = 0; i < m.count; i++) {
    const r = m.rgb[i * 3],
      g = m.rgb[i * 3 + 1],
      b = m.rgb[i * 3 + 2];
    // Painted bodywork takes the chosen colour, as light or dark against the paint as this vertex was.
    const tone = m.paint[i] ? Math.max(0.6, Math.min(1.3, lum(r, g, b) / bodyLum)) : 1;
    const own = m.paint[i] ? paint.map((c) => Math.min(255, c * tone)) : [r, g, b];
    const k = m.shade[i] / 255 / 255;
    out[i * 6] = m.pos[i * 3] / 1000;
    out[i * 6 + 1] = m.pos[i * 3 + 1] / 1000;
    out[i * 6 + 2] = m.pos[i * 3 + 2] / 1000;
    out[i * 6 + 3] = own[0] * k;
    out[i * 6 + 4] = own[1] * k;
    out[i * 6 + 5] = own[2] * k;
  }
  return out;
}
