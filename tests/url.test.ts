import { describe, expect, it } from 'vitest';
import { extensionOf, fileNameFromUrl, hostMatches, normalizeUrl, resolveUrl } from '../scripts/lib/url';

describe('normalizeUrl', () => {
  it('lower-cases scheme and host, strips fragments and default ports', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.ORG:443/Docs/File.pdf#page=3')).toBe('https://www.example.org/Docs/File.pdf');
    expect(normalizeUrl('http://example.org:80/a')).toBe('http://example.org/a');
    expect(normalizeUrl('https://example.org:8443/a')).toBe('https://example.org:8443/a');
  });

  it('strips tracking parameters and sorts the rest', () => {
    expect(normalizeUrl('https://example.org/p?b=2&utm_source=x&a=1&fbclid=abc&gclid=1&UTM_Campaign=y')).toBe('https://example.org/p?a=1&b=2');
    expect(normalizeUrl('https://example.org/p?utm_medium=email')).toBe('https://example.org/p');
  });

  it('respects custom strip lists', () => {
    expect(normalizeUrl('https://example.org/p?ref=1&x=2', { stripParams: ['ref'] })).toBe('https://example.org/p?x=2');
  });

  it('removes trailing slashes except at the root, and collapses duplicate slashes', () => {
    expect(normalizeUrl('https://example.org/a/b/')).toBe('https://example.org/a/b');
    expect(normalizeUrl('https://example.org')).toBe('https://example.org/');
    expect(normalizeUrl('https://example.org//a///b')).toBe('https://example.org/a/b');
  });

  it('resolves dot segments and drops credentials', () => {
    expect(normalizeUrl('https://user:pw@example.org/a/./b/../c')).toBe('https://example.org/a/c');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeUrl('mailto:someone@example.org')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });

  it('treats equivalent URLs as identical', () => {
    const a = normalizeUrl('https://Example.org/x/?b=1&a=2#top');
    const b = normalizeUrl('https://example.org/x?a=2&b=1&utm_source=feed');
    expect(a).toBe(b);
  });
});

describe('resolveUrl', () => {
  it('resolves relative references against the page URL', () => {
    expect(resolveUrl('docs/a.pdf', 'https://example.org/dir/page.php')).toBe('https://example.org/dir/docs/a.pdf');
    expect(resolveUrl('../up.pdf', 'https://example.org/dir/sub/page')).toBe('https://example.org/dir/up.pdf');
    expect(resolveUrl('//cdn.example.net/x.pdf', 'https://example.org/')).toBe('https://cdn.example.net/x.pdf');
    expect(resolveUrl('  /a b.pdf\n', 'https://example.org/')).toBe('https://example.org/a%20b.pdf');
  });

  it('returns null for non-http results', () => {
    expect(resolveUrl('mailto:x@example.org', 'https://example.org/')).toBeNull();
    expect(resolveUrl('', 'https://example.org/')).toBeNull();
  });
});

describe('host patterns and file helpers', () => {
  it('matches suffix and exact host patterns', () => {
    expect(hostMatches('www.example.org', 'example.org')).toBe(true);
    expect(hostMatches('example.org', 'example.org')).toBe(true);
    expect(hostMatches('notexample.org', 'example.org')).toBe(false);
    expect(hostMatches('www.example.org', '=example.org')).toBe(false);
    expect(hostMatches('example.org', '=example.org')).toBe(true);
    expect(hostMatches('WWW.EXAMPLE.ORG.', 'example.org')).toBe(true);
  });

  it('extracts extensions and file names', () => {
    expect(extensionOf('https://example.org/a/B.PDF?x=1')).toBe('pdf');
    expect(extensionOf('https://example.org/a/')).toBeNull();
    expect(extensionOf('https://example.org/View/123')).toBeNull();
    expect(fileNameFromUrl('https://example.org/a/My%20File.pdf')).toBe('My File.pdf');
  });
});
