import { Link } from 'react-router-dom';
import type { ArchiveStatistics } from '@/types/models';
import { DemoBadge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useResource } from '@/hooks/useResource';
import { StatisticsService } from '@/services';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-fg">{value}</dd>
      {sub && <dd className="text-xs text-subtle">{sub}</dd>}
    </div>
  );
}

export function ArchiveStatusView({ stats, variant = 'full' }: { stats: ArchiveStatistics; variant?: 'full' | 'compact' }) {
  const range =
    stats.earliestRecordDate && stats.latestRecordDate
      ? `${formatDate(stats.earliestRecordDate, 'medium')} – ${formatDate(stats.latestRecordDate, 'medium')}`
      : 'No records yet';
  return (
    <section aria-label="Archive status" className={cn(variant === 'compact' ? '' : 'card p-5')}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="eyebrow">Archive status</h2>
        {stats.isDemo && <DemoBadge label="Demo figures" />}
      </div>
      <dl className={cn('grid gap-4', variant === 'compact' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 lg:grid-cols-4')}>
        <Stat label={stats.isDemo ? 'Demo documents indexed' : 'Documents indexed'} value={formatNumber(stats.documentsIndexed)} sub={stats.pagesIndexed != null ? `${formatNumber(stats.pagesIndexed)} pages` : undefined} />
        <Stat label="Date range" value={range} />
        <Stat label="Archive last updated" value={formatDateTime(stats.archiveLastUpdatedAt)} />
        <Stat label="Sources monitored" value={formatNumber(stats.sourcesMonitored)} sub={stats.sourcesHealthy != null ? `${stats.sourcesHealthy} verified healthy` : undefined} />
      </dl>
      {stats.isDemo && variant === 'full' && (
        <p className="mt-4 text-xs text-subtle">
          These figures describe the bundled demo dataset, not the production archive. Real figures appear once the archive is connected.{' '}
          <Link to="/status" className="link">
            Archive status
          </Link>
        </p>
      )}
    </section>
  );
}

export function ArchiveStatus({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  const { data, error } = useResource('stats', StatisticsService.stats);
  if (error) return null;
  if (!data)
    return (
      <div className={cn(variant === 'full' && 'card p-5')} role="status" aria-label="Loading archive status">
        <Skeleton className="h-3 w-28" />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      </div>
    );
  return <ArchiveStatusView stats={data} variant={variant} />;
}
