import { describe, expect, it } from 'vitest';
import { mercator, roofColor, tileAt, tileBounds, tileUrl } from '../src/console/scene/aerial';

describe('reading roof colours off the county aerial', () => {
  it('finds the tile and its bounds, and builds the county address', () => {
    const [x, y] = tileAt(-111.7455, 40.3035, 17);
    expect([x, y]).toEqual([24850, 49476]);
    const b = tileBounds(17, x, y);
    const m = mercator(-111.7455, 40.3035);
    expect(m[0]).toBeGreaterThan(b[0]);
    expect(m[0]).toBeLessThan(b[2]);
    expect(m[1]).toBeGreaterThan(b[1]);
    expect(m[1]).toBeLessThan(b[3]);
    expect(b[2] - b[0]).toBeCloseTo(305.75, 1);
    expect(tileUrl('https://x/export?bbox={bbox-epsg-3857}&size=512,512', 17, x, y)).toContain(`bbox=${b.join(',')}`);
  });

  it("averages the pixels inside the outline, lifted a little for the photo's shadows", () => {
    const px = 16;
    const bounds: [number, number, number, number] = [0, 0, 16, 16];
    const rgba = new Uint8ClampedArray(px * px * 4);
    for (let i = 0; i < px * px; i++) {
      const x = i % px;
      // Left half brown, right half green, all opaque.
      rgba.set(x < 8 ? [120, 80, 60, 255] : [40, 140, 40, 255], i * 4);
    }
    // A ring over the left half only, given as the inverse of mercator: use tiny longitudes near 0.
    const inv = (mx: number, my: number): [number, number] => [(mx / 20037508.342789244) * 180, (Math.atan(Math.exp((my / 20037508.342789244) * Math.PI)) * 360) / Math.PI - 90];
    const ring = [inv(1, 1), inv(7, 1), inv(7, 15), inv(1, 15)];
    const c = roofColor(ring, rgba, px, bounds)!;
    expect(c[0]).toBeCloseTo(Math.min(1, (120 / 255) * 1.12 + 0.03), 2);
    expect(c[1]).toBeCloseTo(Math.min(1, (80 / 255) * 1.12 + 0.03), 2);
    expect(roofColor([inv(100, 100), inv(101, 100), inv(101, 101)], rgba, px, bounds)).toBeNull();
  });
});
