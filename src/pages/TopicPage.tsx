import { useParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Timeline } from '@/components/timeline/Timeline';
import { CompactDocLink } from '@/components/documents/ResultCard';
import { DemoBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { DataErrorState } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { BrowseService, DocumentService } from '@/services';
import { askPath } from '@/lib/searchParams';

export default function TopicPage() {
  const { topicId = '' } = useParams();
  const topic = useResource(`topic:${topicId}`, () => BrowseService.topic(topicId));
  const t = topic.data;
  const evidenceIds = t ? [...new Set([...t.documentIds, ...t.timeline.flatMap((e) => e.evidence.map((x) => x.documentId))])] : [];
  const docs = useResource(t ? `topic-docs:${t.id}` : null, () => DocumentService.byIds(evidenceIds));
  useDocumentTitle(t?.name ?? 'Topic');

  if (topic.error != null)
    return (
      <div className="container-page py-16">
        <DataErrorState error={topic.error} onRetry={topic.reload} what="this topic" />
      </div>
    );

  const docMap = new Map(docs.data?.map((d) => [d.id, d]));
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            {t?.kind ?? 'Topic'} timeline {t?.isDemo && <DemoBadge />}
          </span>
        }
        title={t?.name ?? <Skeleton className="h-9 w-80" />}
        description={t?.description}
        actions={
          t && (
            <ButtonLink to={askPath(`What happened with ${t.name.replace(/\s*\(.*\)$/, '')}?`)} icon={<Sparkles className="size-4" />}>
              Ask about this
            </ButtonLink>
          )
        }
      />
      <div className="container-page grid gap-10 py-10 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="tl-h" className="min-w-0">
          <h2 id="tl-h" className="eyebrow mb-5">
            What happened, in order
          </h2>
          {!t ? <SkeletonText lines={10} /> : <Timeline events={t.timeline} documents={docMap} />}
        </section>
        <aside>
          <section className="card p-4" aria-labelledby="ev-h">
            <h2 id="ev-h" className="eyebrow mb-2 px-1">
              Records ({evidenceIds.length})
            </h2>
            <div className="-mx-1">
              {docs.loading && <SkeletonText lines={6} className="px-1" />}
              {docs.data?.map((d) => <CompactDocLink key={d.id} doc={d} />)}
            </div>
          </section>
          <p className="mt-3 px-1 text-xs text-subtle">Every event in a timeline must link to the record that establishes it. Events without evidence are never shown.</p>
        </aside>
      </div>
    </>
  );
}
