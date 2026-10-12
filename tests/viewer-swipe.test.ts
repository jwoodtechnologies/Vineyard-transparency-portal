import { describe, expect, it } from 'vitest';
import { isTypingTarget, swipeDirection } from '../src/components/documents/gestures';

const start = (atLeft = true, atRight = true) => ({ x: 300, y: 400, t: 0, atLeft, atRight });

describe('viewer swipe', () => {
  it('a quick sideways swipe moves to the next or previous record', () => {
    expect(swipeDirection(start(), { x: 120, y: 410, t: 300 }, false)).toBe(1);
    expect(swipeDirection({ ...start(), x: 100 }, { x: 280, y: 395, t: 300 }, false)).toBe(-1);
  });
  it('never during a pinch, a mostly vertical scroll, a short or slow drag', () => {
    expect(swipeDirection(start(), { x: 120, y: 410, t: 300 }, true)).toBe(0);
    expect(swipeDirection(start(), { x: 200, y: 600, t: 300 }, false)).toBe(0);
    expect(swipeDirection(start(), { x: 260, y: 400, t: 300 }, false)).toBe(0);
    expect(swipeDirection(start(), { x: 120, y: 400, t: 2000 }, false)).toBe(0);
  });
  it('a zoomed page scrolls sideways first; at its edge the swipe moves on', () => {
    expect(swipeDirection(start(true, false), { x: 120, y: 400, t: 300 }, false)).toBe(0);
    expect(swipeDirection(start(false, true), { x: 120, y: 400, t: 300 }, false)).toBe(1);
  });
  it('arrow keys in a text box stay there', () => {
    const box = { isContentEditable: false, closest: (s: string) => (s.includes('input') ? {} : null) } as unknown as EventTarget;
    const button = { isContentEditable: false, closest: () => null } as unknown as EventTarget;
    expect(isTypingTarget(box)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
