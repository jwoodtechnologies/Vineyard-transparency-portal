/** Keyboard and touch rules for moving between records in the viewer (pure, tested in tests/viewer-swipe.test.ts). */

/** True when a key press belongs to a text field (arrow keys there move the caret, never the record). */
export function isTypingTarget(t: unknown): boolean {
  const el = t as { isContentEditable?: boolean; closest?: (selector: string) => unknown } | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.isContentEditable || el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

/**
 * A horizontal swipe on the viewer: one finger, mostly sideways, quick and long enough. Never during a pinch
 * (two fingers, or the page already zoomed by the browser), and only when a page wider than the screen has
 * already been scrolled to its edge in that direction (otherwise the swipe scrolls the page).
 */
export function swipeDirection(
  start: { x: number; y: number; t: number; atLeft: boolean; atRight: boolean },
  end: { x: number; y: number; t: number },
  pinched: boolean,
): -1 | 1 | 0 {
  if (pinched) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy) || end.t - start.t > 800) return 0;
  if (dx < 0) return start.atRight ? 1 : 0;
  return start.atLeft ? -1 : 0;
}
