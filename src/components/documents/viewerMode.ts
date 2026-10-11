/**
 * Which viewer shows a PDF on this device.
 *
 * - native: the browser's own PDF viewer in a same-origin frame (Chrome, Edge, Firefox and Safari on a computer).
 *   It draws every PDF exactly as Acrobat would and brings its own zoom, search and page thumbnails.
 * - pdfjs: the portal's own pages, drawn with pdf.js, where a browser cannot show a PDF inside a page: every
 *   phone and tablet (Android Chrome has no inline viewer; Safari on iPhone and iPad shows only the first page
 *   as a still image), and any browser whose PDF viewer is turned off.
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
  if (isPhoneOrTablet(nav)) return 'pdfjs';
  return nav.pdfViewerEnabled === true ? 'native' : 'pdfjs';
}
