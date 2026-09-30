import type { ReactNode } from 'react';
import { CloudOff, FileQuestion, SearchX, ServerCrash, Sparkles, TriangleAlert } from 'lucide-react';
import { isDataError } from '@/data/adapters/errors';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card flex flex-col items-center px-6 py-12 text-center', className)}>
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-raised text-subtle">{icon ?? <SearchX className="size-5" />}</div>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

const MESSAGES: Record<string, { title: string; body: string; icon: ReactNode }> = {
  offline: {
    title: 'The archive is offline',
    body: 'The public-record archive could not be reached. Your connection may be down, or the archive backend may be temporarily unavailable. Nothing you saved on this device is affected.',
    icon: <CloudOff className="size-5" />,
  },
  backend_unavailable: {
    title: 'The archive backend is not connected',
    body: 'This deployment is not connected to the archive backend yet. Please try again later.',
    icon: <ServerCrash className="size-5" />,
  },
  not_found: {
    title: 'Not found',
    body: 'This record is not in the archive. The link may be mistyped, or the record may have been merged with a duplicate.',
    icon: <FileQuestion className="size-5" />,
  },
  search_unavailable: {
    title: 'Search is temporarily unavailable',
    body: 'The search index is not responding right now. Please try again in a moment.',
    icon: <SearchX className="size-5" />,
  },
  ai_unavailable: {
    title: 'AI answers are temporarily unavailable',
    body: 'You can still search the public-record archive directly.',
    icon: <Sparkles className="size-5" />,
  },
  timeout: {
    title: 'The archive took too long to respond',
    body: 'Please try again. Large documents can take longer to load.',
    icon: <TriangleAlert className="size-5" />,
  },
};

export function DataErrorState({ error, onRetry, className, what }: { error: unknown; onRetry?: () => void; className?: string; what?: string }) {
  const kind = isDataError(error) ? error.kind : 'server';
  const m = MESSAGES[kind] ?? {
    title: `Something went wrong${what ? ` loading ${what}` : ''}`,
    body: 'An unexpected error occurred. Please try again.',
    icon: <TriangleAlert className="size-5" />,
  };
  return (
    <div role="alert" className={className}>
      <EmptyState icon={m.icon} title={m.title} action={onRetry && kind !== 'not_found' ? <Button onClick={onRetry}>Try again</Button> : undefined}>
        {m.body}
      </EmptyState>
    </div>
  );
}

export function InlineNotice({ tone = 'info', icon, children, className }: { tone?: 'info' | 'warn' | 'demo' | 'danger'; icon?: ReactNode; children: ReactNode; className?: string }) {
  const tones = {
    info: 'border-accent/20 bg-accent-soft text-accent-ink',
    warn: 'border-warn/25 bg-warn-soft text-warn',
    demo: 'border-demo/25 bg-demo-soft text-demo',
    danger: 'border-danger/25 bg-danger-soft text-danger',
  };
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13.5px] leading-relaxed', tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
