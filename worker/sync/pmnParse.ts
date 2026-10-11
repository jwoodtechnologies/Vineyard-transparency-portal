/** Utah Public Notice Website search results parser (pure, unit-tested). */
import { parse } from 'node-html-parser';

export const PMN = 'https://www.utah.gov/pmn';

export interface PmnNotice {
  id: string;
  title: string;
  url: string;
  eventDate: string | null;
  eventTime: string | null;
  publicBody: string;
  entity: string;
  attachments: Array<{ url: string; name: string }>;
}

/** Parses the search results table (#browseResults-table). Pure, unit-tested. */
export function parsePmnResults(html: string): PmnNotice[] {
  const doc = parse(html);
  const out: PmnNotice[] = [];
  for (const tr of doc.querySelectorAll('#browseResults-table tbody tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 4) continue;
    const a = tds[0].querySelector('a');
    const href = a?.getAttribute('href') ?? '';
    const id = /notice\/(\d+)\.html/.exec(href)?.[1];
    if (!id) continue;
    const when = (tds[1].textContent ?? '').trim();
    const m = /(\d{4})\/(\d{2})\/(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i.exec(when);
    let time: string | null = null;
    if (m?.[4]) {
      let h = Number(m[4]) % 12;
      if (/pm/i.test(m[6])) h += 12;
      time = `${String(h).padStart(2, '0')}:${m[5]}`;
    }
    out.push({
      id,
      title: (a?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      url: new URL(href, `${PMN}/`).toString(),
      eventDate: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
      eventTime: time,
      publicBody: (tds[2].textContent ?? '').replace(/\s+/g, ' ').trim(),
      entity: (tds[3].textContent ?? '').replace(/\s+/g, ' ').trim(),
      attachments: (tds[4]?.querySelectorAll('a') ?? [])
        .map((x) => ({ url: new URL(x.getAttribute('href') ?? '', `${PMN}/`).toString(), name: (x.textContent ?? '').replace(/\s+/g, ' ').trim() }))
        .filter((x) => /\/pmn\/files\//.test(x.url)),
    });
  }
  return out;
}


/**
 * Bodies a notice title can name, as the agenda portal (CivicClerk) names them. The notice site files
 * some commissions' notices under another public body: ARCH Commission meetings are posted under
 * "City Council". The title names the body that meets.
 */
const TITLE_BODIES: Array<[RegExp, string]> = [
  [/\bARCH\b/, 'ARCH Commission'],
  [/\bactive transportation\b/i, 'Active Transportation Commission'],
  [/\bplanning commission\b/i, 'Planning Commission'],
  [/\bredevelopment agency\b|\bRDA\b/, 'Redevelopment Agency'],
  [/\bdevelopment review committee\b/i, 'Development Review Committee'],
  [/\btechnical advisory committee\b/i, 'Technical Advisory Committee'],
  [/\blibrary board\b/i, 'Vineyard Library Board'],
  [/\byouth council\b/i, 'Youth Council'],
  [/\bcommunities that care\b/i, 'Communities That Care Commission'],
  [/\bboard of appeals\b/i, 'Board of Appeals - Building Department'],
  [/\bvineyard cares\b/i, 'Vineyard Cares Coalition'],
  [/\bhearing officer\b|\badministrative law judge\b/i, 'Administrative Law Judge/Hearing Officer'],
];

/**
 * The public body a notice is for: the body its title names when that differs from the body it was
 * filed under ("ARCH Commission Meeting" filed under City Council is the ARCH Commission), else the
 * body it was filed under. A title that names its own filing body ("City Council and RDA Joint
 * Meeting" under City Council) keeps it.
 */
/**
 * What a meeting notice says about its meeting: a cancellation notice ("Planning Commission
 * Cancellation Notice 6.17.26 Meeting", notice 1089445) cancels it; any other notice confirms it
 * as held (day past) or scheduled.
 */
export function noticeStatus(title: string, eventDate: string, today: string): 'cancelled' | 'held' | 'scheduled' {
  if (/cancel/i.test(title)) return 'cancelled';
  return eventDate < today ? 'held' : 'scheduled';
}

export function noticeBody(publicBody: string, title: string): string {
  const filed = publicBody.trim();
  const t = title.replace(/\s+/g, ' ');
  if (filed && t.toLowerCase().includes(filed.toLowerCase())) return filed;
  const named = TITLE_BODIES.filter(([re]) => re.test(t)).map(([, name]) => name);
  if (named.length === 1 && named[0].toLowerCase() !== filed.toLowerCase()) return named[0];
  return filed;
}
