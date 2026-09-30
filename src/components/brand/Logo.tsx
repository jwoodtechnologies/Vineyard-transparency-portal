import { cn } from '@/lib/cn';

/** Original mark: an open record (folded page with text lines) examined by a lens. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <rect width="32" height="32" rx="8" className="fill-brand-600 dark:fill-brand-500" />
      <path d="M9 6.5h9.2L23 11.3V14" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M9 6.5v19h6" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M12.5 12h6M12.5 15.5h3.5" stroke="#c1d2fb" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="20.5" cy="20" r="4.2" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M23.6 23.1l3 3" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-fg">Vineyard</span>
        <span className={cn('mt-[3px] whitespace-nowrap text-[11.5px] font-medium tracking-[0.02em] text-subtle', compact && 'max-[380px]:hidden')}>Transparency Portal</span>
      </span>
    </span>
  );
}
