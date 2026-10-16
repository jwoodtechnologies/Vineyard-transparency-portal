import { describe, expect, it } from 'vitest';
import { carMesh, parseCar } from '../src/console/drive/carModel';

/** A two triangle model: one painted bodywork (a lighter shade on one vertex), one black, in the baked file's layout. */
function file(): ArrayBuffer {
  const verts = [
    [0, 0, 0, 153, 153, 158, 255, 1],
    [1000, 0, 0, 153, 153, 158, 255, 1],
    [0, 1000, 0, 153, 153, 158, 128, 1],
    [0, 0, 500, 20, 20, 20, 255, 0],
    [-1000, 0, 500, 20, 20, 20, 255, 0],
    [0, -1000, 500, 20, 20, 20, 255, 0],
  ];
  const buf = new ArrayBuffer(12 + verts.length * 12);
  const v = new DataView(buf);
  'VCAR'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
  v.setUint8(4, 2);
  v.setUint8(5, 153);
  v.setUint8(6, 153);
  v.setUint8(7, 158);
  v.setUint32(8, verts.length, true);
  verts.forEach((w, i) => {
    const o = 12 + i * 12;
    v.setInt16(o, w[0], true);
    v.setInt16(o + 2, w[1], true);
    v.setInt16(o + 4, w[2], true);
    v.setUint8(o + 6, w[3]);
    v.setUint8(o + 7, w[4]);
    v.setUint8(o + 8, w[5]);
    v.setUint8(o + 9, w[6]);
    v.setUint8(o + 10, w[7]);
  });
  return buf;
}

describe('baked car model', () => {
  it('parses the header and vertices', () => {
    const m = parseCar(file());
    expect(m.count).toBe(6);
    expect(m.body).toEqual([153, 153, 158]);
    expect(m.pos[3]).toBe(1000);
    expect(m.pos[14]).toBe(500);
    expect(m.shade[2]).toBe(128);
    expect(Array.from(m.paint)).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('paints body coloured vertices the chosen colour, shaded, and leaves the rest', () => {
    const d = carMesh(parseCar(file()), '#ff0000');
    expect(d.length).toBe(36);
    expect(d[0]).toBe(0);
    expect(d[6]).toBeCloseTo(1, 6);
    expect(Array.from(d.slice(3, 6))).toEqual([1, 0, 0]);
    expect(d[2 * 6 + 3]).toBeCloseTo(128 / 255, 6);
    expect(d[3 * 6 + 3]).toBeCloseTo(20 / 255, 6);
    expect(d[3 * 6 + 2]).toBeCloseTo(0.5, 6);
  });

  it('refuses other files', () => {
    expect(() => parseCar(new ArrayBuffer(4))).toThrow();
    const b = file();
    new DataView(b).setUint8(0, 88);
    expect(() => parseCar(b)).toThrow();
  });
});
