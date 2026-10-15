import { describe, expect, it } from 'vitest';
import { ClickRouter, DOUBLE_MS, featureAt } from '../src/console/streetview/clickRoute';
import { TapGuard } from '../src/console/streetview/tapGuard';

describe('street view click routing', () => {
  it('moves on a single click when Zoning and Projects are off', () => {
    const r = new ClickRouter();
    expect(r.click(100, 100, 0, false, true)).toEqual({ now: { kind: 'move' }, later: null });
    expect(r.click(300, 100, 1000, false, false)).toEqual({ now: { kind: 'move' }, later: null });
  });

  it('opens the details card for a click on a feature, after the double click window', () => {
    const r = new ClickRouter();
    expect(r.click(100, 100, 0, true, true)).toEqual({ now: { kind: 'none' }, later: { kind: 'card' } });
    // A click on bare ground with layers on does nothing (no move, no card).
    expect(r.click(400, 400, 2000, true, false)).toEqual({ now: { kind: 'none' }, later: null });
  });

  it('moves on a double click with layers on, and the double click opens no card', () => {
    const r = new ClickRouter();
    const first = r.click(100, 100, 0, true, true);
    expect(first.later).toEqual({ kind: 'card' });
    // The caller cancels `later` on the second click; the second click moves.
    expect(r.click(104, 98, DOUBLE_MS - 10, true, true)).toEqual({ now: { kind: 'move' }, later: null });
    // A third click right after starts over (no triple click move).
    expect(r.click(104, 98, DOUBLE_MS + 20, true, true).now).toEqual({ kind: 'none' });
  });

  it('treats two far apart or slow clicks as two single clicks', () => {
    const r = new ClickRouter();
    r.click(100, 100, 0, true, true);
    expect(r.click(200, 100, 100, true, true).now).toEqual({ kind: 'none' });
    expect(r.click(200, 100, 100 + DOUBLE_MS + 1, true, true).now).toEqual({ kind: 'none' });
  });

  it('does nothing for a drag: the click never reaches the router', () => {
    const g = new TapGuard();
    const r = new ClickRouter();
    g.down(1, 100, 100, 0, false);
    for (let i = 1; i <= 20; i++) g.move(1, 100 + i * 10, 100);
    const tap = g.up(1, 300, 100, 400);
    expect(tap).toBeNull();
    // And a drag between two clicks does not join them into a double click: only taps are routed.
    expect(r.click(100, 100, 0, true, true).now.kind).toBe('none');
  });
});

describe('feature under a ground point', () => {
  const square = (x: number, y: number, s: number) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] as Array<[number, number]>;
  const zone = { layer: 'zoning', name: 'R-1-10', rings: [square(0, 0, 10)] };
  const small = { layer: 'zoning', name: 'C-2', rings: [square(2, 2, 2)] };
  const project = { layer: 'projects', name: 'Main Street', rings: [square(1, 1, 8)] };

  it('picks projects first, then the smallest zone', () => {
    expect(featureAt([zone, small, project], [3, 3])?.name).toBe('Main Street');
    expect(featureAt([zone, small], [3, 3])?.name).toBe('C-2');
    expect(featureAt([zone, small], [8, 8])?.name).toBe('R-1-10');
    expect(featureAt([zone], [20, 20])).toBeNull();
  });
});
