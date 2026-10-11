import { describe, expect, it } from 'vitest';
import { canonicalUrl, categorize, urlKey } from '../worker/sync/urls';
import { chunkPages } from '../worker/sync/chunk';
import { extractHtml, looksScanned } from '../worker/sync/extract';
import { noticeBody, noticeStatus, parsePmnResults } from '../worker/sync/pmnParse';
import { findGlance, glanceText } from '../worker/lib/glance';
import { shouldArchive } from '../worker/lib/archivePolicy';
import { estimateNeurons } from '../worker/ai/meter';
import { calendarText } from '../worker/sync/calendarText';

describe('queue keys match the Python crawler (ingest/urls.py url_key)', () => {
  const cases: Array<[string, string, string]> = [
    ['https://www.vineyardutah.gov/Center Street and Holdaway Road 8.4 2026.pdf?t=12', 'https://vineyardutah.gov/Center%20Street%20and%20Holdaway%20Road%208.4%202026.pdf', '10b3cda34e706425ed616ea9f0b6ba3dae9aa37bcfecb30367bd8a3950f40917'],
    ['https://vineyardutah.gov/DocumentCenter/View/2375/Building-Portal-Account-Guide', 'https://vineyardutah.gov/DocumentCenter/View/2375/Building-Portal-Account-Guide', '3123c020da50ea31541198da314961dbb3ce872b9042649c957f67b546b037f3'],
    ['https://www.vineyardutah.gov/government/construction_projects.php', 'https://vineyardutah.gov/government/construction_projects.php', 'c26580d9224c8f03188abbc6ce1cef1ef253ab101bf8e0b46b99592b4f1f47bd'],
    ['https://www.utah.gov/pmn/sitemap/notice/1114505.html?b=2&a=1', 'https://utah.gov/pmn/sitemap/notice/1114505.html?a=1&b=2', '9b132c8ca01bea3e2bc5ff2f0da9c03e697f3d0522edacfe7d37b07e40a802c4'],
  ];
  for (const [url, canon, key] of cases) {
    it(url, async () => {
      expect(canonicalUrl(url)).toBe(canon);
      expect(await urlKey(url)).toBe(key);
    });
  }

  it('categorizes city links like ingest/sources.py', () => {
    expect(categorize('https://www.vineyardutah.gov/x/notice.pdf').category).toBe('document');
    expect(categorize('https://www.vineyardutah.gov/calendar.php').category).toBe('excluded');
    expect(categorize('https://www.vineyardutah.gov/government/streets.php')).toMatchObject({ category: 'city_page', crawlable: true });
    expect(categorize('https://www.facebook.com/VineyardCity').category).toBe('other');
  });
});

const CONSTRUCTION_HTML = `<html><head><base href="https://www.vineyardutah.gov/"></head><body>
<nav><a href="/menu.php">Menu</a></nav>
<div id="post">
  <h1>Construction Projects</h1>
  <h2>AT A GLANCE</h2>
  <table>
    <tr><th>Project</th><th>Type</th><th>Location</th><th>Work description</th><th>Status</th><th>Expected completion</th></tr>
    <tr><td>HAWK crossing</td><td>Pedestrian signal</td><td>Center Street and Holdaway Road</td><td>New crossing</td><td>Underway</td><td>Early November</td></tr>
    <tr><td>Traffic signal</td><td>Signal</td><td>400 North and Mill Road</td><td>New signal</td><td>Planned</td><td>TBD</td></tr>
  </table>
  <p>Questions go to Public Works.</p>
  <a href="Update%205.pdf">Update 5</a>
  <a href="government/streets.php">Streets</a>
</div></body></html>`;

