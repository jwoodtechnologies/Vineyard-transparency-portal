/** RSS 2.0 building blocks: escaping and one document builder (with the atom:link self reference). */

/** Characters XML 1.0 does not allow, even escaped. */
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 822 date for pubDate: a day alone (YYYY-MM-DD) is taken at noon UTC, so it stays on that day in Utah. */
export function rfc822(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toUTCString();
}

export interface RssItem {
  title: string;
  link: string;
  description?: string | null;
  date?: string | null;
  categories?: Array<string | null | undefined>;
  /** A stable id that is not the link (isPermaLink="false"); the link is used when absent. */
  guid?: string;
}

export interface RssChannel {
  title: string;
  link: string;
  selfUrl: string;
  description: string;
  items: RssItem[];
  /** Minutes a reader may cache the feed. */
  ttl?: number;
  lastBuildDate?: string;
}

export function rssDocument(c: RssChannel): string {
  const items = c.items.map((it) => {
    const pub = rfc822(it.date);
    const cats = (it.categories ?? []).filter((x): x is string => Boolean(x)).map((x) => `      <category>${escapeXml(x)}</category>`);
    return [
      '    <item>',
      `      <title>${escapeXml(it.title)}</title>`,
      `      <link>${escapeXml(it.link)}</link>`,
      `      <guid isPermaLink="${it.guid ? 'false' : 'true'}">${escapeXml(it.guid ?? it.link)}</guid>`,
      ...(it.description ? [`      <description>${escapeXml(it.description)}</description>`] : []),
      ...(pub ? [`      <pubDate>${pub}</pubDate>`] : []),
      ...cats,
      '    </item>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(c.title)}</title>`,
    `    <link>${escapeXml(c.link)}</link>`,
    `    <description>${escapeXml(c.description)}</description>`,
    '    <language>en-us</language>',
    `    <atom:link href="${escapeXml(c.selfUrl)}" rel="self" type="application/rss+xml"/>`,
    `    <lastBuildDate>${rfc822(c.lastBuildDate ?? new Date().toISOString())}</lastBuildDate>`,
    ...(c.ttl ? [`    <ttl>${c.ttl}</ttl>`] : []),
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
