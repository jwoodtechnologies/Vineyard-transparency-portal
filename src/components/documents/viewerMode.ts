/**
 * Which viewer shows a PDF on this device.
 *
 * - pdfjs (every device): the portal's own pages, drawn with pdf.js under the portal's one toolbar. The
 *   browser's own viewer brings its own dark toolbar, which current Chrome shows even when the address asks
 *   it not to (toolbar=0), so two toolbars stack; Android Chrome has no inline viewer at all, and Safari on
 *   iPhone and iPad shows only the first page as a still image.
 * - native: the browser's own PDF viewer in a same-origin frame, only when asked for with `?viewer=native`.
 *
 * `?viewer=pdfjs` or `?viewer=native` on a record's address picks one (used by the nightly document check).
 */
export type ViewerMode = 'native' | 'pdfjs';

export interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  pdfViewerEnabled?: boolean;
}

export function isPhoneOrTablet(nav: NavigatorLike): boolean {
  const ua = nav.userAgent;
  if (/iPhone|iPad|iPod|Android|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPadOS reports itself as a Mac; a Mac has no touch screen.
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

export function viewerMode(nav: NavigatorLike, override?: string | null): ViewerMode {
  if (override === 'pdfjs' || override === 'native') return override;
  void nav;
  return 'pdfjs';
}
