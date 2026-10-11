/**
 * pdf.js data files, copied from pdfjs-dist by the vtp-pdfjs-assets plugin in vite.config.ts under
 * /assets/pdfjs-<version>/. Without them pdf.js cannot draw scanned pages (JBIG2 and JPEG 2000 decoders are
 * WebAssembly), PDFs that name a standard font without embedding it, or Asian text.
 */
export function pdfAssetBase(version: string): string {
  return `/assets/pdfjs-${version}/`;
}

/** The document options every pdf.js load in the portal uses. The PDF is untrusted: nothing in it runs. */
export function pdfDocumentOptions(version: string) {
  const base = pdfAssetBase(version);
  return {
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    iccUrl: `${base}iccs/`,
    // The shipped fonts, not whatever the device has installed, so a page looks the same on every screen.
    useSystemFonts: false,
    isEvalSupported: false,
    enableXfa: false,
    withCredentials: false,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 262144,
  } as const;
}

/** iPhone and iPad Safari refuse a canvas over about 16.7 million pixels (it draws blank). */
const MAX_CANVAS_PIXELS = 16_000_000;

/** Canvas pixels per CSS pixel: the screen's density (at most 3), lowered only to stay under the canvas limit. */
export function outputScale(cssWidth: number, cssHeight: number, dpr: number): number {
  const want = Math.min(Math.max(dpr || 1, 1), 3);
  const fit = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssWidth * cssHeight));
  return Math.max(0.5, Math.min(want, fit));
}
