/**
 * OCR is a documented FUTURE step. Scanned PDFs are detected (low text density) and flagged
 * ocrRequired=true / ocrStatus="pending"; nothing is OCR'd yet.
 *
 * To add OCR, implement OcrProvider, e.g.:
 *   - Tesseract (self-hosted, free): render pages with pdf.js + @napi-rs/canvas (optional dep of
 *     pdfjs-dist) or `pdftoppm`, then run `tesseract page.png - --psm 1 tsv` and average word
 *     confidences; or the tesseract.js WASM build.
 *   - OCRmyPDF (Tesseract wrapper) to produce a text-layer PDF, then re-run extractPdfText().
 * OCR output must set DocumentPageText.ocr=true and Document.ocrConfidence (0–1) so the UI can warn
 * that text may contain recognition errors.
 */
import type { DocumentPageText } from '../../src/types/models';

export interface OcrPageResult {
  page: number;
  text: string;
  /** Mean confidence 0–1. */
  confidence: number;
}

export interface OcrProvider {
  readonly id: string;
  recognize(fileBytes: Uint8Array, pageNumbers: number[]): Promise<OcrPageResult[]>;
}

export class NoopOcrProvider implements OcrProvider {
  readonly id = 'none';
  async recognize(): Promise<OcrPageResult[]> {
    return [];
  }
}

export interface OcrAssessment {
  ocrRequired: boolean;
  lowTextPages: number[];
  averageCharsPerPage: number;
}

/** A page with fewer than `minChars` non-whitespace characters is considered image-only. */
export function assessOcrNeed(pages: DocumentPageText[], minChars = 40): OcrAssessment {
  if (!pages.length) return { ocrRequired: false, lowTextPages: [], averageCharsPerPage: 0 };
  const counts = pages.map((p) => p.text.replace(/\s+/g, '').length);
  const lowTextPages = pages.filter((_, i) => counts[i] < minChars).map((p) => p.page);
  const average = counts.reduce((a, b) => a + b, 0) / pages.length;
  const ocrRequired = lowTextPages.length / pages.length >= 0.3 || average < 100;
  return { ocrRequired, lowTextPages, averageCharsPerPage: Math.round(average) };
}
