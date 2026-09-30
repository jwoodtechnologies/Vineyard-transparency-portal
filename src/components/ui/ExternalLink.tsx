import type { ReactNode } from 'react';
import { ExternalLink as ExternalIcon } from 'lucide-react';
import { safeUrl } from '@/lib/safety';
import { cn } from '@/lib/cn';

/** Link to an external source. Unsafe schemes (javascript:, data:, …) render as plain text. */
export function ExternalLink({ href, children, className, icon = true }: { href: string | null | undefined; children: ReactNode; className?: string; icon?: boolean }) {
  const url = safeUrl(href);
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow" className={cn('inline-flex items-center gap-1', className)}>
      {children}
      {icon && <ExternalIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
