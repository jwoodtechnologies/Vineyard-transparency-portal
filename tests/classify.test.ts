import { describe, expect, it } from 'vitest';
import { classifyLink, documentTypeHint, isRelevantPage, isSkippedUrl, seedForUrl, systemKindForUrl } from '../scripts/lib/classify';
import { loadSeedsConfig } from '../scripts/lib/config';
import { testConfig } from './helpers/fixtures';

const real = loadSeedsConfig();
const cfg = testConfig();

describe('classifyLink (patterns from config/source-seeds.json)', () => {
  it('classifies direct files by extension', () => {
    const pdf = classifyLink(cfg, { url: 'https://www.example.org/a/report.pdf', text: 'Annual report', pageUrl: 'https://www.example.org/' });
    expect(pdf.linkKind).toBe('document');
    expect(pdf.fileKind).toBe('pdf');
    expect(classifyLink(cfg, { url: 'https://www.example.org/a.xlsx' }).fileKind).toBe('spreadsheet');
    expect(classifyLink(cfg, { url: 'https://www.example.org/a.ods' }).fileKind).toBe('spreadsheet');
    expect(classifyLink(cfg, { url: 'https://www.example.org/a.docx' }).fileKind).toBe('word');
    expect(classifyLink(cfg, { url: 'https://www.example.org/a.odt' }).fileKind).toBe('word');
    expect(classifyLink(cfg, { url: 'https://www.example.org/a.csv' }).fileKind).toBe('csv');
  });

  it('treats document-library download paths as documents even without an extension', () => {
    const c = classifyLink(cfg, { url: 'https://www.example.org/DocumentCenter/View/55/Some-Title', text: 'Agenda' });
    expect(c.linkKind).toBe('document');
    expect(c.fileKind).toBeNull();
    expect(c.systemKind).toBe('document_library');
  });

  it('uses the content type when known', () => {
    const c = classifyLink(cfg, { url: 'https://www.example.org/getfile?id=9', contentType: 'application/pdf' });
    expect(c.linkKind).toBe('document');
    expect(c.fileKind).toBe('pdf');
  });

  it('never follows social, marketing, or news domains', () => {
    for (const url of ['https://www.facebook.com/x', 'https://x.com/y', 'https://twitter.com/y', 'https://www.linkedin.com/company/z', 'https://www.tiktok.com/@a', 'https://nextdoor.com/p', 'https://ad.doubleclick.net/c']) {
      expect(classifyLink(real, { url }).linkKind).toBe('denied');
    }
  });

  it('records media links (YouTube) without crawling them, and recognises meeting video', () => {
    const c = classifyLink(real, { url: 'https://www.youtube.com/watch?v=1', text: 'Watch the council meeting live' });
    expect(c.linkKind).toBe('media');
    expect(c.systemKind).toBe('meeting_media');
    expect(c.documentTypeHint).toBe('recording');
  });

  it('recognises public-record systems by host/path pattern', () => {
    expect(systemKindForUrl(real, 'https://www.utah.gov/pmn/sitemap/notice/1.html').kind).toBe('public_notice_system');
    expect(systemKindForUrl(real, 'https://www.utah.gov/other/').kind).toBe('utah_gov_database');
    expect(systemKindForUrl(real, 'https://transparent.utah.gov/').kind).toBe('financial_transparency');
    expect(systemKindForUrl(real, 'https://reporting.auditor.utah.gov/x').kind).toBe('state_auditor');
    expect(systemKindForUrl(real, 'https://library.municode.com/ut/some_town').kind).toBe('municipal_code');
    expect(systemKindForUrl(real, 'https://codelibrary.amlegal.com/codes/x').kind).toBe('municipal_code');
    expect(systemKindForUrl(real, 'https://sometown.granicus.com/ViewPublisher.php').kind).toBe('meeting_portal');
    expect(systemKindForUrl(real, 'https://sometown.legistar.com/Calendar.aspx').kind).toBe('meeting_portal');
    expect(systemKindForUrl(real, 'https://some.example.com/page').kind).toBeNull();
  });

  it('maps URLs to configured seeds with the longest path prefix', () => {
    expect(seedForUrl(cfg, 'https://www.example.org/transparency/x.php')?.id).toBe('test-portal');
    expect(seedForUrl(cfg, 'https://www.example.org/other')?.id).toBe('test-city');
    expect(seedForUrl(cfg, 'https://unknown.example.org/')).toBeNull();
  });

  it('marks unapproved hosts as external (not crawlable) and flags externality', () => {
    const c = classifyLink(cfg, { url: 'https://unrelated.example.com/page', pageUrl: 'https://www.example.org/' });
    expect(c.linkKind).toBe('external');
    expect(c.isExternal).toBe(true);
    expect(c.hostApproved).toBe(false);
  });
});

describe('documentTypeHint (URL + link text heuristics)', () => {
  it.each([
    ['https://x.example/a.pdf', 'Agenda Packet', 'agenda_packet'],
    ['https://x.example/a.pdf', 'Council Agenda', 'agenda'],
    ['https://x.example/minutes/2026-01-05.pdf', '', 'minutes'],
    ['https://x.example/a.pdf', 'Ordinance 2026-07', 'ordinance'],
    ['https://x.example/a.pdf', 'Resolution No. 2026-14', 'resolution'],
    ['https://x.example/a.pdf', 'Notice of Public Hearing', 'public_notice'],
    ['https://x.example/a.pdf', 'Meeting transcript', 'transcript'],
    ['https://x.example/a.mp3', 'Audio recording', 'recording'],
    ['https://x.example/a.pdf', 'Annual Comprehensive Financial Report (ACFR)', 'audit'],
    ['https://x.example/a.pdf', 'Tentative Budget', 'budget'],
  ])('%s + "%s" → %s', (url, text, expected) => {
    expect(documentTypeHint(url, text)).toBe(expected);
  });

  it('returns null when nothing matches', () => {
    expect(documentTypeHint('https://x.example/a.pdf', 'Photo')).toBeNull();
  });
});

describe('crawl filters', () => {
  it('detects relevant pages by keyword', () => {
    expect(isRelevantPage(cfg, 'https://www.example.org/departments/finance', '')).toBe(true);
    expect(isRelevantPage(cfg, 'https://www.example.org/parks', 'Parks and trails')).toBe(false);
  });

  it('skips login, search, calendar and asset URLs', () => {
    expect(isSkippedUrl(cfg, 'https://www.example.org/Login')).toBe(true);
    expect(isSkippedUrl(cfg, 'https://www.example.org/Search?q=x')).toBe(true);
    expect(isSkippedUrl(cfg, 'https://www.example.org/Calendar.aspx?month=1')).toBe(true);
    expect(isSkippedUrl(cfg, 'https://www.example.org/site.css')).toBe(true);
    expect(isSkippedUrl(cfg, 'https://www.example.org/agendas')).toBe(false);
  });
});
