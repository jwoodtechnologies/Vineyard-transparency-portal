/**
 * Dependency-free, tolerant HTML link extraction.
 *
 * Government CMS pages are frequently malformed, so this does not rely on a single CSS selector or
 * on well-formed markup. It scans tags with a small state machine (quote-aware attribute parsing),
 * ignores <script>/<style>/<template> content and comments, honours <base href>, and collects URLs
 * from every place a public record link commonly appears:
 *
 *   a[href], area[href], iframe[src], frame[src], embed[src], object[data], source[src],
 *   video[src], audio[src], link[href] (alternate/canonical only), meta refresh,
 *   data-href / data-url / data-file / data-download / data-src attributes,
 *   and quoted URLs inside onclick="window.open('...')" handlers.
 *
 * Nothing here executes page content. Output text is plain (entities decoded, tags stripped).
 */
import { hrefScheme, resolveUrl } from './url';

export type LinkOrigin =
  | 'a'
  | 'area'
  | 'iframe'
  | 'frame'
  | 'embed'
  | 'object'
  | 'source'
  | 'video'
  | 'audio'
  | 'link'
  | 'meta_refresh'
  | 'data_attribute'
  | 'onclick';

export interface ExtractedLink {
  /** Raw attribute value (entities decoded). */
  href: string;
  /** Absolute http(s) URL, or null (mailto:, javascript:, unparseable...). */
  url: string | null;
  /** Scheme when the href is not http(s) (e.g. "mailto"). */
  scheme: string | null;
  /** Visible text (or title / aria-label / img alt fallback), whitespace-collapsed. */
  text: string;
  origin: LinkOrigin;
  rel: string | null;
  /** Value of the download attribute, when present (may suggest a filename). */
  download: string | null;
}

export interface ExtractedPage {
  title: string | null;
  baseUrl: string;
  links: ExtractedLink[];
  /** Text of h1–h3 headings, in document order. */
  headings: string[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©',
  reg: '®', trade: '™', sect: '§', para: '¶', middot: '·', bull: '•',
  laquo: '«', raquo: '»', deg: '°', frac12: '½', times: '×', shy: '',
  eacute: 'é', ntilde: 'ñ', rarr: '→', larr: '←',
};

/** Decode HTML character references (named subset + all numeric). Unknown entities are kept. */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

export function collapseWhitespace(input: string): string {
  return input.replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Strip tags from an HTML fragment and decode entities (plain-text view). */
export function htmlToText(fragment: string): string {
  return collapseWhitespace(decodeEntities(fragment.replace(/<[^>]*>/g, ' ')));
}

interface Tag {
  name: string;
  closing: boolean;
  attrs: Map<string, string>;
  start: number;
  end: number;
}

/** Remove comments and the bodies of non-content elements, preserving string length is not needed. */
function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|template|noembed)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ');
}

/** Parse one tag starting at `start` (which points at "<"). Returns null if not a tag. */
function parseTag(html: string, start: number): Tag | null {
  let i = start + 1;
  let closing = false;
  if (html[i] === '/') {
    closing = true;
    i += 1;
  }
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(i, i + 64));
  if (!nameMatch) return null;
  const name = nameMatch[0].toLowerCase();
  i += nameMatch[0].length;
  const attrs = new Map<string, string>();
  const n = html.length;
  while (i < n) {
    while (i < n && /[\s/]/.test(html[i])) i += 1;
    if (i >= n) break;
    if (html[i] === '>') return { name, closing, attrs, start, end: i + 1 };
    let attrName = '';
    while (i < n && !/[\s=>/]/.test(html[i])) {
      attrName += html[i];
      i += 1;
    }
    while (i < n && /\s/.test(html[i])) i += 1;
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < n && /\s/.test(html[i])) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        const stop = close === -1 ? n : close;
        value = html.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const m = /^[^\s>]*/.exec(html.slice(i));
        value = m ? m[0] : '';
        i += value.length;
      }
    }
    if (attrName) {
      const key = attrName.toLowerCase();
      if (!attrs.has(key)) attrs.set(key, decodeEntities(value));
    } else {
      i += 1; // defensive: skip a stray character
    }
  }
  return { name, closing, attrs, start, end: n };
}

const SRC_ELEMENTS: Record<string, { attr: string; origin: LinkOrigin }> = {
  iframe: { attr: 'src', origin: 'iframe' },
  frame: { attr: 'src', origin: 'frame' },
  embed: { attr: 'src', origin: 'embed' },
  object: { attr: 'data', origin: 'object' },
  source: { attr: 'src', origin: 'source' },
  video: { attr: 'src', origin: 'video' },
  audio: { attr: 'src', origin: 'audio' },
};
const DATA_URL_ATTRS = ['data-href', 'data-url', 'data-file', 'data-download', 'data-src', 'data-document'];
const LINK_RELS = new Set(['alternate', 'canonical']);

