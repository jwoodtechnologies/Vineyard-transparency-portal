/**
 * Utah County Sheriff's Office press releases (sheriff.utahcounty.gov). The office publishes its
 * archive as public JSON at /api/news/archive; each release has a public page at
 * /media/sheriffNewsDetails?ID=n. Pure helpers, unit-testable.
 */
export const UCSO_SOURCE = 'ucso-press-releases';
export const UCSO_ARCHIVE = 'https://sheriff.utahcounty.gov/api/news/archive';
export const ucsoPage = (id: number) => `https://sheriff.utahcounty.gov/media/sheriffNewsDetails?ID=${Math.trunc(id)}`;

export interface UcsoItem {
  id: number;
  headline?: string | null;
  body_short?: string | null;
  entered_date?: string | null;
}

export function cleanText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export const mentionsVineyard = (text: string) => /\bvineyard\b/i.test(text);

/** The release body from its public page: the "entry" block after the title. */
export function releaseBody(html: string): string {
  const start = html.search(/<div[^>]+class="[^"]*\bentry\b[^"]*"/i);
  if (start < 0) return '';
  const rest = html.slice(start);
  const end = rest.search(/<div[^>]+class="[^"]*sidebar/i);
  return cleanText(end > 0 ? rest.slice(0, end) : rest.slice(0, 60000)).slice(0, 20000);
}

export function recent(items: UcsoItem[], since: Date): UcsoItem[] {
  return items.filter((i) => Number.isFinite(i.id) && i.entered_date && new Date(i.entered_date) >= since);
}
