import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4', className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}

export function ResultSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading results" className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card p-5">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-28" />
          </div>
          <Skeleton className="mt-3 h-5 w-4/5" />
          <SkeletonText className="mt-4" lines={2} />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
