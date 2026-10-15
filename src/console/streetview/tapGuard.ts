/**
 * Tells a deliberate click or tap from a drag, pan, pinch, twist or scroll, so street view only moves
 * someone on purpose. A press counts as a click only when one pointer went down and came back up within
 * TAP_SLOP_PX of where it started (at every moment, not just at the end) and within TAP_MS, with no second
 * pointer and no wheel in between. The click that ends a drag is never reported, because clicks come from
 * here, not from the browser's or the map's click event.
 */
export const TAP_SLOP_PX = 6;
export const TAP_MS = 350;

export interface Tap {
  x: number;
  y: number;
  touch: boolean;
}

interface Press {
  id: number;
  x: number;
  y: number;
  t: number;
  touch: boolean;
  spoiled: boolean;
}

export class TapGuard {
  private press: Press | null = null;
  private pointers = new Set<number>();

  /** `maxMs`: how long a press may last and still be a tap (Drive mode, where holding still means nothing else, allows any). */
  constructor(private maxMs = TAP_MS) {}

  /** A pointer went down; `button` is the mouse button (0 for touch and pens). */
  down(id: number, x: number, y: number, t: number, touch: boolean, button = 0): void {
    this.pointers.add(id);
    if (this.pointers.size > 1) {
      // A second finger: a pinch or twist, never a tap, until every finger is up.
      if (this.press) this.press.spoiled = true;
      return;
    }
    this.press = { id, x, y, t, touch, spoiled: button !== 0 };
  }

  move(id: number, x: number, y: number): void {
    const p = this.press;
    if (!p || p.id !== id) return;
    if (Math.hypot(x - p.x, y - p.y) > TAP_SLOP_PX) p.spoiled = true;
  }

  /** A wheel turn (or trackpad scroll or pinch) while pressed spoils the press. */
  wheel(): void {
    if (this.press) this.press.spoiled = true;
  }

  /** A pointer came up: the tap, if this press was one. */
  up(id: number, x: number, y: number, t: number): Tap | null {
    this.pointers.delete(id);
    const p = this.press;
    if (!p) return null;
    if (p.id !== id) {
      if (!this.pointers.size) this.press = null;
      return null;
    }
    this.press = null;
    if (this.pointers.size) return null;
    this.move(id, x, y);
    const ok = !p.spoiled && Math.hypot(x - p.x, y - p.y) <= TAP_SLOP_PX && t - p.t <= this.maxMs;
    return ok ? { x, y, touch: p.touch } : null;
  }

  /** The browser took the pointer over (a scroll, or the window lost it). */
  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.press) this.press.spoiled = true;
    if (!this.pointers.size) this.press = null;
  }

  /** True while a press has moved past the slop: a drag in progress. */
  get dragging(): boolean {
    return Boolean(this.press?.spoiled && this.pointers.size);
  }
}
