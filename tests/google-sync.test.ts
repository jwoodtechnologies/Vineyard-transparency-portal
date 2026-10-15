import { describe, expect, it } from 'vitest';
import { distance } from '../src/console/measure/geo';
import { clampSplit, fromGoogleZoom, headingCone, needsPan, normHeading, panoFov, parcelTiles, splitAt, toGoogleZoom } from '../src/console/streetview/googleSync';
import type { Pos } from '../src/console/streetview/geo';

const PIN: Pos = [-111.7445, 40.305];
const VIEW = { west: -111.75, south: 40.30, east: -111.74, north: 40.31 };

describe('Google map and panorama sync', () => {
  it('maps zoom both ways, one level apart, so Close returns to the same zoom', () => {
    expect(toGoogleZoom(17)).toBe(18);
    expect(fromGoogleZoom(18)).toBe(17);
    expect(fromGoogleZoom(toGoogleZoom(16.4))).toBe(16);
    expect(toGoogleZoom(30)).toBe(21);
    expect(toGoogleZoom(-5)).toBe(3);
  });

  it('turns the panorama heading into a cone facing the same way on the map', () => {
    expect(normHeading(-90)).toBe(270);
    expect(normHeading(725)).toBe(5);
    const cone = headingCone(PIN, 90, 1);
    expect(cone[0]).toEqual(PIN);
    const tip = cone[Math.floor(cone.length / 2)];
    // Facing east: the middle of the arc is east of the camera, at the cone's length.
    expect(tip[0]).toBeGreaterThan(PIN[0]);
    expect(Math.abs(tip[1] - PIN[1])).toBeLessThan(1e-4);
    expect(distance(PIN, tip)).toBeCloseTo(28, 0);
  });

  it('narrows the cone as the panorama zooms in', () => {
    expect(panoFov(1)).toBe(90);
    expect(panoFov(2)).toBe(45);
    expect(panoFov(0)).toBe(120);
    expect(panoFov(9)).toBe(10);
  });

  it('moves the map only when the panorama nears an edge', () => {
    expect(needsPan(VIEW, [-111.745, 40.305])).toBe(false);
    expect(needsPan(VIEW, [-111.7409, 40.305])).toBe(true);
    expect(needsPan(VIEW, [-111.76, 40.305])).toBe(true);
    expect(needsPan(VIEW, [-111.745, 40.3091])).toBe(true);
  });

  it('keeps the divider between 30 and 75 percent for the panorama', () => {
    expect(clampSplit(0.1)).toBe(0.3);
    expect(clampSplit(0.9)).toBe(0.75);
    expect(clampSplit(Number.NaN)).toBe(0.5);
    // Side by side, the panorama is on the right: dragging the divider left gives it more room.
    expect(splitAt(400, 0, 1000, false)).toBeCloseTo(0.6);
    // Stacked, it is on top: dragging the handle down gives it more room.
    expect(splitAt(500, 100, 800, true)).toBeCloseTo(0.5);
    expect(splitAt(5000, 0, 800, true)).toBe(0.75);
  });

  it('lists the parcel tiles in view, and none when zoomed out too far', () => {
    const t = parcelTiles({ west: -111.7460, south: 40.3040, east: -111.7430, north: 40.3060 });
    expect(t.length).toBeGreaterThan(0);
    expect(t.length).toBeLessThanOrEqual(4);
    expect(parcelTiles(VIEW).length).toBeGreaterThan(t.length);
    expect(parcelTiles({ west: -112, south: 40, east: -111.5, north: 40.5 })).toEqual([]);
  });
});
