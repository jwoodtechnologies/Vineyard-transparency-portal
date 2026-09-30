import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'demo';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-muted border-line',
  accent: 'bg-accent-soft text-accent-ink border-transparent',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  demo: 'bg-demo-soft text-demo border-demo/25',
};

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: BadgeTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium leading-4', tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function DemoBadge({ className, label = 'Demo' }: { className?: string; label?: string }) {
  return (
    <Badge tone="demo" className={className}>
      <span aria-hidden className="size-1.5 rounded-full bg-demo" />
      {label}
    </Badge>
  );
}
