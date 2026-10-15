import { describe, expect, it } from 'vitest';
import { TAP_MS, TAP_SLOP_PX, TapGuard } from '../src/console/streetview/tapGuard';

describe('click versus drag', () => {
  it('counts a still, quick press as a click', () => {
    const g = new TapGuard();
    g.down(1, 100, 100, 0, false);
    expect(g.up(1, 100, 100, 120)).toEqual({ x: 100, y: 100, touch: false });
  });

  it('allows a small wobble of up to 6 px', () => {
    const g = new TapGuard();
    g.down(1, 100, 100, 0, true);
    g.move(1, 104, 103);
    expect(g.up(1, 103, 104, 200)).toEqual({ x: 103, y: 104, touch: true });
  });

  it('refuses a move past 6 px, even one that comes back before release (drag then release)', () => {
    const g = new TapGuard();
    g.down(1, 100, 100, 0, false);
    g.move(1, 100 + TAP_SLOP_PX + 1, 100);
    expect(g.dragging).toBe(true);
    g.move(1, 100, 100);
    expect(g.up(1, 100, 100, 150)).toBeNull();
    // A 200 px drag to look around.
    g.down(1, 100, 100, 1000, false);
    for (let i = 1; i <= 20; i++) g.move(1, 100 + i * 10, 100);
    expect(g.up(1, 300, 100, 1300)).toBeNull();
  });

  it('refuses a long press', () => {
    const g = new TapGuard();
    g.down(1, 50, 50, 0, true);
    expect(g.up(1, 50, 50, TAP_MS + 1)).toBeNull();
    g.down(1, 50, 50, 1000, true);
    expect(g.up(1, 50, 50, 1000 + TAP_MS)).not.toBeNull();
  });

  it('never counts a pinch or twist, whichever finger lifts first', () => {
    const g = new TapGuard();
    g.down(1, 100, 100, 0, true);
    g.down(2, 200, 200, 20, true);
    expect(g.up(2, 200, 200, 80)).toBeNull();
    expect(g.up(1, 100, 100, 100)).toBeNull();
    g.down(1, 100, 100, 500, true);
    g.down(2, 200, 200, 520, true);
    expect(g.up(1, 100, 100, 560)).toBeNull();
    expect(g.up(2, 200, 200, 580)).toBeNull();
    // And the next lone tap works again.
    g.down(3, 10, 10, 1000, true);
    expect(g.up(3, 10, 10, 1050)).not.toBeNull();
  });

  it('refuses a press with a wheel turn in it, a right button, or a cancelled pointer', () => {
    const g = new TapGuard();
    g.down(1, 10, 10, 0, false);
    g.wheel();
    expect(g.up(1, 10, 10, 50)).toBeNull();
    g.down(1, 10, 10, 100, false, 2);
    expect(g.up(1, 10, 10, 150)).toBeNull();
    g.down(1, 10, 10, 200, true);
    g.cancel(1);
    expect(g.up(1, 10, 10, 250)).toBeNull();
  });

  it('ignores a wheel with nothing pressed, and an up with no down', () => {
    const g = new TapGuard();
    g.wheel();
    expect(g.up(1, 0, 0, 10)).toBeNull();
    g.down(1, 0, 0, 20, false);
    expect(g.up(1, 0, 0, 40)).not.toBeNull();
  });

  it('can allow a long still press as a tap (Drive mode)', () => {
    const g = new TapGuard(Infinity);
    g.down(1, 100, 100, 0, true);
    expect(g.up(1, 102, 101, 2000)).toEqual({ x: 102, y: 101, touch: true });
    const strict = new TapGuard();
    strict.down(1, 100, 100, 0, true);
    expect(strict.up(1, 100, 100, 2000)).toBeNull();
  });
});
