/**
 * PDF text extraction with pdfjs-dist (legacy build, the one intended for Node).
 *
 * Safety: pdfjs-dist v6 contains no eval()/new Function() font path (the old `isEvalSupported`
 * option — the CVE-2024-4367 mitigation for older versions — no longer exists; if you ever pin
 * pdfjs-dist < 4.2.67, set isEvalSupported:false). XFA is disabled, no font-face injection, no
 * network access (bytes are passed in; standard fonts load from node_modules), and a page cap.
 * PDF content is treated as untrusted data.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DocumentPageText } from '../../src/types/models';

export interface PdfExtraction {
  pageCount: number;
  pages: DocumentPageText[];
  info: { title: string | null; author: string | null; creationDate: string | null };
  extractor: string;
}

interface TextItemLike {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
  height?: number;
}

const require = createRequire(import.meta.url);

function pdfjsRoot(): string {
  return path.dirname(require.resolve('pdfjs-dist/package.json'));
}

function pdfjsVersion(): string {
  try {
    return (require('pdfjs-dist/package.json') as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

/** Join pdf.js text items into lines/paragraphs using EOL flags and vertical gaps. */
export function itemsToText(items: TextItemLike[]): string {
  let out = '';
  let lastY: number | null = null;
  let lastHeight = 10;
  for (const item of items) {
    const y = item.transform?.[5] ?? null;
    const height = item.height && item.height > 0 ? item.height : lastHeight;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 0.5 && !out.endsWith('\n')) {
      out += Math.abs(y - lastY) > height * 1.8 ? '\n\n' : '\n';
    } else if (lastY !== null && y !== null && Math.abs(y - lastY) > height * 1.8 && out.endsWith('\n') && !out.endsWith('\n\n')) {
      out += '\n';
    }
    out += item.str;
    if (item.hasEOL) out += '\n';
    else if (item.str && !/\s$/.test(item.str)) out += ' ';
    if (y !== null) lastY = y;
    lastHeight = height;
  }
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(bytes: Uint8Array, options: { maxPages?: number } = {}): Promise<PdfExtraction> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = path.join(pdfjsRoot(), 'standard_fonts') + path.sep;
  const task = pdfjs.getDocument({
    // pdf.js may transfer/detach the buffer; give it a copy.
    data: new Uint8Array(bytes),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const doc = await task.promise;
  try {
    const pageCount = doc.numPages;
    const limit = Math.min(pageCount, options.maxPages ?? 5000);
    const pages: DocumentPageText[] = [];
    for (let n = 1; n <= limit; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push({ page: n, text: itemsToText(content.items as TextItemLike[]), ocr: false });
      page.cleanup();
    }
    let info: PdfExtraction['info'] = { title: null, author: null, creationDate: null };
    try {
      const meta = await doc.getMetadata();
      const raw = (meta.info ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      info = { title: str(raw.Title), author: str(raw.Author), creationDate: str(raw.CreationDate) };
    } catch {
      /* metadata is optional */
    }
    return { pageCount, pages, info, extractor: `pdfjs-dist@${pdfjsVersion()}` };
  } finally {
    await task.destroy();
  }
}

/** True when the bytes start with the PDF magic number. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}
