import { describe, expect, it } from 'vitest';
import { judge, overlap, pick, pixelStats, recordIds, rng } from '../scripts/doc-check/lib.mjs';
import { evaluate, plan, type Run } from '../scripts/watchdog/lib.mjs';
import { fileKind, fileRoute, PROXY_HOSTS } from '../src/lib/documentFile';
import { viewerMode } from '../src/components/documents/viewerMode';
import { outputScale } from '../src/components/documents/pdfAssets';
import { nativeFragment, pageCssWidth, zoomStep } from '../src/components/documents/zoom';

const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

describe('viewer per device', () => {
  it('uses the browser PDF viewer on a computer and pdf.js on phones and tablets', () => {
    expect(viewerMode({ userAgent: CHROME_MAC, pdfViewerEnabled: true, maxTouchPoints: 0 })).toBe('native');
    expect(viewerMode({ userAgent: CHROME_MAC, pdfViewerEnabled: false })).toBe('pdfjs');
    expect(viewerMode({ userAgent: IPHONE, pdfViewerEnabled: true, maxTouchPoints: 5 })).toBe('pdfjs');
    expect(viewerMode({ userAgent: ANDROID, pdfViewerEnabled: false, maxTouchPoints: 5 })).toBe('pdfjs');
    // iPadOS reports a Mac user agent; the touch screen gives it away.
    expect(viewerMode({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', pdfViewerEnabled: true, maxTouchPoints: 5 })).toBe('pdfjs');
    expect(viewerMode({ userAgent: CHROME_MAC, pdfViewerEnabled: true }, 'pdfjs')).toBe('pdfjs');
  });

  it('keeps canvases under the iPhone size limit and sharp on dense screens', () => {
    expect(outputScale(390, 505, 3)).toBe(3);
    expect(outputScale(2000, 2600, 3) * Math.sqrt(2000 * 2600)).toBeLessThanOrEqual(Math.sqrt(16_000_000) + 1);
    expect(outputScale(800, 1000, 1)).toBe(1);
  });
});

describe('zoom', () => {
  it('steps through the zoom levels from the percent on screen', () => {
    expect(zoomStep(75, 1)).toBe(80);
    expect(zoomStep(119, -1)).toBe(110);
    expect(zoomStep(42, 1)).toBe(50);
    expect(zoomStep(25, -1)).toBe(25);
    expect(zoomStep(300, 1, 300)).toBe(300);
  });

  it('shows most of the first page on a computer, fits the width on a phone', () => {
    // 1280 by 720: a letter page (816 px at 100%) drawn at 75%, not the full 974 px width.
    expect(pageCssWidth({ mode: 'auto' }, 974, 816, 11 / 8.5, 720)).toBe(612);
    expect(pageCssWidth({ mode: 'auto' }, 340, 816, 11 / 8.5, 844)).toBe(340);
    expect(pageCssWidth({ mode: 'width' }, 974, 816, 11 / 8.5, 720)).toBe(974);
    expect(pageCssWidth({ mode: 'pct', pct: 150 }, 974, 816, 11 / 8.5, 720)).toBe(1224);
  });

  it('asks the browser viewer for the page and zoom, without its toolbar', () => {
    expect(nativeFragment(3, { mode: 'auto' }, 75)).toBe('page=3&zoom=75&toolbar=0&navpanes=0');
    expect(nativeFragment(1, { mode: 'width' }, 75)).toBe('page=1&zoom=page-width&view=FitH&toolbar=0&navpanes=0');
    expect(nativeFragment(2, { mode: 'pct', pct: 125 }, 75)).toBe('page=2&zoom=125&toolbar=0&navpanes=0');
  });
});

describe('where a file is read from', () => {
  it('serves an archived copy, streams government hosts, reads CivicClerk in the browser, else offers the link', () => {
    expect(fileRoute({ archiveUrl: '/api/documents/doc_1/file', originalUrl: 'https://example.com/a.pdf' })).toBe('archive');
    expect(fileRoute({ archiveUrl: null, originalUrl: 'https://www.vineyardutah.gov/Vineyard%20Regional%20Trail%20-%20Email%20Update%204.pdf?t=1' })).toBe('proxy');
    expect(fileRoute({ archiveUrl: null, originalUrl: 'https://vineyardut.api.civicclerk.com/v1/Meetings/GetMeetingFileStream(fileId=3378,plainText=false)' })).toBe('direct');
    expect(fileRoute({ archiveUrl: null, originalUrl: 'https://evil.example/vineyardutah.gov/x.pdf' })).toBe('none');
    expect(PROXY_HOSTS.test('https://www.vineyardutah.gov.evil.example/x.pdf')).toBe(false);
  });

  it('shows PDFs and images, offers Word files and spreadsheets as downloads', () => {
    expect(fileKind('application/pdf')).toBe('pdf');
    expect(fileKind('image/jpeg')).toBe('image');
    expect(fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('word');
    expect(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('sheet');
    expect(fileKind('text/html; charset=utf-8')).toBe('text');
  });
});

describe('nightly document check', () => {
  it('finds record ids in page payloads', () => {
    expect(recordIds('{"a":"doc_4a2030ca2de99f44","b":["doc_4a2030ca2de99f44","doc_750d956cc3d5a4a2"],"c":"doc_short"}')).toEqual(['doc_4a2030ca2de99f44', 'doc_750d956cc3d5a4a2']);
  });

  it('samples repeatably from a seed', () => {
    expect(pick([1, 2, 3, 4, 5, 6], 3, rng(7))).toEqual(pick([1, 2, 3, 4, 5, 6], 3, rng(7)));
  });

  it('tells a readable page from a washed out or blank one', () => {
    const page = (darkShare: number, grayShare: number) => {
      const n = 10000;
      const d = new Uint8ClampedArray(n * 4).fill(255);
      for (let i = 0; i < n; i++) {
        const v = i < n * darkShare ? 20 : i < n * (darkShare + grayShare) ? 225 : 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      }
      return pixelStats(d, 1);
    };
    const toolbar = { styled: true };
    const words = 'regular city council meeting minutes present mayor council member public works director agenda motion seconded approved unanimously budget resolution';
    expect(judge({ state: 'drawn', toolbar, pixels: page(0.05, 0), text: words }, words, true)).toEqual([]);
    // The April 14, 2026 minutes before the fix: the scan's text layer missing, only the faint background left.
    expect(judge({ state: 'drawn', toolbar, pixels: page(0.0005, 0.05), text: '' }, words, true)[0]).toMatch(/low contrast/);
    expect(judge({ state: 'drawn', toolbar, pixels: page(0, 0), text: '' }, words, true)).toEqual(['first page is blank']);
    expect(judge({ state: 'drawn', toolbar: { styled: false, why: 'display block' }, pixels: page(0.05, 0), text: words }, words, true)[0]).toMatch(/toolbar unstyled/);
    expect(judge({ state: 'card', toolbar }, '', true)[0]).toMatch(/Open the PDF/);
    expect(judge({ state: 'card', toolbar }, '', false)).toEqual([]);
  });

  it('compares page text by shared words, and skips pages with too little text', () => {
    const a = 'notice regular city council meeting april held council chambers present mayor stratton council members holdaway lauret mccumber nair wood';
    expect(overlap(a, `${a} additional words later pages`)).toBe(1);
    expect(overlap(a, 'completely different words about something unrelated entirely here there where every other thing nothing matches whatsoever really')).toBeLessThan(0.2);
    expect(overlap('few words', a)).toBeNull();
  });

  it('opens a watchdog issue when the nightly document check fails and closes it when it passes', () => {
    const run = (id: number, conclusion: string): Run => ({ id, status: 'completed', conclusion, html_url: `https://github.com/o/r/actions/runs/${id}` });
    const failing = plan(evaluate({ health: null, chatRun: null, docRun: run(5, 'failure'), ingestRuns: null, repo: 'o/r', base: 'https://vineyardportal.org' }), [], Date.now(), false);
    expect(failing[0]).toMatchObject({ type: 'create', title: 'Watchdog: document check failing' });
    const open = [{ number: 3, title: 'Watchdog: document check failing', lastNoteAt: null }];
    expect(plan(evaluate({ health: null, chatRun: null, docRun: run(6, 'success'), ingestRuns: null, repo: 'o/r', base: 'https://vineyardportal.org' }), open, Date.now(), false)).toEqual([expect.objectContaining({ type: 'close', number: 3 })]);
  });
});
