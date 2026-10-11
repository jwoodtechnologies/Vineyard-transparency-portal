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

