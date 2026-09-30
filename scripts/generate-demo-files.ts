/**
 * Generates the DEMO archive files served in mock mode (public/demo-files/*) from the demo
 * dataset, plus a manifest with real SHA-256 checksums, sizes, and page counts
 * (src/data/mock/demo-files-manifest.json).
 *
 * Every page is stamped "DEMO DOCUMENT — NOT A GOVERNMENT RECORD".
 *
 *   npm run generate-demo-files
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { buildRawDocuments } from '../src/data/mock/db.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'demo-files');
const MANIFEST = path.join(ROOT, 'src', 'data', 'mock', 'demo-files-manifest.json');

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 64;
const BLUE = rgb(0.12, 0.25, 0.62);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.43, 0.5);
const RED = rgb(0.7, 0.13, 0.13);

function safe(text: string, font: PDFFont): string {
  // Replace characters the standard (WinAnsi) font cannot encode.
  return [...text]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return '?';
      }
    })
    .join('');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function stamp(page: PDFPage, bold: PDFFont, regular: PDFFont, pageNo: number, total: number, docId: string) {
  page.drawRectangle({ x: 0, y: PAGE_H - 34, width: PAGE_W, height: 34, color: rgb(0.99, 0.95, 0.95) });
  page.drawText('DEMO DOCUMENT - NOT A GOVERNMENT RECORD', { x: MARGIN, y: PAGE_H - 22, size: 9.5, font: bold, color: RED });
  page.drawText('Sample data for the Vineyard Transparency Portal interface', {
    x: PAGE_W - MARGIN - regular.widthOfTextAtSize('Sample data for the Vineyard Transparency Portal interface', 8),
    y: PAGE_H - 22,
    size: 8,
    font: regular,
    color: MUTED,
  });
  page.drawText('DEMO', { x: 150, y: 260, size: 150, font: bold, color: rgb(0.93, 0.94, 0.97), rotate: degrees(35), opacity: 0.6 });
  const footer = `${docId}  |  Page ${pageNo} of ${total}`;
  page.drawText(footer, { x: MARGIN, y: 32, size: 8, font: regular, color: MUTED });
}

async function main() {
  const { docs } = buildRawDocuments();
  await mkdir(OUT_DIR, { recursive: true });
  for (const f of await readdir(OUT_DIR)) await rm(path.join(OUT_DIR, f));

  const manifest: Record<string, { fileName: string; sha256: string; size: number; pageCount: number; mimeType: string }> = {};

  for (const doc of docs) {
    if (doc.noArchivedCopy) continue;
    let bytes: Uint8Array;
    let fileName: string;
    let mimeType: string;

    if (doc.mimeType === 'text/plain') {
      fileName = `${doc.id}.txt`;
      mimeType = 'text/plain';
      const body = [
        'DEMO DOCUMENT - NOT A GOVERNMENT RECORD',
        doc.title,
        '',
        ...doc.pages.map((p) => `${p.section ? `[${p.section}]\n` : ''}${p.text}`),
        '',
      ].join('\n');
      bytes = new TextEncoder().encode(body);
    } else {
      fileName = `${doc.id}.pdf`;
      mimeType = 'application/pdf';
      const pdf = await PDFDocument.create();
      pdf.setTitle(`${doc.title} (DEMO)`);
      pdf.setSubject('Demo document - not a government record');
      pdf.setProducer('Vineyard Transparency Portal demo generator');
      pdf.setCreator('scripts/generate-demo-files.ts');
      // Fixed dates keep checksums reproducible between runs.
      pdf.setCreationDate(new Date(`${doc.date}T12:00:00Z`));
      pdf.setModificationDate(new Date(`${doc.date}T12:00:00Z`));
      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const serif = await pdf.embedFont(StandardFonts.TimesRoman);
      const total = doc.pages.length;
      const width = PAGE_W - MARGIN * 2;

      doc.pages.forEach((p, i) => {
        const page = pdf.addPage([PAGE_W, PAGE_H]);
        stamp(page, bold, regular, i + 1, total, doc.id);
        let y = PAGE_H - 80;
        if (i === 0) {
          for (const line of wrap(safe(doc.title, bold), bold, 15, width)) {
            page.drawText(line, { x: MARGIN, y, size: 15, font: bold, color: BLUE });
            y -= 20;
          }
          page.drawText(safe(`Date: ${doc.date}${doc.documentNumber ? `   Number: ${doc.documentNumber}` : ''}`, regular), {
            x: MARGIN,
            y: y - 4,
            size: 9.5,
            font: regular,
            color: MUTED,
          });
          y -= 30;
          page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: PAGE_W - MARGIN, y: y + 8 }, thickness: 0.6, color: rgb(0.8, 0.83, 0.9) });
          y -= 12;
        }
        if (p.section) {
          page.drawText(safe(p.section, bold), { x: MARGIN, y, size: 11.5, font: bold, color: INK });
          y -= 22;
        }
        for (const line of wrap(safe(p.text, serif), serif, 12, width)) {
          if (y < 60) break;
          page.drawText(line, { x: MARGIN, y, size: 12, font: serif, color: INK, lineHeight: 17 });
          y -= 17;
        }
      });
      bytes = await pdf.save({ useObjectStreams: true });
    }

    await writeFile(path.join(OUT_DIR, fileName), bytes);
    manifest[doc.id] = {
      fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      pageCount: doc.pages.length,
      mimeType,
    };
  }

  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const totalBytes = Object.values(manifest).reduce((n, m) => n + m.size, 0);
  console.log(`Generated ${Object.keys(manifest).length} demo files (${(totalBytes / 1024).toFixed(0)} KB) in public/demo-files/.`);
  console.log(`Manifest written to ${path.relative(ROOT, MANIFEST)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
