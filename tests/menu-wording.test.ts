import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { headFor } from '@/lib/routeHead';

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('menu', () => {
  const chrome = src('src/console/Chrome.tsx');
  const start = chrome.indexOf('const MENU_ROWS');
  const rows = chrome.slice(start, chrome.indexOf('];', start));

  it('keeps only the main record groups (no All records, Add or Sources rows)', () => {
    const labels = [...rows.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels).toEqual(['Voting records', 'Budget and finance', 'Agendas & minutes', 'Boards and commissions', 'Ordinances & resolutions', 'RDA (Redevelopment Agency)']);
    expect(rows).not.toMatch(/'\/add'|'\/sources'|to: '\/records'/);
    expect(chrome).not.toMatch(/All records|Add to the record|Submit a public record/);
  });

  it('the records home links quietly to the submit page and Sources', () => {
    const home = src('src/console/RecordsHome.tsx');
    expect(home).toMatch(/<Link to="\/add" className="vc-rss">\s*Submit a public record\s*<\/Link>/);
    expect(home).toMatch(/<Link to="\/sources" className="vc-rss">\s*Sources\s*<\/Link>/);
  });
});

describe('Submit a public record wording', () => {
  it('route head, page and shell title use the new name; the URL stays /add', () => {
    expect(headFor('/add').title).toBe('Submit a public record');
    expect(headFor('/add').description).toMatch(/after review/);
    const page = src('src/console/AddPage.tsx');
    expect(page).toContain("setHead('Submit a public record')");
    expect(page).toContain('<h1 className="vc-page-title">Submit a public record</h1>');
    expect(page).toContain('Thanks. Your submission will appear after review.');
    expect(src('index.html')).toContain("html[data-route='add'] #vtp-shell .s-title::after { content: 'Submit a public record'; }");
    for (const f of ['src/console/AddPage.tsx', 'src/lib/routeHead.ts', 'index.html', 'README.md', 'worker/panel/page.ts']) expect(src(f)).not.toContain('Add to the record');
  });
});
