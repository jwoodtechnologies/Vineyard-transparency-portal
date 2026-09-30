import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function PageHeader({ eyebrow, title, description, actions, children, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('border-b border-line bg-surface', className)}>
      <div className="container-page py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
            <h1 className="font-serif text-[1.85rem] font-semibold leading-tight tracking-[-0.015em] sm:text-[2.25rem]">{title}</h1>
            {description && <div className="mt-2 text-[15.5px] leading-relaxed text-muted">{description}</div>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
