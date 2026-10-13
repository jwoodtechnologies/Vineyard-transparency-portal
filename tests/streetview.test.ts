import { describe, expect, it } from 'vitest';
import { geodeticToEnu } from 'mapillary-js';
import { destination, distance, type Pos } from '../src/console/measure/geo';
import { bearingToPin, centerOnPin, clampFlatCenter, coneRing, nearestPhoto, parsePhotos, photoSearchUrl, rankPhotos, ringToLocal, turn, type Photo } from '../src/console/streetview/geo';

const PIN: Pos = [-111.7445, 40.305];
/** A photo `m` meters from the pin in direction `from` (degrees from north). */
const photo = (id: string, m: number, from: number, extra: Partial<Photo> = {}): Photo => ({ id, pos: destination(PIN, from, m), compass: null, pano: true, capturedAt: 0, ...extra });

describe('nearest photo', () => {
  it('opens the nearest photo within 60 m', () => {
    expect(nearestPhoto([photo('far', 45, 0), photo('near', 12, 90), photo('mid', 30, 180)], PIN)?.id).toBe('near');
  });

  it('has none when every photo is more than 60 m away', () => {
    expect(nearestPhoto([photo('a', 61, 0), photo('b', 200, 90)], PIN)).toBeNull();
    expect(nearestPhoto([], PIN)).toBeNull();
  });

  it('passes over a flat photo facing away from the pin for one that can show it', () => {
    // 10 m south of the pin facing south (away), and 25 m west facing east (toward it).
    const away = photo('away', 10, 180, { pano: false, compass: 180 });
    const toward = photo('toward', 25, 270, { pano: false, compass: 90 });
    expect(nearestPhoto([away, toward], PIN)?.id).toBe('toward');
    // A 360 degree photo can always be turned, so the nearer one wins.
    expect(nearestPhoto([{ ...away, pano: true }, toward], PIN)?.id).toBe('away');
  });

  it('lists the others in order, to try when the best one does not load', () => {
    expect(rankPhotos([photo('far', 45, 0), photo('near', 12, 90), photo('mid', 30, 180), photo('out', 80, 0)], PIN).map((p) => p.id)).toEqual(['near', 'mid', 'far']);
  });

  it('prefers a 360 degree photo, then the newest day, among photos at about the same spot', () => {
    const day = 86_400_000;
    const old = photo('2017', 4, 0, { pano: false, capturedAt: 100 * day });
    const newer = photo('2020', 9, 90, { pano: false, capturedAt: 1200 * day });
    const sphere = photo('360', 12, 180, { pano: true, capturedAt: 50 * day });
    expect(rankPhotos([old, newer], PIN).map((p) => p.id)).toEqual(['2020', '2017']);
    expect(rankPhotos([old, newer, sphere], PIN).map((p) => p.id)).toEqual(['360', '2020', '2017']);
    // Much farther than the nearest: distance still wins.
    expect(nearestPhoto([old, photo('far360', 40, 0, { pano: true, capturedAt: 1300 * day })], PIN)?.id).toBe('2017');
  });

  it('takes the newest of two photos at the same spot', () => {
    expect(nearestPhoto([photo('old', 10, 0, { capturedAt: 1 }), photo('new', 10, 0, { capturedAt: 2 })], PIN)?.id).toBe('new');
  });

  it('reads the Graph API answer, preferring computed positions and angles', () => {
    const list = parsePhotos({
      data: [
        { id: '1', computed_geometry: { coordinates: [-111.744, 40.305] }, geometry: { coordinates: [-111.7, 40.3] }, computed_compass_angle: 370, compass_angle: 10, is_pano: true, captured_at: 5 },
        { id: 2, geometry: { coordinates: [-111.745, 40.306] }, compass_angle: 45 },
        { id: '3' },
        { geometry: { coordinates: [-111.745, 40.306] } },
      ],
    });
    expect(list).toEqual([
      { id: '1', pos: [-111.744, 40.305], compass: 10, pano: true, capturedAt: 5 },
      { id: '2', pos: [-111.745, 40.306], compass: 45, pano: false, capturedAt: null },
    ]);
    expect(parsePhotos(null)).toEqual([]);
  });

  it('searches a box about 60 m each way around the pin', () => {
    const u = new URL(photoSearchUrl('MLY|1|abc', PIN));
    expect(u.host).toBe('graph.mapillary.com');
    const [w, s, e, n] = u.searchParams.get('bbox')!.split(',').map(Number);
    expect(distance([w, PIN[1]], PIN)).toBeCloseTo(60, 0);
    expect(distance([PIN[0], n], PIN)).toBeCloseTo(60, 0);
    expect(e - PIN[0]).toBeCloseTo(PIN[0] - w, 8);
    expect(n - PIN[1]).toBeCloseTo(PIN[1] - s, 8);
  });
});

