import { useSearchParams } from 'react-router-dom';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { PageHeader } from '@/components/layout/PageHeader';
import { Pagination } from '@/components/ui/Pagination';
import { Skeleton } from '@/components/ui/Skeleton';
import { DataErrorState, EmptyState } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { BrowseService, MeetingService } from '@/services';
import { cn } from '@/lib/cn';

export default function MeetingsPage() {
  useDocumentTitle('Meetings');
  const [params, setParams] = useSearchParams();
  const body = params.get('body') ?? '';
  const year = Number(params.get('year')) || undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const bodies = useResource('bodies', BrowseService.bodies);
  const list = useResource(`meetings:${body}:${year}:${page}`, () => MeetingService.list({ governmentBodyId: body || undefined, year, page, pageSize: 20 }));
  const shown = list.data ?? (list.loading ? list.previous : undefined);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (k !== 'page') p.delete('page');
    setParams(p);
  };

  return (
    <>
      <PageHeader eyebrow="Public meetings" title="Meetings" description="Agendas, packets, minutes, recordings, and every agenda item — organized by meeting." />
      <div className="container-page py-8">
        <div className="mb-5 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-subtle">
            Body
            <select value={body} onChange={(e) => set('body', e.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-fg">
              <option value="">All public bodies</option>
              {bodies.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-subtle">
            Year
            <select value={year ?? ''} onChange={(e) => set('year', e.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm text-fg">
              <option value="">All years</option>
              {[2026, 2025, 2024].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>
        {list.error != null && <DataErrorState error={list.error} onRetry={list.reload} what="meetings" />}
        {!shown && list.loading && (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        )}
        {shown && shown.total === 0 && <EmptyState title="No meetings match these filters" />}
        {shown && shown.total > 0 && (
          <>
            <ul className={cn('divide-y divide-line rounded-xl border border-line bg-surface', list.loading && 'opacity-60')}>
              {shown.items.map((m) => (
                <li key={m.id}>
                  <MeetingRow m={m} />
                </li>
              ))}
            </ul>
            <Pagination page={shown.page} pageSize={shown.pageSize} total={shown.total} onPage={(p) => set('page', String(p))} />
          </>
        )}
      </div>
    </>
  );
}
