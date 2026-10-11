/**
 * Page-preserving chunking, a direct port of ingest/chunk.py so chunks from the Worker and from
 * the GitHub job look the same. Chunks never cross a page boundary.
 */
import type { Page } from './extract';

const TARGET = 1800;
const HARD_MAX = 3500;
const MIN_TAIL = 300;
const HEADING = /^(?:(?:[IVXLC]+|\d{1,2}(?:\.\d{1,2})*|[A-Z])[.)]\s+.{3,120}|[A-Z][A-Z0-9 ,.&/'()-]{6,100})$/;

export interface Chunk {
  index: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionTitle: string | null;
  text: string;
}

function sentences(p: string): string[] {
  return p.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => s.trim());
}

function pieces(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\n\s*\n|\n(?=[A-Z0-9][^\n]{0,80}\n)/)) {
    const para = raw.trim();
    if (!para) continue;
    if (para.length <= HARD_MAX) {
      out.push(para);
      continue;
    }
    let buf = '';
    for (let s of sentences(para)) {
      while (s.length > HARD_MAX) {
        out.push(s.slice(0, HARD_MAX));
        s = s.slice(HARD_MAX);
      }
      if (buf.length + s.length + 1 > TARGET && buf) {
        out.push(buf);
        buf = s;
      } else buf = `${buf} ${s}`.trim();
    }
    if (buf) out.push(buf);
  }
  return out;
}

export function detectHeading(line: string): string | null {
  const l = line.trim();
  return l.length >= 6 && l.length <= 120 && HEADING.test(l) && !l.endsWith(',') ? l : null;
}

export function chunkPages(pages: Page[]): Chunk[] {
  const chunks: Chunk[] = [];
  let section: string | null = null;
  for (const page of pages) {
    if (page.section) section = page.section;
    let buf = '';
    let bufSection = section;
    for (const piece of pieces(page.text)) {
      const h = detectHeading(piece.split('\n', 1)[0]);
      if (buf.length + piece.length + 2 > TARGET && buf.length >= MIN_TAIL) {
        chunks.push({ index: chunks.length, pageStart: page.number, pageEnd: page.number, sectionTitle: bufSection, text: buf.trim() });
        buf = '';
      }
      if (h) section = h.slice(0, 200);
      if (!buf) bufSection = section;
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
    if (buf.trim()) chunks.push({ index: chunks.length, pageStart: page.number, pageEnd: page.number, sectionTitle: bufSection, text: buf.trim() });
  }
  return chunks;
}
