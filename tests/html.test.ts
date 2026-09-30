import { describe, expect, it } from 'vitest';
import { decodeEntities, extractLinks, htmlDocumentText } from '../scripts/lib/html';

const PAGE = 'https://www.example.org/dir/page.php';

describe('extractLinks', () => {
  it('extracts anchors with decoded text and resolved URLs', () => {
    const { links, title } = extractLinks(
      `<html><head><title>Records &amp; Reports</title></head><body>
        <a href="docs/a.pdf?x=1&amp;y=2">Budget &ndash; FY&nbsp;2026</a>
        <A HREF='/b.pdf' class=x>  Spaced   <b>bold</b> text </A>
        <a href=/c.pdf>Unquoted</a>
      </body></html>`,
      PAGE,
    );
    expect(title).toBe('Records & Reports');
    expect(links.map((l) => l.url)).toEqual([
      'https://www.example.org/dir/docs/a.pdf?x=1&y=2',
      'https://www.example.org/b.pdf',
      'https://www.example.org/c.pdf',
    ]);
    expect(links[0].text).toBe('Budget – FY 2026');
    expect(links[1].text).toBe('Spaced bold text');
  });

  it('ignores links inside comments, scripts, styles and templates', () => {
    const { links } = extractLinks(
      `<!-- <a href="/hidden.pdf">x</a> --><script>document.write('<a href="/js.pdf">y</a>')</script>
       <style>a[href="/css.pdf"]{}</style><template><a href="/tpl.pdf">t</a></template><a href="/real.pdf">real</a>`,
      PAGE,
    );
    expect(links.map((l) => l.url)).toEqual(['https://www.example.org/real.pdf']);
  });

  it('honours <base href>', () => {
    const { links } = extractLinks(`<base href="https://files.example.net/root/"><a href="x.pdf">x</a>`, PAGE);
    expect(links[0].url).toBe('https://files.example.net/root/x.pdf');
  });

  it('collects area, iframe, embed, object, data-* and onclick URLs', () => {
    const { links } = extractLinks(
      `<map><area href="/map.pdf" alt="Zoning map"></map>
       <iframe src="https://meetings.example.net/embed?id=5"></iframe>
       <embed src="/e.pdf"><object data="/o.pdf"></object>
       <div data-href="/data.pdf" title="Data doc"></div>
       <button onclick="window.open('/popup.pdf')">Open</button>
       <link rel="stylesheet" href="/style.css"><link rel="alternate" href="/feed.xml">`,
      PAGE,
    );
    const byOrigin = Object.fromEntries(links.map((l) => [l.origin, l.url]));
    expect(byOrigin.area).toBe('https://www.example.org/map.pdf');
    expect(links.find((l) => l.origin === 'area')?.text).toBe('Zoning map');
    expect(byOrigin.iframe).toBe('https://meetings.example.net/embed?id=5');
    expect(byOrigin.embed).toBe('https://www.example.org/e.pdf');
    expect(byOrigin.object).toBe('https://www.example.org/o.pdf');
    expect(byOrigin.data_attribute).toBe('https://www.example.org/data.pdf');
    expect(byOrigin.onclick).toBe('https://www.example.org/popup.pdf');
    expect(byOrigin.link).toBe('https://www.example.org/feed.xml');
    expect(links.some((l) => l.url?.endsWith('style.css'))).toBe(false);
  });

  it('uses img alt or title when an anchor has no text', () => {
    const { links } = extractLinks(`<a href="/a.pdf"><img src="i.png" alt="Agenda"></a><a href="/b.pdf" title="Minutes"></a>`, PAGE);
    expect(links.map((l) => l.text)).toEqual(['Agenda', 'Minutes']);
  });

  it('reports non-http schemes without resolving them', () => {
    const { links } = extractLinks(`<a href="mailto:a@example.org">mail</a><a href="javascript:void(0)">js</a><a href="tel:555">t</a>`, PAGE);
    expect(links.map((l) => [l.scheme, l.url])).toEqual([
      ['mailto', null],
      ['javascript', null],
      ['tel', null],
    ]);
  });

  it('survives malformed markup (unclosed anchors, stray quotes, attributes containing >)', () => {
    const { links } = extractLinks(`<a href="/one.pdf">One <a href="/two.pdf" title="a > b">Two</a><a href="/three.pdf">Three`, PAGE);
    expect(links.map((l) => l.url?.split('/').pop())).toEqual(['one.pdf', 'two.pdf', 'three.pdf']);
    expect(links[0].text).toBe('One');
    expect(links[2].text).toBe('Three');
  });

  it('extracts meta refresh targets and headings', () => {
    const page = extractLinks(`<meta http-equiv="refresh" content="0; url=/moved.html"><h1>Main</h1><h2>Sub <i>heading</i></h2>`, PAGE);
    expect(page.links[0]).toMatchObject({ origin: 'meta_refresh', url: 'https://www.example.org/moved.html' });
    expect(page.headings).toEqual(['Main', 'Sub heading']);
  });
});

describe('decodeEntities / htmlDocumentText', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('&lt;a&gt; &#169; &#x2014; &unknown; &amp;amp;')).toBe('<a> © — &unknown; &amp;');
  });

  it('extracts plain text without scripts or navigation', () => {
    const { title, text } = htmlDocumentText(
      `<html><head><title>Notice</title><script>alert(1)</script></head><body><nav>Menu</nav><h1>Public Notice</h1><p>The hearing will be held.</p><footer>Footer</footer></body></html>`,
    );
    expect(title).toBe('Notice');
    expect(text).toBe('Public Notice\n\nThe hearing will be held.');
  });
});
