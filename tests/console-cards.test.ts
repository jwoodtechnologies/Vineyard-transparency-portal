import { describe, expect, it } from 'vitest';
import { dedupeCards, normalizeHref } from '../src/console/cards';

describe('answer card destinations', () => {
  it('normalizes a link for comparison', () => {
    expect(normalizeHref('https://WWW.vineyardutah.gov/government/construction_projects.php/?utm_source=x&fbclid=1#top')).toBe('https://www.vineyardutah.gov/government/construction_projects.php');
    expect(normalizeHref('/construction/')).toBe('/construction');
    expect(normalizeHref('/map?layers=parcels&utm_medium=chat')).toBe('/map?layers=parcels');
    expect(normalizeHref('/map?z=17&lat=40.3')).toBe(normalizeHref('/map?lat=40.3&z=17'));
  });

  it('keeps one card per destination, the more specific one', () => {
    const out = dedupeCards([
      { label: 'City Hall', href: 'https://www.vineyardutah.gov/contact/' },
      { label: 'Contact City Hall', hint: '801-226-1929', href: 'https://www.vineyardutah.gov/contact#hours' },
      { label: 'Permits', href: '/services/permits' },
    ]);
    expect(out.map((c) => c.label)).toEqual(['Contact City Hall', 'Permits']);
  });

  it('never shows two cards with the same title', () => {
    const out = dedupeCards([
      { label: 'Construction projects', hint: 'Timelines, closures and map', href: '/construction' },
      { label: 'Construction projects', hint: 'Current city projects', href: '/services/construction' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe('/construction');
  });
});