function onclickUrls(value: string): string[] {
  const out: string[] = [];
  const re = /(['"])((?:https?:\/\/|\/)[^'"\s]+?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) out.push(m[2]);
  return out;
}

/**
 * Extract links from an HTML document. `pageUrl` is the URL the HTML was served from (after
 * redirects); a <base href> overrides it for resolution.
 */
export function extractLinks(html: string, pageUrl: string): ExtractedPage {
  const source = stripNonContent(html);
  const links: ExtractedLink[] = [];
  const headings: string[] = [];
  let baseUrl = pageUrl;
  let baseSeen = false;
  let title: string | null = null;

  const pending: Array<Omit<ExtractedLink, 'url' | 'scheme'>> = [];
  let openAnchor: { index: number; textStart: number; fallback: string; imgAlt: string[] } | null = null;
  let openHeading: { name: string; textStart: number } | null = null;

  const push = (href: string, origin: LinkOrigin, text: string, rel: string | null = null, download: string | null = null) => {
    pending.push({ href, text, origin, rel, download });
    return pending.length - 1;
  };

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    const tag = parseTag(source, lt);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    i = tag.end;
    const { name, attrs } = tag;

    if (tag.closing) {
      if (name === 'a' && openAnchor) {
        const raw = htmlToText(source.slice(openAnchor.textStart, tag.start));
        const entry = pending[openAnchor.index];
        entry.text = raw || openAnchor.imgAlt.join(' ').trim() || openAnchor.fallback;
        openAnchor = null;
      } else if (openHeading && name === openHeading.name) {
        const text = htmlToText(source.slice(openHeading.textStart, tag.start));
        if (text) headings.push(text);
        openHeading = null;
      }
      continue;
    }

    switch (name) {
      case 'base': {
        const href = attrs.get('href');
        if (href && !baseSeen) {
          const resolved = resolveUrl(href, pageUrl);
          if (resolved) baseUrl = resolved;
          baseSeen = true;
        }
        break;
      }
      case 'title': {
        if (title === null) {
          const close = source.toLowerCase().indexOf('</title', tag.end);
          title = htmlToText(source.slice(tag.end, close === -1 ? undefined : close)) || null;
        }
        break;
      }
      case 'h1':
      case 'h2':
      case 'h3':
        openHeading = { name, textStart: tag.end };
        break;
      case 'a':
      case 'area': {
        if (openAnchor && name === 'a') {
          // Unclosed previous <a>: finalize it with the text seen so far.
          const entry = pending[openAnchor.index];
          entry.text = htmlToText(source.slice(openAnchor.textStart, tag.start)) || openAnchor.fallback;
          openAnchor = null;
        }
        const href = attrs.get('href');
        const fallback = collapseWhitespace(attrs.get('title') ?? attrs.get('aria-label') ?? attrs.get('alt') ?? '');
        if (href) {
          const idx = push(href, name, fallback, attrs.get('rel') ?? null, attrs.get('download') ?? null);
          if (name === 'a') openAnchor = { index: idx, textStart: tag.end, fallback, imgAlt: [] };
        }
        break;
      }
      case 'img': {
        const alt = attrs.get('alt');
        if (openAnchor && alt) openAnchor.imgAlt.push(collapseWhitespace(alt));
        break;
      }
      case 'link': {
        const rel = (attrs.get('rel') ?? '').toLowerCase();
        const href = attrs.get('href');
        if (href && rel.split(/\s+/).some((r) => LINK_RELS.has(r))) {
          push(href, 'link', collapseWhitespace(attrs.get('title') ?? ''), rel);
        }
        break;
      }
      case 'meta': {
        if ((attrs.get('http-equiv') ?? '').toLowerCase() === 'refresh') {
          const m = /url\s*=\s*['"]?([^'";]+)/i.exec(attrs.get('content') ?? '');
          if (m) push(m[1].trim(), 'meta_refresh', '');
        }
        break;
      }
      default: {
        const spec = SRC_ELEMENTS[name];
        if (spec) {
          const value = attrs.get(spec.attr);
          if (value) push(value, spec.origin, collapseWhitespace(attrs.get('title') ?? ''));
        }
      }
    }

    for (const attr of DATA_URL_ATTRS) {
      const value = attrs.get(attr);
      if (value && /^(https?:\/\/|\/|\.\.?\/)|\.[a-z0-9]{2,5}(\?|$)/i.test(value)) {
        push(value, 'data_attribute', collapseWhitespace(attrs.get('title') ?? attrs.get('aria-label') ?? ''));
      }
    }
    const onclick = attrs.get('onclick');
    if (onclick) {
      for (const u of onclickUrls(onclick)) push(u, 'onclick', collapseWhitespace(attrs.get('title') ?? ''));
    }
  }

  if (openAnchor) {
    const entry = pending[openAnchor.index];
    entry.text = htmlToText(source.slice(openAnchor.textStart, openAnchor.textStart + 500)) || openAnchor.fallback;
  }

  for (const link of pending) {
    const scheme = hrefScheme(link.href);
    const isHttp = scheme === null || scheme === 'http' || scheme === 'https';
    const url = isHttp ? resolveUrl(link.href, baseUrl) : null;
    links.push({ ...link, text: link.text.slice(0, 300), url, scheme: isHttp ? null : scheme });
  }
  return { title, baseUrl, links, headings };
}

/**
 * Plain-text body of an archived HTML record (e.g. a public-notice page): drops scripts, styles,
 * comments, navigation/header/footer chrome and forms, keeps block structure as line breaks.
 * The output is plain text only; archived HTML is never re-served as HTML.
 */
export function htmlDocumentText(html: string): { title: string | null; text: string } {
  const title = extractLinks(html, 'https://invalid.example/').title;
  let body = stripNonContent(html);
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(body);
  if (bodyMatch) body = bodyMatch[1];
  body = body.replace(/<(nav|header|footer|form|aside|noscript|svg|button|select)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ');
  body = body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(p|div|section|article|li|ul|ol|tr|table|h[1-6]|blockquote|pre|dd|dt)\b[^>]*>/gi, '\n\n');
  const text = decodeEntities(body.replace(/<[^>]*>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}