describe('facing the pin', () => {
  it('gives the bearing from the photo to the pin', () => {
    expect(bearingToPin(photo('s', 20, 180), PIN)).toBeCloseTo(0, 3); // taken south of the pin: look north
    expect(bearingToPin(photo('w', 20, 270), PIN)).toBeCloseTo(90, 3);
    expect(bearingToPin(photo('ne', 20, 45), PIN)).toBeCloseTo(225, 0);
  });

  it('takes the short way round', () => {
    expect(turn(350, 10)).toBe(20);
    expect(turn(10, 350)).toBe(-20);
    expect(turn(0, 180)).toBe(180);
  });

  it('keeps the view of a flat photo inside the photo', () => {
    // A 4:3 photo about 70 degrees wide (focal 0.7), a 40 degree tall view at 16:10.
    const c = (x: number, y = 0.5) => clampFlatCenter([x, y], 40, 1.6, 0.7, 4000, 3000);
    expect(c(0.5)).toEqual([0.5, 0.5]);
    const left = c(0.05)[0];
    expect(left).toBeGreaterThan(0.05);
    expect(left).toBeLessThan(0.5);
    expect(c(0.95)[0]).toBeCloseTo(1 - left, 6);
    // The left edge of the view lands on the left edge of the photo.
    const viewHalf = Math.atan(Math.tan((20 * Math.PI) / 180) * 1.6);
    expect(Math.atan(((left - 0.5) * 1) / 0.7) - viewHalf).toBeCloseTo(-Math.atan(0.5 / 0.7), 6);
    // Wider than the photo: centered.
    expect(clampFlatCenter([0.2, 0.5], 80, 3, 0.7, 4000, 3000)[0]).toBe(0.5);
  });

  it('centers a 360 degree photo on the pin and turns a flat one as far as it can', () => {
    // Camera facing east, pin to its north: a quarter turn left.
    expect(centerOnPin(photo('p', 20, 180, { compass: 90 }), PIN)[0]).toBeCloseTo(0.25, 3);
    expect(centerOnPin(photo('p', 20, 180, { compass: 0 }), PIN)[0]).toBeCloseTo(0.5, 3);
    expect(centerOnPin(photo('f', 20, 180, { compass: 0, pano: false }), PIN)).toEqual([0.5, 0.55]);
    expect(centerOnPin(photo('f', 20, 180, { compass: 90, pano: false }), PIN)[0]).toBe(0.05);
  });

  it('draws the camera cone along the view', () => {
    const ring = coneRing(PIN, 90, 60, 25);
    expect(ring[0]).toEqual(PIN);
    expect(ring[ring.length - 1]).toEqual(PIN);
    for (const p of ring.slice(1, -1)) expect(distance(PIN, p)).toBeCloseTo(25, 3);
  });
});

describe('zoning in the photo', () => {
  it('turns a district outline into local meters at ground level with MapillaryJS geodeticToEnu', () => {
    const ref = { lng: -111.745, lat: 40.305, alt: 1382 };
    const square: Pos[] = [destination([ref.lng, ref.lat], 90, 100), destination(destination([ref.lng, ref.lat], 90, 100), 0, 50), destination([ref.lng, ref.lat], 0, 50), [ref.lng, ref.lat]];
    const flat = ringToLocal([...square, square[0]], ref, 1380, geodeticToEnu);
    expect(flat).toHaveLength(12); // four points, the closing one left out
    const xyz = (i: number) => flat.slice(i * 3, i * 3 + 3);
    expect(xyz(0)[0]).toBeCloseTo(100, 0);
    expect(xyz(0)[1]).toBeCloseTo(0, 0);
    expect(xyz(1)[1]).toBeCloseTo(50, 0);
    expect(xyz(3)[0]).toBeCloseTo(0, 6);
    // Two meters below the reference, bent down only by the earth's curve (under a millimeter at 100 m).
    for (let i = 0; i < 4; i++) expect(xyz(i)[2]).toBeCloseTo(-2, 2);
  });
});

describe('moving in the photo', () => {
  it('steps forward along the street for a click straight ahead, keeping the heading', async () => {
    const { aheadTo } = await import('../src/console/streetview/nearby');
    const ahead = (m: number, side: number, extra: Partial<Photo>) => ({ ...photo('x', 0, 0), pos: destination(destination(PIN, 0, m), 90, side), ...extra });
    // Camera at the pin facing north; a click 12 m ahead.
    const target = destination(PIN, 0, 12);
    const sideways = ahead(11, 3, { id: 'side', pano: false, compass: 90 });
    const along = ahead(10, 0, { id: 'along', pano: false, compass: 2 });
    expect(aheadTo([sideways, along], PIN, 0, target, null)?.id).toBe('along');
    // A 360 degree photo ahead can be turned to keep the heading.
    expect(aheadTo([sideways, ahead(13, 1, { id: 'sphere', pano: true })], PIN, 0, target, null)?.id).toBe('sphere');
    // A click off to the side is not a step forward.
    expect(aheadTo([along], PIN, 0, destination(PIN, 90, 12), null)).toBeNull();
    // Behind the camera never counts.
    expect(aheadTo([ahead(-8, 0, { id: 'behind', pano: true })], PIN, 0, target, null)).toBeNull();
  });
});
