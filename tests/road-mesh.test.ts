import { describe, expect, it } from 'vitest';
import { MeshOut } from '../src/console/scene/buildingMesh';
import { crosswalk, dashes, road, roadWidth, roadsMesh, samples, stopSign, strip } from '../src/console/scene/roadMesh';

const tops = (data: number[]) => {
  let z = -Infinity;
  for (let i = 2; i < data.length; i += 6) z = Math.max(z, data[i]);
  return z;
};

describe('road furniture meshes', () => {
  it('widths by road class, lanes override', () => {
    expect(roadWidth('residential')).toBe(8);
    expect(roadWidth('primary')).toBe(14);
    expect(roadWidth('service')).toBe(5.5);
    expect(roadWidth('residential', 4)).toBeCloseTo(13.6, 6);
  });

  it('samples a line every step with its direction and ground height', () => {
    const s = samples([[0, 0], [10, 0], [10, 10]], [0, 2, 4], 5);
    expect(s.map((q) => q.s)).toEqual([0, 5, 10, 15, 20]);
    expect(s[1].p).toEqual([5, 0]);
    expect(s[1].z).toBeCloseTo(1, 6);
    expect(s[3].d).toEqual([0, 1]);
    expect(s[3].p[1]).toBeCloseTo(5, 6);
  });

  it('draws a strip, dashes with gaps, and a stop sign that stands 2.2 m tall', () => {
    const out = new MeshOut();
    strip(out, [[0, 0], [20, 0]], [0, 0], 0, 1, 0.03, [1, 1, 1]);
    expect(out.data.length % 18).toBe(0);
    expect(tops(out.data)).toBeCloseTo(0.03, 6);
    const d = new MeshOut();
    dashes(d, [[0, 0], [24, 0]], [0, 0], 0, 0.12, 3, 9, 0.03, [1, 1, 0]);
    // 24 m at a 12 m period: two dashes, two quads of two triangles.
    expect(d.data.length / 18).toBe(4);
    const s = new MeshOut();
    stopSign(s, { at: [0, 0], dz: 0, kind: 'stop', along: 0 });
    expect(tops(s.data)).toBeCloseTo(2.2 + 0.38, 1);
    const sig = new MeshOut();
    stopSign(sig, { at: [0, 0], dz: 1, kind: 'traffic_signals', along: 0 });
    expect(tops(sig.data)).toBeGreaterThan(5);
  });

  it('marks a neighbourhood street with a dashed centre line and curbs, a service road with nothing, a crossing with bars', () => {
    const r = new MeshOut();
    road(r, { coords: [[0, 0], [50, 0]], dz: [0, 0], highway: 'residential' });
    expect(r.data.length).toBeGreaterThan(0);
    expect(tops(r.data)).toBeCloseTo(0.14, 6);
    const sv = new MeshOut();
    road(sv, { coords: [[0, 0], [50, 0]], dz: [0, 0], highway: 'service' });
    expect(sv.data.length).toBe(0);
    const c = new MeshOut();
    crosswalk(c, { at: [0, 0], dz: 0, along: 0, width: 8 });
    expect(c.data.length / 18).toBe(16);
    const all = roadsMesh([{ coords: [[0, 0], [50, 0]], dz: [0, 0], highway: 'primary', lanes: 4 }], [{ coords: [[0, 5], [50, 5]], dz: [0, 0], sidewalk: true }], [], []);
    expect(all).toBeInstanceOf(Float32Array);
    expect(all.length).toBeGreaterThan(0);
  });
});
