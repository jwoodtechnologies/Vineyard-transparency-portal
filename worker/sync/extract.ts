/**
 * Text extraction inside the Worker: city web pages (readable content, links, tables) and PDFs.
 * Mirrors ingest/extract.py (content root, dropped chrome) so both pipelines index pages alike.
 */
import { parse, type HTMLElement } from 'node-html-parser';

export interface Page {
  number: number | null;
  text: string;
  section?: string | null;
}

export interface LinkInfo {
  url: string;
  text: string;
}

export interface HtmlExtraction {
  heading: string | null;
  text: string;
  links: LinkInfo[];
  tables: Array<{ caption: string | null; heading: string | null; headers: string[]; rows: string[][] }>;
}

const CONTENT_SELECTORS = ['#entry', '#freeform-main', '#post', 'main#main', 'main', '#content'];
const DROP = 'script, style, noscript, nav, header, footer, form, iframe, svg, .sidebar, .sidebar-widgets-wrap, #sidebar, .breadcrumb, .breadcrumbs, .social, .share, #google_translate_element';

export function clean(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function textOf(el: HTMLElement): string {
  return clean(el.textContent ?? '').replace(/\s+/g, ' ');
}

function resolve(href: string, base: string): string | null {
  const raw = href.trim();
  if (!raw || /^(javascript:|mailto:|tel:|#)/i.test(raw)) return null;
  try {
    const u = new URL(raw, base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/** Nearest heading before an element (for naming a table such as "AT A GLANCE"). */
function headingBefore(el: HTMLElement): string | null {
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 6; depth++) {
    let prev = node.previousElementSibling as HTMLElement | null;
    for (let i = 0; prev && i < 8; i++) {
      if (/^h[1-6]$/i.test(prev.tagName)) return textOf(prev);
      const inner = prev.querySelectorAll('h1,h2,h3,h4,h5,h6');
      if (inner.length) return textOf(inner[inner.length - 1]);
      const t = textOf(prev);
      if (t && t.length <= 60 && /^[A-Z0-9 &:/-]+$/.test(t)) return t;
      prev = prev.previousElementSibling as HTMLElement | null;
    }
    node = node.parentNode as HTMLElement | null;
  }
  return null;
}

export function extractHtml(html: string, pageUrl: string): HtmlExtraction {
  const doc = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const baseHref = doc.querySelector('base')?.getAttribute('href');
  const base = (baseHref && resolve(baseHref, pageUrl)) || pageUrl;
  for (const el of doc.querySelectorAll(DROP)) el.remove();
  let root: HTMLElement | null = null;
  for (const sel of CONTENT_SELECTORS) {
    root = doc.querySelector(sel);
    if (root) break;
  }
  root = root ?? doc.querySelector('body') ?? doc;

  const headingEl = root.querySelector('h1, h2') ?? doc.querySelector('h1');
  const heading = headingEl ? textOf(headingEl) || null : null;

  const tables: HtmlExtraction['tables'] = [];
  for (const table of root.querySelectorAll('table')) {
    const rows: string[][] = [];
    let headers: string[] = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('th, td').map((c) => textOf(c));
      if (!cells.some(Boolean)) continue;
      if (!headers.length && (tr.querySelectorAll('th').length === cells.length || tr.parentNode?.tagName === 'THEAD')) headers = cells;
      else rows.push(cells);
    }
    if (!headers.length && rows.length > 1) headers = rows.shift() ?? [];
    const caption = table.querySelector('caption');
    tables.push({ caption: caption ? textOf(caption) : null, heading: headingBefore(table), headers, rows });
  }

  const blocks: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, p, li, tr, div')) {
    if (el.tagName === 'DIV' && el.querySelector('p, div, li, table, h1, h2, h3, h4')) continue;
    const t = el.tagName === 'TR' ? el.querySelectorAll('th, td').map((c) => textOf(c)).filter(Boolean).join(' | ') : textOf(el);
    if (t && blocks[blocks.length - 1] !== t) blocks.push(t);
  }

  const links: LinkInfo[] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll('a')) {
    const url = resolve(a.getAttribute('href') ?? '', base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: textOf(a).slice(0, 300) });
  }
  return { heading, text: clean(blocks.join('\n')), links, tables };
}

/** Per-page text of a PDF. Returns null when the PDF cannot be read. */
export async function extractPdf(bytes: Uint8Array, maxPages = 400): Promise<{ pages: Page[]; pageCount: number } | null> {
  try {
    const { getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const count = pdf.numPages;
    const pages: Page[] = [];
    for (let n = 1; n <= Math.min(count, maxPages); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
        if (typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push({ number: n, text: clean(text) });
      page.cleanup();
    }
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
    return { pages, pageCount: count };
  } catch {
    return null;
  }
}

/** True when a PDF's text layer is too thin to be anything but a scan (needs OCR). */
export function looksScanned(pages: Page[]): boolean {
  if (!pages.length) return true;
  const chars = pages.reduce((n, p) => n + p.text.replace(/\s+/g, '').length, 0);
  return chars / pages.length < 40;
}
