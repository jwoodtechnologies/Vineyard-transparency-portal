import type { ReactNode } from 'react';
import { Rss } from 'lucide-react';

/** A small "RSS" link to one of the portal's feeds (no account needed), after any other quiet links. */
export function RssLink({ href, title, children }: { href: string; title: string; children?: ReactNode }) {
  return (
    <p className="vc-rss-row">
      {children}
      <a className="vc-rss" href={href} title={title} type="application/rss+xml">
        <Rss size={13} strokeWidth={2} aria-hidden="true" />
        RSS
      </a>
    </p>
  );
}
