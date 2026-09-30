import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Compass, Search } from 'lucide-react';
import type { SourceRegistryEntry } from '@/types/models';
import { config } from '@/config/env';
import { DataError } from '@/data/adapters/errors';
import { PageHeader } from '@/components/layout/PageHeader';
import { SourceHealthBadge } from '@/components/archive/SourceHealthBadge';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { ExternalLink } from '@/components/ui/ExternalLink';
import { Skeleton } from '@/components/ui/Skeleton';
import { DataErrorState } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { SourceService } from '@/services';
import { SOURCE_TYPE_LABELS } from '@/lib/labels';
import { formatDateTime, formatNumber } from '@/lib/format';
import { searchPath } from '@/lib/searchParams';
import { cn } from '@/lib/cn';

function Flag({ on, label }: { on: boolean; label: string }) {
  return <Badge tone={on ? 'accent' : 'neutral'}>{`${label}: ${on ? 'on' : 'off'}`}</Badge>;
}

function SourceDetail({ s }: { s: SourceRegistryEntry }) {
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-serif text-xl font-semibold">{s.name}</h2>
        {s.isDemo && <DemoBadge />}
        <SourceHealthBadge status={s.health?.status ?? 'unknown'} />
      </div>
      <p className="mt-1 text-sm text-subtle">
        {SOURCE_TYPE_LABELS[s.sourceType]} · {s.authority}
      </p>
      {s.description && <p className="mt-3 text-[15px] leading-relaxed text-muted">{s.description}</p>}
      <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-subtle">Base URL</dt>
          <dd className="break-all">
            {s.baseUrl ? (
              <ExternalLink href={s.baseUrl} className="link">
                {s.baseUrl}
              </ExternalLink>
            ) : (
              <span className="text-muted">Not yet discovered</span>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-subtle">Discovered from</dt>
          <dd className="break-all">{s.discoveredFrom ? <ExternalLink href={s.discoveredFrom} className="link">{s.discoveredFrom}</ExternalLink> : 'Configured seed'}</dd>
        </div>
        <div>
          <dt className="text-subtle">Last checked</dt>
          <dd>{formatDateTime(s.health?.lastCheckedAt ?? s.lastChecked)}</dd>
        </div>
        <div>
          <dt className="text-subtle">Last successful check</dt>
          <dd>{formatDateTime(s.health?.lastSuccessfulCheckAt)}</dd>
        </div>
        <div>
          <dt className="text-subtle">Documents from this source</dt>
          <dd>{s.documentCount != null ? formatNumber(s.documentCount) : 'Not yet ingested'}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Flag on={s.crawlEnabled} label="Crawl" />
        <Flag on={s.archiveEnabled} label="Archive" />
        <Flag on={s.documentDiscoveryEnabled} label="Document discovery" />
      </div>
      {(s.notes || s.health?.message) && <p className="mt-4 rounded-lg bg-raised p-3 text-[13px] text-muted">{s.health?.message ? `${s.health.message} ` : ''}{s.notes}</p>}
      {(s.documentCount ?? 0) > 0 && (
        <ButtonLink className="mt-5" size="sm" to={searchPath({ query: '', filters: { sourceIds: [s.id] } })} icon={<Search className="size-4" />}>
          Records from this source
        </ButtonLink>
      )}
    </div>
  );
}

export default function SourcesPage() {
  const { sourceId } = useParams();
  const { data, error, loading, reload } = useResource('sources', SourceService.list);
  const selected = sourceId ? data?.find((s) => s.id === sourceId) : undefined;
  useDocumentTitle(selected?.name ?? 'Record sources');

  return (
    <>
      <PageHeader
        eyebrow="Provenance"
        title="Where records come from"
        description="Every record in the archive keeps its provenance: the public system that published it, the original URL, and when it was retrieved and last verified."
      />
      <div className="container-page grid gap-8 py-8 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <section className="card border-accent/30 bg-accent-soft/40 p-5" aria-labelledby="seed-h">
            <h2 id="seed-h" className="flex items-center gap-2 text-sm font-semibold">
              <Compass className="size-4 text-accent" aria-hidden /> Primary discovery seed
            </h2>
            <p className="mt-1.5 break-all text-sm">
              <ExternalLink href={config.primarySourceSeed} className="link">
                {config.primarySourceSeed}
              </ExternalLink>
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Source discovery starts at Vineyard City’s official transparency page and inspects every link on it. It follows only documents linked from approved pages,
              public-record systems in the source registry, and their relevant child pages — never social media, advertising, or unrelated sites. New systems are reviewed
              before they are added.
            </p>
          </section>

          {error != null && <DataErrorState error={error} onRetry={reload} what="sources" />}
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface" aria-label="Source registry">
            {loading &&
              [0, 1, 2, 3].map((i) => (
                <li key={i} className="p-4">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </li>
              ))}
            {data?.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/sources/${encodeURIComponent(s.id)}`}
                  aria-current={selected?.id === s.id ? 'true' : undefined}
                  className={cn('flex items-start justify-between gap-3 p-4 hover:bg-raised', selected?.id === s.id && 'bg-accent-soft/50')}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">
                      {s.name}
                      {s.isDemo && <DemoBadge />}
                    </span>
                    <span className="mt-0.5 block text-xs text-subtle">
                      {SOURCE_TYPE_LABELS[s.sourceType]} · {s.authority}
                    </span>
                  </span>
                  <SourceHealthBadge status={s.health?.status ?? 'unknown'} />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          {sourceId && data && !selected && <DataErrorState error={new DataError('not_found', 'Source not found.')} />}
          {selected ? (
            <>
              <Link to="/sources" className="mb-3 inline-flex items-center gap-1 text-sm text-subtle hover:text-fg lg:hidden">
                <ArrowLeft className="size-3.5" /> All sources
              </Link>
              <SourceDetail s={selected} />
            </>
          ) : (
            !sourceId && (
              <div className="card p-6 text-sm leading-relaxed text-muted">
                <h2 className="text-base font-semibold text-fg">How sources are handled</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5">
                  <li>Links are discovered semantically — by file type, URL patterns, content type, and source-specific adapters — not by a single brittle page selector.</li>
                  <li>URLs are normalized and redirects are recorded, so the same file found on two systems becomes one canonical record with both sources preserved.</li>
                  <li>Each source is health-checked: active, degraded, unreachable, changed, authentication required, or blocked.</li>
                  <li>Where a document may lawfully be archived, the original file, its SHA-256 checksum, and its retrieval date are preserved alongside the original URL.</li>
                </ul>
                <p className="mt-4">Select a source to see its details.</p>
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}
