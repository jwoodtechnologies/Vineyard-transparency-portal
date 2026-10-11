/** Answer cards and links: one card per destination, and never two cards with the same title. */

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl|ref|ref_src|igshid)$/i;

/** A link's destination for comparison: no hash, no tracking parameters, no trailing slash, host in lower case. */
export function normalizeHref(href: string): string {
  const raw = href.trim();
  let url: URL;
  try {
    url = new URL(raw, 'https://portal.invalid');
  } catch {
    return raw.replace(/#.*$/, '').replace(/\/+$/, '');
  }
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const origin = url.origin === 'https://portal.invalid' ? '' : `${url.protocol}//${url.host.toLowerCase()}`;
  return `${origin}${path}${query}`;
}

export interface CardLike {
  label: string;
  href: string;
  hint?: string;
}

/** How much a card says about where it goes: a hint and a longer label are more specific. */
const specificity = (c: CardLike) => (c.hint ? 1000 : 0) + c.label.length + (c.hint?.length ?? 0) / 1000;

const titleKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Cards in their original order with duplicates removed: two cards with one destination keep the
 * more specific one (in the first one's place); two cards with the same visible title keep the first.
 */
export function dedupeCards<T extends CardLike>(cards: T[]): T[] {
  const byHref = new Map<string, number>();
  const out: T[] = [];
  for (const c of cards) {
    const key = normalizeHref(c.href);
    const at = byHref.get(key);
    if (at === undefined) {
      byHref.set(key, out.length);
      out.push(c);
    } else if (specificity(c) > specificity(out[at])) out[at] = c;
  }
  const titles = new Set<string>();
  return out.filter((c) => {
    const k = titleKey(c.label);
    if (titles.has(k)) return false;
    titles.add(k);
    return true;
  });
}