describe('city page extraction', () => {
  const page = extractHtml(CONSTRUCTION_HTML, 'https://www.vineyardutah.gov/government/construction_projects.php');

  it('keeps the content, drops navigation, resolves links from <base>', () => {
    expect(page.heading).toBe('Construction Projects');
    expect(page.text).toContain('HAWK crossing');
    expect(page.text).not.toContain('Menu');
    expect(page.links.map((l) => l.url)).toContain('https://www.vineyardutah.gov/Update%205.pdf');
  });

  it('finds the AT A GLANCE table with the city columns', () => {
    const g = findGlance(page.tables)!;
    expect(g.heading).toBe('AT A GLANCE');
    expect(g.headers).toEqual(['Project', 'Type', 'Location', 'Work description', 'Status', 'Expected completion']);
    expect(g.rows[0]).toMatchObject({ Project: 'HAWK crossing', Status: 'Underway', 'Expected completion': 'Early November' });
  });

  it('answers construction questions from the table with the date it was read', () => {
    const text = glanceText(findGlance(page.tables), '2026-10-11T16:00:00Z', page.text);
    expect(text).toMatch(/^As of October 11, 2026, the city's Construction Projects page lists 2 projects:/);
    expect(text).toContain('HAWK crossing, Center Street and Holdaway Road (Pedestrian signal): status Underway, expected completion Early November.');
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('Utah Public Notice results', () => {
  const html = `<table id="browseResults-table"><tbody>
    <tr class="on"><td><a href="/pmn/sitemap/notice/1114505.html">Redevelopment Agency Board Meeting </a></td><td>2026/10/13 06:00 PM</td><td>Redevelopment Agency</td><td>Vineyard</td>
      <td><ul><li><a href="/pmn/files/1499769.pdf" target="blank">10.13.26 RDA Packet (1).pdf</a></li></ul></td></tr>
    <tr class="off"><td><a href="/pmn/sitemap/notice/1114999.html">Board Meeting</a></td><td>2026/10/14</td><td>Board</td><td>Vineyard Water District</td><td></td></tr>
  </tbody></table>`;
  it('parses notices, times and attachments', () => {
    const [a, b] = parsePmnResults(html);
    expect(a).toMatchObject({ id: '1114505', title: 'Redevelopment Agency Board Meeting', eventDate: '2026-10-13', eventTime: '18:00', publicBody: 'Redevelopment Agency', entity: 'Vineyard' });
    expect(a.url).toBe('https://www.utah.gov/pmn/sitemap/notice/1114505.html');
    expect(a.attachments).toEqual([{ url: 'https://www.utah.gov/pmn/files/1499769.pdf', name: '10.13.26 RDA Packet (1).pdf' }]);
    expect(b.entity).toBe('Vineyard Water District');
  });
});

describe('chunking and scans', () => {
  it('never crosses pages and keeps page numbers', () => {
    const chunks = chunkPages([
      { number: 1, text: 'A'.repeat(1000) + '\n\n' + 'B'.repeat(1000) },
      { number: 2, text: 'Short page two.' },
    ]);
    expect(chunks.map((c) => c.pageStart)).toEqual([1, 1, 2]);
  });
  it('flags image-only PDFs for OCR', () => {
    expect(looksScanned([{ number: 1, text: ' ' }, { number: 2, text: '3' }])).toBe(true);
    expect(looksScanned([{ number: 1, text: 'The City Council met on October 13, 2026 and approved the minutes.' }])).toBe(false);
  });
});

describe('archive policy', () => {
  it('archives minutes, agendas, ordinances, resolutions, notices, budgets and audits only', () => {
    for (const t of ['minutes', 'agenda', 'ordinance', 'resolution', 'public_notice', 'budget', 'audit', 'financial_report']) expect(shouldArchive(t, 'X')).toBe(true);
    for (const t of ['agenda_packet', 'staff_report', 'presentation', 'contract', 'other']) expect(shouldArchive(t, 'X')).toBe(false);
    expect(shouldArchive('agenda', '10.13.26 RDA Packet')).toBe(false);
    expect(shouldArchive('minutes', 'Draft minutes (City Council, 2026-09-15, item 3)')).toBe(false);
    expect(shouldArchive('resolution', 'Resolution 2026-40 (City Council, 2026-09-15, item 3)')).toBe(true);
  });
});

describe('AI neuron estimate', () => {
  it('counts input and the full output allowance', () => {
    const n = estimateNeurons('@cf/meta/llama-3.1-8b-instruct-fp8', { messages: [{ role: 'user', content: 'x'.repeat(3500) }], max_tokens: 400 });
    expect(n).toBeGreaterThanOrEqual((1000 * 4119 + 400 * 34868) / 1e6);
    expect(n).toBeLessThan(18.2);
    expect(estimateNeurons('@cf/unknown/model', { messages: [], max_tokens: 100 })).toBeGreaterThan(10);
  });
});

describe('calendar record', () => {
  it('lists events with date, time, category and place', () => {
    const t = calendarText([{ id: 'a', title: 'Blizzard 5K', category: 'Recreation', allDay: false, start: '2026-11-07T08:30:00', end: null, location: 'Lakeside Park', description: null, url: '' }], '2026-10-11', '2027-02-08');
    expect(t).toContain('2026-11-07 08:30 | Blizzard 5K | Recreation | Lakeside Park');
  });
});

describe('PDF text extraction (unpdf, as in the Worker)', () => {
  it('reads each page of a PDF', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const line of ['Agenda item 1: Call to order', 'Agenda item 2: Approval of minutes']) {
      const page = doc.addPage([400, 200]);
      page.drawText(line, { x: 20, y: 100, size: 12, font });
    }
    const { extractPdf } = await import('../worker/sync/extract');
    const out = await extractPdf(await doc.save());
    expect(out?.pageCount).toBe(2);
    expect(out?.pages[1].text).toContain('Approval of minutes');
  });
});

describe('real Revize construction page structure', () => {
  const html = `<html><head><base href="https://www.vineyardutah.gov/"><script>RZ.x = "<div id='post'>broken</div><table>";</script></head><body>
  <header><a href="index.php">Home</a></header>
  <main id="main"><div class="container"><div class="row"><div class="col-lg-9"><div id="entry"><div id="freeform-main"><div id="post" class="clearfix">
    <h1>Construction Projects</h1>
    <script>RZ.page = { html: "</div></div><p>junk</p>" };</script>
    <p><strong>AT A GLANCE</strong></p>
    <table border="1"><thead><tr><th><span><strong>Project</strong></span></th><th><span><strong>Type</strong></span></th><th><span><strong>Location</strong></span></th><th><span><strong>Work description</strong></span></th><th><span><strong>Status</strong></span></th><th><span><strong>Expected completion</strong></span></th></tr></thead>
    <tbody>
      <tr><td>HAWK crossing</td><td>Pedestrian signal</td><td>Center Street and Holdaway Road</td><td>New pedestrian crossing</td><td>Underway</td><td>Early November</td></tr>
      <tr><td>575 South</td><td>Road</td><td>575 South</td><td>Road work</td><td>Delayed</td><td>TBD</td></tr>
    </tbody></table>
  </div></div></div></div>
  <div class="col-lg-3"><article id="document-center"><section id="categorties-wrap">
    <div class="outer-cat cat"><h3>Pavement Preservation 2026 7 documents</h3><div class="inner-cat-wrap"><ul class="file-group">
      <li><a target="_blank" href="Departmnts/PW/Construction Updates/Email Update 1 - July 10, 2026.pdf?t=1760000000">Email Update 1 - July 10, 2026</a></li>
    </ul></div></div>
  </section></article></div></div></div></main>
  <footer><a href="privacy.php">Privacy</a></footer></body></html>`;

  it('reads the at a glance table, the documents and their categories', async () => {
    const { extractHtml } = await import('../worker/sync/extract');
    const page = extractHtml(html, 'https://www.vineyardutah.gov/government/construction_projects.php');
    const g = findGlance(page.tables)!;
    expect(g.headers).toEqual(['Project', 'Type', 'Location', 'Work description', 'Status', 'Expected completion']);
    expect(g.rows).toHaveLength(2);
    expect(g.rows[1]).toMatchObject({ Project: '575 South', Status: 'Delayed' });
    expect(page.text).not.toContain('junk');
    expect(page.text).not.toContain('RZ.');
    const doc = page.links.find((l) => l.url.includes('Email%20Update%201'))!;
    expect(doc.url).toBe('https://www.vineyardutah.gov/Departmnts/PW/Construction%20Updates/Email%20Update%201%20-%20July%2010,%202026.pdf?t=1760000000');
    expect(doc.group).toBe('Pavement Preservation 2026');
    expect(doc.text).toBe('Email Update 1 - July 10, 2026');
    expect(page.links.some((l) => l.url.includes('privacy.php'))).toBe(false);
  });
});

describe('robots.txt', () => {
  it('follows the group for our agent or *, longest match wins', async () => {
    const { parseRobots, allowedBy } = await import('../worker/sync/robotsParse');
    const rules = parseRobots(`User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /revize/\nDisallow: /search.php\nAllow: /revize/public/\n`);
    expect(allowedBy(rules, '/government/construction_projects.php')).toBe(true);
    expect(allowedBy(rules, '/revize/login')).toBe(false);
    expect(allowedBy(rules, '/revize/public/file.pdf')).toBe(true);
    expect(allowedBy(rules, '/search.php?q=x')).toBe(false);
    expect(allowedBy(parseRobots(''), '/anything')).toBe(true);
    expect(allowedBy(parseRobots('User-agent: VineyardTransparencyPortal\nDisallow: /private\n\nUser-agent: *\nDisallow: /'), '/public')).toBe(true);
  });
});

describe('CivicClerk copies set on other dates', () => {
  it('marks an entry naming another date, with no agenda or files, as unconfirmed', async () => {
    const { unconfirmedCopy, mapEvent } = await import('../worker/lib/civicclerk');
    expect(unconfirmedCopy('Active Transportation Commission Meeting 12-09-2025', '2026-12-08', false, 0)).toBe(true);
    expect(unconfirmedCopy('Active Transportation Commission Meeting 12-09-2025', '2025-12-09', false, 0)).toBe(false);
    expect(unconfirmedCopy('Active Transportation Commission Regular Meeting 10 -08 -2026', '2026-10-08', false, 1)).toBe(false);
    expect(unconfirmedCopy('Active Transportation Commission Meeting 12-09-2025', '2026-12-08', true, 0)).toBe(false);
    expect(unconfirmedCopy('City Council', '2026-12-08', false, 0)).toBe(false);
    const m = mapEvent({ id: 1425, eventName: 'Active Transportation Commission Meeting 12-09-2025', startDateTime: '2026-12-08T17:30:00Z', categoryName: 'Active Transportation Commission', isPublished: 'Published', agendaId: 0, publishedFiles: [] }, new Date('2026-10-11T00:00:00Z'));
    expect(m?.meeting.status).toBe('unconfirmed');
    expect(m?.meeting.date).toBe('2026-12-08');
  });
});

describe('public notice body', () => {
  it('uses the body the title names when the notice is filed under another', () => {
    // The notice site files ARCH Commission meetings under "City Council" (notice 1110699, September 24, 2026).
    expect(noticeBody('City Council', 'ARCH Commission Meeting')).toBe('ARCH Commission');
    expect(noticeBody('City Council', 'Planning Commission Work Session')).toBe('Planning Commission');
  });
  it('a cancellation notice cancels its meeting; other notices confirm it', () => {
    // Notice 1089445: the Planning Commission meeting of June 17, 2026 was canceled.
    expect(noticeStatus('Planning Commission Cancellation Notice 6.17.26 Meeting', '2026-06-17', '2026-10-11')).toBe('cancelled');
    expect(noticeStatus('CANCELED Planning Commission Meeting', '2026-04-15', '2026-10-11')).toBe('cancelled');
    expect(noticeStatus('Planning Commission Meeting', '2026-09-02', '2026-10-11')).toBe('held');
    expect(noticeStatus('City Council Meeting', '2026-10-13', '2026-10-11')).toBe('scheduled');
  });
  it('keeps the filing body when the title names it or names no other', () => {
    expect(noticeBody('City Council', 'City Council and RDA Joint Meeting')).toBe('City Council');
    expect(noticeBody('Redevelopment Agency', 'Redevelopment Agency Board Meeting')).toBe('Redevelopment Agency');
    expect(noticeBody('City Council', 'Regular Meeting')).toBe('City Council');
    expect(noticeBody('Planning Commission', 'Planning Commission Meeting')).toBe('Planning Commission');
  });
});
