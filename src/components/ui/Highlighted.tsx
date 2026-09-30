import { Fragment } from 'react';
import { cleanText } from '@/lib/safety';

/**
 * Renders untrusted text with highlight ranges as <mark> elements. Never uses innerHTML.
 */
export function Highlighted({ text, ranges, className }: { text: string; ranges?: Array<[number, number]>; className?: string }) {
  const safe = cleanText(text);
  if (!ranges?.length) return <span className={className}>{safe}</span>;
  const parts: Array<{ t: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [a, b] of ranges) {
    if (a < cursor || a >= safe.length) continue;
    if (a > cursor) parts.push({ t: safe.slice(cursor, a), hit: false });
    parts.push({ t: safe.slice(a, Math.min(b, safe.length)), hit: true });
    cursor = Math.min(b, safe.length);
  }
  if (cursor < safe.length) parts.push({ t: safe.slice(cursor), hit: false });
  return (
    <span className={className}>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <Fragment key={i}>{p.t}</Fragment>))}
    </span>
  );
}
