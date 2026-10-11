/**
 * Zoom for the record viewer, the same for both viewers. Percent is of the page's actual size (100% draws a
 * letter page 8.5 inches, 816 CSS px, wide), as the browser's own PDF viewer counts it.
 *
 * - auto (the first view): the page fits the width, but on a computer screen it is made smaller (down to
 *   AUTO_MIN_PCT) so most of the first page shows without scrolling;
 * - width: fit to width;
 * - pct: a set percent, from the zoom buttons.
 */
export type Zoom = { mode: 'auto' } | { mode: 'width' } | { mode: 'pct'; pct: number };

export const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];
/** The auto view never draws the page smaller than this (text stays readable). */
export const AUTO_MIN_PCT = 75;
/** CSS px per PDF point (72 points to the inch, 96 CSS px to the inch). */
export const PX_PER_PT = 96 / 72;
/** A letter page at 100%, in CSS px: the browser's own viewer does not say the page size, so it is assumed there. */
export const LETTER = { width: 816, ratio: 11 / 8.5 };
/** Above the page when the viewer toolbar is stuck under the site header: header, toolbar, page margins. */
export const CHROME_PX = 65 + 48 + 32;

/** The next zoom step up (dir 1) or down (dir -1) from the percent now on screen. */
export function zoomStep(current: number, dir: 1 | -1, max = ZOOM_STEPS[ZOOM_STEPS.length - 1]): number {
  const steps = ZOOM_STEPS.filter((s) => s <= max);
  if (dir > 0) return steps.find((s) => s > current + 1) ?? steps[steps.length - 1];
  return [...steps].reverse().find((s) => s < current - 1) ?? steps[0];
}

/** The page's width on screen in CSS px. `fit` is the width available; `pageWidth` the page at 100%; `ratio` its height over width. */
export function pageCssWidth(zoom: Zoom, fit: number, pageWidth: number, ratio: number, viewportHeight: number): number {
  if (zoom.mode === 'width') return fit;
  if (zoom.mode === 'pct') return Math.round((pageWidth * zoom.pct) / 100);
  const wholePage = Math.max(200, viewportHeight - CHROME_PX) / ratio;
  return Math.round(Math.min(fit, Math.max((pageWidth * AUTO_MIN_PCT) / 100, wholePage)));
}

/**
 * The fragment for the browser's own PDF viewer: the page, the zoom, and no viewer toolbar or side panel
 * (toolbar=0 and navpanes=0: Chrome and Edge; Firefox shows its own toolbar regardless). Fit to width is
 * view=FitH for Chrome and Edge, zoom=page-width for Firefox; each ignores the other's.
 */
export function nativeFragment(page: number, zoom: Zoom, autoPct: number): string {
  const z = zoom.mode === 'width' ? 'zoom=page-width&view=FitH' : `zoom=${zoom.mode === 'pct' ? zoom.pct : autoPct}`;
  return `page=${Math.max(1, Math.floor(page))}&${z}&toolbar=0&navpanes=0`;
}
