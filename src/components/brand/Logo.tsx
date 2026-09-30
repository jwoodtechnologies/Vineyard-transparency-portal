import { cn } from '@/lib/cn';

/** Compact text monogram for tight spots (kept for existing imports; no pictorial logo). */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center text-[20px] font-semibold italic leading-none text-[#7a2d52] dark:text-[#e6a9c6]', className)}
      style={{ fontFamily: "'Source Serif 4 Variable', 'Source Serif 4', Georgia, serif" }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      V
    </span>
  );
}

/** The Vineyard Transparency Portal wordmark: text only. */
export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('flex flex-col items-start leading-none', className)}>
      <span className="whitespace-nowrap text-[18px] font-semibold tracking-[-0.015em] text-fg" style={{ fontFamily: "'Source Serif 4 Variable', 'Source Serif 4', Georgia, serif" }}>
        Vineyard
      </span>
      <span className={cn('mt-[4px] whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.32em] text-subtle', compact && 'max-[380px]:hidden')}>Transparency Portal</span>
    </span>
  );
}
