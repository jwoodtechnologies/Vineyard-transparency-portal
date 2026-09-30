/**
 * Page-aware chunking for retrieval.
 *
 *  - Chunks target ~650 tokens (hard max 800) with ~80 tokens of overlap, so a citation always
 *    points at a passage small enough to verify.
 *  - Text is split at paragraph, then sentence, then word boundaries — never mid-word.
 *  - Every chunk records the page range it spans; section titles come from detected headings.
 *  - Token counts are estimates (≈ 4 characters per token for English prose). Swap in a real
 *    tokenizer here if an embedding model with a strict context limit is introduced.
 */
import type { DocumentChunk, DocumentPageText } from '../../src/types/models';

export interface ChunkOptions {
  targetTokens?: number;
  maxTokens?: number;
  overlapTokens?: number;
  /** Chunks shorter than this are merged into the previous chunk when possible. */
  minTokens?: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

/** Heuristic heading detection for government documents. */
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 100) return false;
  if (/[.,;]$/.test(t) && !/^(section|article|chapter|title|part)\b/i.test(t)) return false;
  if (/^(section|article|chapter|title|part)\s+[\dIVXLC]+[\d.\-A-Z]*\b/i.test(t)) return true;
  if (/^§\s*[\d.-]+/.test(t)) return true;
  if (/^(\d+(\.\d+)*\.?|[A-Z]\.|[IVX]+\.)\s+[A-Z][A-Za-z0-9 ,&'()/-]{2,80}$/.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && letters === letters.toUpperCase() && /[A-Z]/.test(letters) && t.split(/\s+/).length <= 12;
}

interface Unit {
  text: string;
  page: number;
  heading: string | null;
  tokens: number;
  isHeading: boolean;
  /** True when this unit starts a new paragraph (joined with a blank line). */
  paragraphStart: boolean;
}

function splitSentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter((s) => s.trim());
}

function splitWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current: string[] = [];
  for (const w of words) {
    current.push(w);
    if (estimateTokens(current.join(' ')) >= maxTokens) {
      out.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) out.push(current.join(' '));
  return out;
}

function toUnits(pages: DocumentPageText[], maxTokens: number): Unit[] {
  const units: Unit[] = [];
  let heading: string | null = null;
  for (const page of pages) {
    const paragraphs = page.text
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const paragraph of paragraphs) {
      // Headings may appear on any line of a paragraph (PDF text often has no blank line before
      // "SECTION 2. ..."); each heading line closes the body text before it.
      let body: string[] = [];
      let first = true;
      const flushBody = () => {
        const text = body.join(' ').replace(/\s+/g, ' ').trim();
        body = [];
        if (!text) return;
        const pieces = estimateTokens(text) <= maxTokens ? [text] : splitSentences(text).flatMap((s) => (estimateTokens(s) <= maxTokens ? [s] : splitWords(s, maxTokens)));
        pieces.forEach((piece, i) => units.push({ text: piece, page: page.page, heading, tokens: estimateTokens(piece), isHeading: false, paragraphStart: i === 0 && first }));
        first = false;
      };
      for (const line of paragraph.split('\n')) {
        if (isHeading(line)) {
          flushBody();
          heading = line.trim().replace(/\s+/g, ' ');
          units.push({ text: heading, page: page.page, heading, tokens: estimateTokens(heading), isHeading: true, paragraphStart: true });
          first = true;
        } else {
          body.push(line);
        }
      }
      flushBody();
    }
  }
  return units;
}

function joinUnits(units: Unit[]): string {
  return units.reduce((acc, u, i) => (i === 0 ? u.text : `${acc}${u.paragraphStart ? '\n\n' : ' '}${u.text}`), '');
}

export function chunkPages(documentId: string, pages: DocumentPageText[], options: ChunkOptions = {}): DocumentChunk[] {
  const target = options.targetTokens ?? 650;
  const max = options.maxTokens ?? 800;
  const overlap = options.overlapTokens ?? 80;
  const min = options.minTokens ?? 120;
  const units = toUnits(pages, Math.min(max, target));
  const groups: Array<{ units: Unit[]; overlapCount: number }> = [];

  let current: Unit[] = [];
  let currentTokens = 0;
  let overlapCount = 0;
  const flush = () => {
    if (current.length > overlapCount) groups.push({ units: current, overlapCount });
    // Carry trailing non-heading units (≤ overlap tokens) into the next chunk.
    const carry: Unit[] = [];
    let carryTokens = 0;
    for (let i = current.length - 1; i >= overlapCount && overlap > 0; i -= 1) {
      const u = current[i];
      if (u.isHeading || carryTokens + u.tokens > overlap) break;
      carry.unshift(u);
      carryTokens += u.tokens;
    }
    current = carry;
    currentTokens = carryTokens;
    overlapCount = carry.length;
  };

  for (const unit of units) {
    const wouldExceed = currentTokens + unit.tokens > max;
    const headingBreak = unit.isHeading && currentTokens >= target * 0.6;
    if ((wouldExceed || headingBreak) && current.length > overlapCount) flush();
    current.push(unit);
    currentTokens += unit.tokens;
    if (currentTokens >= target) flush();
  }
  if (current.length > overlapCount) groups.push({ units: current, overlapCount });

  // Merge a tiny trailing chunk into its predecessor when that stays under the hard max.
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    const fresh = last.units.slice(last.overlapCount);
    const freshTokens = fresh.reduce((n, u) => n + u.tokens, 0);
    const prev = groups[groups.length - 2];
    const prevTokens = prev.units.reduce((n, u) => n + u.tokens, 0);
    if (freshTokens < min && prevTokens + freshTokens <= max) {
      prev.units.push(...fresh);
      groups.pop();
    }
  }

  return groups.map((g, index) => {
    const text = joinUnits(g.units);
    const firstNew = g.units[g.overlapCount] ?? g.units[0];
    const pagesInChunk = g.units.map((u) => u.page);
    return {
      id: `${documentId}:c${index.toString().padStart(4, '0')}`,
      documentId,
      pageStart: Math.min(...pagesInChunk),
      pageEnd: Math.max(...pagesInChunk),
      sectionTitle: firstNew.isHeading ? firstNew.text : firstNew.heading,
      text,
      tokenEstimate: estimateTokens(text),
      embeddingReference: null,
      metadata: {
        chunkIndex: index,
        overlapUnits: g.overlapCount,
        charCount: text.length,
      },
    };
  });
}
