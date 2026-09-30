import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, CalendarDays, FolderTree, Landmark, Library, Milestone, Rss, Tags } from 'lucide-react';
import type { FacetBucket } from '@/types/models';
import { PageHeader } from '@/components/layout/PageHeader';
import { DemoBadge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { DataErrorState } from '@/components/ui/States';
import { DocTypeIcon } from '@/components/documents/DocTypeIcon';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { BrowseService, MeetingService } from '@/services';
import { searchPath } from '@/lib/searchParams';
import { formatDate, formatNumber } from '@/lib/format';
import type { DocumentType } from '@/types/models';

const SECTIONS = [
  { id: 'year', label: 'By year', Icon: CalendarDays },
  { id: 'type', label: 'By document type', Icon: Library },
  { id: 'body', label: 'By public body', Icon: Building2 },
  { id: 'subject', label: 'By subject', Icon: Tags },
  { id: 'meeting', label: 'By meeting', Icon: CalendarDays },
  { id: 'source', label: 'By source', Icon: Rss },
  { id: 'topics', label: 'Projects & timelines', Icon: Milestone },
  { id: 'code', label: 'Municipal code', Icon: Landmark },
];

function Section({ id, title, description, children, action }: { id: string; title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-b border-line py-10 first:pt-0 last:border-b-0">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 id={`${id}-h`} className="font-serif text-xl font-semibold">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function BucketGrid({ buckets, href, icon, columns = 'sm:grid-cols-2 lg:grid-cols-3' }: { buckets: FacetBucket[]; href: (b: FacetBucket) => string; icon?: (b: FacetBucket) => ReactNode; columns?: string }) {
  return (
    <ul className={`grid gap-px overflow-hidden rounded-xl border border-line bg-line ${columns}`}>
      {buckets.map((b) => (
        <li key={b.value} className="bg-surface">
          <Link to={href(b)} className="group flex items-center gap-3 px-4 py-3 hover:bg-raised">
            {icon?.(b)}
            <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-accent">{b.label}</span>
            <span className="text-xs tabular-nums text-subtle">{formatNumber(b.count)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function BrowsePage() {
  useDocumentTitle('Browse');
  const facets = useResource('facets', BrowseService.facets);
  const bodies = useResource('bodies', BrowseService.bodies);
  const topics = useResource('topics', BrowseService.topics);
  const meetings = useResource('browse-meetings', () => MeetingService.list({ pageSize: 6 }));
  const f = facets.data;

  return (
    <>
      <PageHeader eyebrow="Archive" title="Browse" description="Explore the archive without a search term — by year, record type, public body, subject, meeting, or source." />
      <div className="container-page grid gap-10 py-10 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Browse sections" className="hidden lg:block">
          <ul className="sticky top-24 space-y-0.5">
            {SECTIONS.map(({ id, label, Icon }) => (
              <li key={id}>
                <a href={`#${id}`} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-raised hover:text-fg">
                  <Icon className="size-4 text-subtle" aria-hidden />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          {facets.error != null && <DataErrorState error={facets.error} onRetry={facets.reload} what="browse categories" />}
          {facets.loading && <Skeleton className="h-64" />}
          {f && (
            <>
              <Section id="year" title="By year">
                <BucketGrid
                  buckets={f.years}
                  columns="grid-cols-2 sm:grid-cols-4 lg:grid-cols-6"
                  href={(b) => searchPath({ query: '', filters: { years: [Number(b.value)] }, sort: 'date_desc' })}
                />
              </Section>
              <Section id="type" title="By document type">
                <BucketGrid
                  buckets={f.documentTypes}
                  href={(b) => searchPath({ query: '', filters: { documentTypes: [b.value as DocumentType] } })}
                  icon={(b) => (
                    <span className="flex size-7 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
                      <DocTypeIcon type={b.value as DocumentType} className="size-3.5" />
                    </span>
                  )}
                />
              </Section>
            </>
          )}
          <Section id="body" title="By public body" description="Public bodies come from the archive’s data, not a fixed list.">
            {bodies.loading && <Skeleton className="h-24" />}
            <ul className="grid gap-3 sm:grid-cols-2">
              {bodies.data?.map((b) => (
                <li key={b.id}>
                  <Link to={`/bodies/${encodeURIComponent(b.id)}`} className="card group flex h-full flex-col p-4 hover:border-accent">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold group-hover:text-accent">{b.name}</span>
                      {b.isDemo && <DemoBadge />}
                    </span>
                    <span className="mt-1 text-xs text-subtle">
                      {formatNumber(b.meetingCount)} meetings · {formatNumber(b.documentCount)} documents
                      {b.lastRecordDate ? ` · latest ${formatDate(b.lastRecordDate, 'medium')}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          {f && (
            <Section id="subject" title="By subject">
              <ul className="flex flex-wrap gap-2">
                {f.subjects.map((s) => (
                  <li key={s.value}>
                    <Link to={searchPath({ query: `"${s.value}"` })} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-accent hover:text-accent">
                      {s.label}
                      <span className="text-xs tabular-nums text-subtle">{s.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section
            id="meeting"
            title="By meeting"
            action={
              <Link to="/meetings" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                All meetings <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {meetings.data?.items.map((m) => (
                <li key={m.id}>
                  <Link to={`/meetings/${encodeURIComponent(m.id)}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-raised">
                    <span className="text-sm font-medium">{m.title}</span>
                    <span className="text-xs text-subtle">{formatDate(m.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          {f && (
            <Section
              id="source"
              title="By source"
              action={
                <Link to="/sources" className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Source registry <ArrowRight className="size-3.5" />
                </Link>
              }
            >
              <BucketGrid buckets={f.sources} columns="sm:grid-cols-2" href={(b) => searchPath({ query: '', filters: { sourceIds: [b.value] } })} />
            </Section>
          )}
          <Section id="topics" title="Projects & timelines" description="What happened, in order — with every step linked to the record that establishes it.">
            <ul className="grid gap-3 sm:grid-cols-2">
              {topics.data?.map((t) => (
                <li key={t.id}>
                  <Link to={`/topics/${encodeURIComponent(t.id)}`} className="card group flex h-full flex-col p-4 hover:border-accent">
                    <span className="flex items-center gap-2">
                      <FolderTree className="size-4 text-accent" aria-hidden />
                      <span className="font-semibold group-hover:text-accent">{t.name}</span>
                    </span>
                    <span className="mt-1 line-clamp-2 text-sm text-muted">{t.description}</span>
                    <span className="mt-2 text-xs text-subtle">{t.documentCount} linked records</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          <Section id="code" title="Municipal code">
            <Link to="/code" className="card group flex items-center gap-3 p-4 hover:border-accent">
              <Landmark className="size-5 text-accent" aria-hidden />
              <span>
                <span className="block font-semibold group-hover:text-accent">Browse the municipal code</span>
                <span className="block text-sm text-muted">Titles, chapters, and sections — with current and superseded language clearly labeled.</span>
              </span>
            </Link>
          </Section>
        </div>
      </div>
    </>
  );
}
