import { Link, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { MeetingRow } from '@/components/meetings/MeetingRow';
import { ResultCard } from '@/components/documents/ResultCard';
import { DemoBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { ResultSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { DataErrorState } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { BrowseService, DocumentService, MeetingService } from '@/services';
import { formatDate, formatNumber } from '@/lib/format';
import { searchPath } from '@/lib/searchParams';

export default function BodyPage() {
  const { bodyId = '' } = useParams();
  const body = useResource(`body:${bodyId}`, () => BrowseService.body(bodyId));
  const meetings = useResource(`body-meetings:${bodyId}`, () => MeetingService.list({ governmentBodyId: bodyId, pageSize: 5 }));
  const docs = useResource(`body-docs:${bodyId}`, () => DocumentService.list({ filters: { governmentBodyIds: [bodyId] }, pageSize: 5, sort: 'date_desc' }));
  useDocumentTitle(body.data?.name ?? 'Public body');
  const b = body.data;

  if (body.error != null)
    return (
      <div className="container-page py-16">
        <DataErrorState error={body.error} onRetry={body.reload} what="this public body" />
      </div>
    );

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Public body {b?.isDemo && <DemoBadge />}
          </span>
        }
        title={b?.name ?? <Skeleton className="h-9 w-72" />}
        description={b?.description}
        actions={
          b && (
            <ButtonLink to={searchPath({ query: '', filters: { governmentBodyIds: [b.id] } })} icon={<Search className="size-4" />}>
              Search this body’s records
            </ButtonLink>
          )
        }
      >
        {b && (
          <dl className="mt-6 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ['Meetings', formatNumber(b.meetingCount)],
              ['Documents', formatNumber(b.documentCount)],
              ['First record', formatDate(b.firstRecordDate, 'medium')],
              ['Latest record', formatDate(b.lastRecordDate, 'medium')],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-subtle">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </PageHeader>
      <div className="container-page grid gap-10 py-8 lg:grid-cols-2">
        <section aria-labelledby="bm-h">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="bm-h" className="font-serif text-xl font-semibold">
              Meetings
            </h2>
            <Link to={`/meetings?body=${encodeURIComponent(bodyId)}`} className="text-sm font-medium text-accent hover:underline">
              All meetings
            </Link>
          </div>
          {meetings.loading && <Skeleton className="h-40" />}
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {meetings.data?.items.map((m) => (
              <li key={m.id}>
                <MeetingRow m={m} />
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="bd-h">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="bd-h" className="font-serif text-xl font-semibold">
              Recent records
            </h2>
            <Link to={searchPath({ query: '', filters: { governmentBodyIds: [bodyId] } })} className="text-sm font-medium text-accent hover:underline">
              All records
            </Link>
          </div>
          {docs.loading && <ResultSkeleton count={3} />}
          <div className="space-y-3">{docs.data?.items.map((d) => <ResultCard key={d.id} doc={d} />)}</div>
        </section>
      </div>
    </>
  );
}
