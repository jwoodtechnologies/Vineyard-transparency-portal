/**
 * Notices staff post for every page (an office closure, a change to a meeting): a quiet bar under the top bar,
 * with a link when staff added one. A reader can close one for the rest of their visit; a notice that staff
 * change comes back, because the change is part of what was closed.
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { getJson } from './api';

export interface SiteNotice {
  id: string;
  tone: 'info' | 'alert';
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  updatedAt: string;
}

const KEY = 'vtp:notices:closed';
const MEMO_MS = 60_000;
let memo: { at: number; items: Promise<SiteNotice[]> } | null = null;

/** The notices showing now, read once a minute at most however many screens ask. */
function load(): Promise<SiteNotice[]> {
  if (!memo || Date.now() - memo.at > MEMO_MS) {
    memo = {
      at: Date.now(),
      items: getJson<{ items: SiteNotice[] }>('/api/notices').then(
        (r) => r.items ?? [],
        () => [],
      ),
    };
  }
  return memo.items;
}

const stamp = (n: SiteNotice) => `${n.id}:${n.updatedAt}`;

function closedList(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function NoticeBar() {
  const [items, setItems] = useState<SiteNotice[]>([]);
  const [closed, setClosed] = useState<string[]>(closedList);
  useEffect(() => {
    let live = true;
    load().then((r) => live && setItems(r));
    return () => {
      live = false;
    };
  }, []);
  const shown = items.filter((n) => !closed.includes(stamp(n)));
  if (!shown.length) return null;

  function close(n: SiteNotice) {
    const next = [...closed, stamp(n)];
    setClosed(next);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private mode: it simply comes back on the next page */
    }
  }

  return (
    <div className="vc-sitenotes" role="region" aria-label="Notices">
      {shown.map((n) => (
        <p key={n.id} className="vc-sitenote" data-tone={n.tone}>
          <span className="vc-sitenote-text">{n.message}</span>
          {n.linkUrl && (
            <a className="vc-sitenote-link" href={n.linkUrl} target="_blank" rel="noopener noreferrer">
              {n.linkLabel ?? 'Learn more'}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          )}
          <button type="button" className="vc-sitenote-x" onClick={() => close(n)} aria-label="Close this notice">
            <X size={15} aria-hidden="true" />
          </button>
        </p>
      ))}
    </div>
  );
}
