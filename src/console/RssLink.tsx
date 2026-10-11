import { Rss } from 'lucide-react';

/** A small "RSS" link to one of the portal's feeds (no account needed). */
export function RssLink({ href, title }: { href: string; title: string }) {
  return (
    <p className="vc-rss-row">
      <a className="vc-rss" href={href} title={title} type="application/rss+xml">
        <Rss size={13} strokeWidth={2} aria-hidden="true" />
        RSS
      </a>
    </p>
  );
}
