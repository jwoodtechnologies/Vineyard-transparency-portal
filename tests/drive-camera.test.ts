import { describe, expect, it } from 'vitest';
import { CHASE, dragged, ease, easeAngle, isChase, lead, PITCH_MAX, PITCH_MIN, wrap, ZOOM_MAX, ZOOM_MIN, zoomed } from '../src/console/drive/camera';

describe('Drive camera', () => {
  it('turns all the way around the car with a drag and keeps the tilt in range', () => {
    let v = CHASE;
    // About 1,030 px of dragging is a full circle.
    for (let i = 0; i < 10; i++) v = dragged(v, 103, 0);
    expect(Math.abs(wrap(v.yaw))).toBeLessThan(2);
    v = dragged(CHASE, 0, -1000);
    expect(v.pitch).toBe(PITCH_MAX);
    v = dragged(CHASE, 0, 1000);
    expect(v.pitch).toBe(PITCH_MIN);
  });

  it('zooms from close behind the car out to a view over the town, no further', () => {
    expect(zoomed(CHASE, -20).zoom).toBe(ZOOM_MIN);
    expect(zoomed(CHASE, 20).zoom).toBe(ZOOM_MAX);
    expect(zoomed(CHASE, -1).zoom).toBeCloseTo(CHASE.zoom - 1);
  });

  it('eases toward the target the same way at 30 or 60 frames a second, never past it', () => {
    const target = { yaw: 90, pitch: 40, zoom: 17 };
    let a = CHASE,
      b = CHASE;
    for (let i = 0; i < 30; i++) a = ease(a, target, 1 / 30);
    for (let i = 0; i < 60; i++) b = ease(b, target, 1 / 60);
    expect(a.yaw).toBeCloseTo(b.yaw, 6);
    expect(a.zoom).toBeCloseTo(b.zoom, 6);
    expect(a.yaw).toBeLessThanOrEqual(90);
    expect(a.yaw).toBeGreaterThan(89);
    // A zero length frame changes nothing.
    expect(ease(CHASE, target, 0)).toEqual(CHASE);
  });

  it('turns the short way round across north', () => {
    const v = ease({ ...CHASE, yaw: 170 }, { ...CHASE, yaw: -170 }, 0.05);
    expect(Math.abs(v.yaw)).toBeGreaterThan(170);
    expect(easeAngle(350, 10, 0.05, 8)).toBeGreaterThan(350 - 360);
    expect(Math.abs(wrap(easeAngle(350, 10, 10, 8) - 10))).toBeLessThan(0.01);
  });

  it('keeps the car low in the view up close and centered from high up, and knows the chase view', () => {
    expect(lead(CHASE.zoom)).toBeCloseTo(7);
    expect(lead(ZOOM_MIN)).toBe(0);
    expect(isChase(CHASE)).toBe(true);
    expect(isChase(dragged(CHASE, 40, 0))).toBe(false);
  });
});
