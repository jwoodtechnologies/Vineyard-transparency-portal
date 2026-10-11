/** "/" opens search unless the reader is typing somewhere or holding a modifier key. */
export function isSearchShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; defaultPrevented: boolean }, target: unknown): boolean {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return false;
  const el = target as { closest?: (selector: string) => unknown } | null;
  if (!el || typeof el.closest !== 'function') return true;
  return !el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}
