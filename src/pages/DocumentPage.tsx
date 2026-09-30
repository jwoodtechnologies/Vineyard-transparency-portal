import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  BookmarkCheck,
  BookmarkPlus,
  CalendarDays,
  ChevronRight,
  Download,
  ExternalLink as ExternalIcon,
  FileWarning,
  Flag,
  History,
  Info,
  Link2Off,
  ScanText,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { DocumentDetail, DocumentRelationship, DocumentSource, DocumentVersion } from '@/types/models';
import { useApp } from '@/app/AppContext';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CopyLinkButton } from '@/components/ui/CopyButton';
import { copyText } from '@/lib/clipboard';
import { ExternalLink } from '@/components/ui/ExternalLink';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { DataErrorState, EmptyState, InlineNotice } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { CompactDocLink, CurrencyBadge } from '@/components/documents/ResultCard';
import { DocTypeIcon } from '@/components/documents/DocTypeIcon';
import { TextViewer } from '@/components/documents/TextViewer';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSavedToggle } from '@/hooks/useLibrary';
import { useResource } from '@/hooks/useResource';
import { DocumentService } from '@/services';
import { CURRENCY_LABELS, RELATIONSHIP_LABELS, SOURCE_TYPE_LABELS, documentTypeLabel } from '@/lib/labels';
import { formatBytes, formatDate, formatDateTime, formatTime } from '@/lib/format';
import { cleanText, displayHost, safeFileName, safeUrl } from '@/lib/safety';
import { parseQuery } from '@/lib/text';
import { searchPath } from '@/lib/searchParams';
import { cn } from '@/lib/cn';

const PdfViewer = lazy(() => import('@/components/documents/PdfViewer'));

export default function DocumentPage() {
  const { documentId = '' } = useParams();
  const { data: doc, error, loading, reload } = useResource(`doc:${documentId}`, () => DocumentService.get(documentId));
  useDocumentTitle(doc ? cleanText(doc.title) : loading ? 'Loading document' : 'Document');

  if (error != null) {
    return (
      <div className="container-page py-16">
        <DataErrorState error={error} onRetry={reload} what="this document" />
        <p className="mt-6 text-center text-sm">
          <Link to="/documents" className="link">
            Browse all documents
          </Link>
        </p>
      </div>
    );
  }
  if (!doc) return <DocumentSkeleton />;
  return <DocumentView key={doc.id} doc={doc} />;
}

function DocumentSkeleton() {
  return (
    <div className="container-wide py-8" role="status" aria-label="Loading document">
      <Skeleton className="h-3 w-48" />
      <Skeleton className="mt-4 h-8 w-3/4" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-[70vh]" />
        <div className="card p-5">
          <SkeletonText lines={8} />
        </div>
      </div>
    </div>
  );
}

function DocumentView({ doc }: { doc: DocumentDetail }) {
  const [params, setParams] = useSearchParams();
  const { openReport } = useApp();
  const toast = useToast();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = (params.get('q') ?? '').slice(0, 200);
  const highlightTerms = q ? [...parseQuery(q).terms, ...parseQuery(q).phrases] : [];
  const archiveUrl = safeUrl(doc.archiveUrl);
  const originalUrl = safeUrl(doc.originalUrl);
  const isPdf = doc.mimeType === 'application/pdf';
  const [viewerFailed, setViewerFailed] = useState(false);
  const [view, setView] = useState<'document' | 'text'>(archiveUrl && isPdf ? 'document' : 'text');
  const text = useResource(view === 'text' || !archiveUrl || !isPdf || viewerFailed ? `text:${doc.id}` : null, () => DocumentService.text(doc.id));
  const primarySource = doc.sources[0];
  const supersededBy = doc.relationships.find((r) => r.relationshipType === 'SUPERSEDED_BY');
  const shareUrl = `${window.location.origin}/documents/${encodeURIComponent(doc.id)}`;
  const { isSaved, toggle } = useSavedToggle('document', doc.id, () => ({
    title: doc.title,
    path: `/documents/${encodeURIComponent(doc.id)}`,
    subtitle: `${documentTypeLabel(doc.documentType)} · ${formatDate(doc.date, 'medium')}`,
  }));

  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    if (p > 1) next.set('page', String(p));
    else next.delete('page');
    setParams(next, { replace: true });
  };

  const fileName = safeFileName(doc.fileName, `${doc.id}.pdf`);

  return (
    <div className="flex flex-1 flex-col">
      {/* ------------------------------------------------------------ Header */}
      <div className="border-b border-line bg-surface">
        <div className="container-wide py-6">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[13px] text-subtle">
            <Link to="/documents" className="hover:text-fg">
              Documents
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <Link to={searchPath({ query: '', filters: { documentTypes: [doc.documentType] } })} className="hover:text-fg">
              {documentTypeLabel(doc.documentType)}
            </Link>
            {doc.year && (
              <>
                <ChevronRight className="size-3.5" aria-hidden />
                <Link to={searchPath({ query: '', filters: { documentTypes: [doc.documentType], years: [doc.year] } })} className="hover:text-fg">
                  {doc.year}
                </Link>
              </>
            )}
          </nav>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {doc.isDemo && <DemoBadge label="Demo document — not a government record" />}
            <CurrencyBadge currency={doc.currency} />
            {doc.ocrRequired && (
              <Badge tone="warn" icon={<ScanText className="size-3" aria-hidden />}>
                OCR text
              </Badge>
            )}
            {doc.versions.length > 1 && (
              <Badge tone="accent" icon={<History className="size-3" aria-hidden />}>
                Version {doc.currentVersion} of {doc.versions.length}
              </Badge>
            )}
          </div>
          <h1 className="mt-2 max-w-5xl font-serif text-[1.55rem] font-semibold leading-tight tracking-[-0.01em] sm:text-[2rem]">{cleanText(doc.title)}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5 font-medium text-fg">
              <DocTypeIcon type={doc.documentType} />
              {documentTypeLabel(doc.documentType)}
            </span>
            {doc.documentNumber && <span className="font-mono text-[13px]">{cleanText(doc.documentNumber)}</span>}
            <time dateTime={doc.date ?? undefined}>{formatDate(doc.date)}</time>
            {doc.governmentBody && (
              <Link to={`/bodies/${encodeURIComponent(doc.governmentBody.id)}`} className="hover:text-accent">
                {doc.governmentBody.name}
              </Link>
            )}
            {doc.meeting && (
              <Link to={`/meetings/${encodeURIComponent(doc.meeting.id)}`} className="inline-flex items-center gap-1 hover:text-accent">
                <CalendarDays className="size-3.5" aria-hidden />
                {doc.meeting.title}, {formatDate(doc.meeting.date, 'medium')}
                {doc.agendaItem ? ` · Item ${doc.agendaItem.number}` : ''}
              </Link>
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-wrap gap-2">
            {archiveUrl ? (
              <a
                href={archiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
              >
                <Archive className="size-4" aria-hidden />
                Open archived document
              </a>
            ) : (
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-line-strong px-3.5 text-sm text-subtle">
                <FileWarning className="size-4" aria-hidden /> Archived copy unavailable
              </span>
            )}
            {originalUrl && (
              <a
                href={originalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-raised"
              >
                <ExternalIcon className="size-4" aria-hidden />
                Original source
                {primarySource?.originalAvailable === false && <span className="text-xs font-normal text-warn">(no longer available)</span>}
              </a>
            )}
            {archiveUrl && (
              <a href={archiveUrl} download={fileName} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-raised">
                <Download className="size-4" aria-hidden />
                Download
              </a>
            )}
            <CopyLinkButton size="sm" url={shareUrl} className="h-9" />
            <Button
              size="sm"
              className="h-9"
              aria-pressed={isSaved}
              icon={isSaved ? <BookmarkCheck className="size-4 text-accent" /> : <BookmarkPlus className="size-4" />}
              onClick={async () => toast((await toggle()) ? 'Saved on this device' : 'Removed from this device')}
            >
              {isSaved ? 'Saved on this device' : 'Save on this device'}
            </Button>
            <Button size="sm" variant="ghost" className="h-9" icon={<Flag className="size-4" />} onClick={() => openReport({ context: { documentId: doc.id }, subject: doc.title })}>
              Report issue
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {doc.currency === 'superseded' && (
              <InlineNotice tone="warn" icon={<TriangleAlert className="size-4" />}>
                <strong>Superseded record.</strong> This is historical language and is not current law or policy.
                {supersededBy && (
                  <>
                    {' '}
                    See{' '}
                    <Link to={`/documents/${encodeURIComponent(supersededBy.toId)}`} className="font-medium underline">
                      {cleanText(supersededBy.toTitle)}
                    </Link>
                    .
                  </>
                )}
              </InlineNotice>
            )}
            {doc.ocrRequired && (
              <InlineNotice tone="info" icon={<ScanText className="size-4" />}>
                This record is a scan. Its searchable text was produced by OCR
                {doc.ocrConfidence != null ? ` (mean confidence ${Math.round(doc.ocrConfidence * 100)}%)` : ''} and may contain recognition errors. The page image is the
                authoritative version.
              </InlineNotice>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ Body */}
      <div className="container-wide grid flex-1 gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Document" className="card flex min-h-[70vh] min-w-0 flex-col overflow-hidden lg:sticky lg:top-20 lg:h-[calc(100dvh-6rem)]">
          <Tabs
            label="Document view"
            value={view}
            onChange={(v) => setView(v as 'document' | 'text')}
            tabs={[...(archiveUrl && isPdf && !viewerFailed ? [{ id: 'document', label: 'Document' }] : []), { id: 'text', label: 'Extracted text' }]}
            className="flex min-h-0 flex-1 flex-col [&>[role=tablist]]:px-2"
          >
            {(_active, panelProps) => (
          <div {...panelProps} tabIndex={-1} className="min-h-0 flex-1 overflow-auto">
            {view === 'document' && archiveUrl && isPdf && !viewerFailed ? (
              <Suspense fallback={<Skeleton className="m-4 h-[60vh]" />}>
                <PdfViewer
                  url={archiveUrl}
                  page={page}
                  onPageChange={setPage}
                  title={doc.title}
                  highlight={highlightTerms}
                  onError={() => {
                    setViewerFailed(true);
                    setView('text');
                  }}
                />
              </Suspense>
            ) : (
              <div>
                {viewerFailed && (
                  <InlineNotice tone="warn" className="m-4" icon={<FileWarning className="size-4" />}>
                    The archived file could not be displayed. Showing the extracted text instead.
                    {originalUrl && (
                      <>
                        {' '}
                        You can also try the{' '}
                        <a href={originalUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                          original source
                        </a>
                        .
                      </>
                    )}
                  </InlineNotice>
                )}
                {!archiveUrl && (
                  <InlineNotice tone="info" className="m-4" icon={<Info className="size-4" />}>
                    No archived copy of this record is stored — only its extracted text and a link to the original source.
                  </InlineNotice>
                )}
                {text.error != null && <DataErrorState className="m-4" error={text.error} onRetry={text.reload} what="the extracted text" />}
                {text.loading && (
                  <div className="p-6">
                    <SkeletonText lines={10} />
                  </div>
                )}
                {text.data && (text.data.length ? <TextViewer pages={text.data} currentPage={page} onPageChange={setPage} query={q} ocrConfidence={doc.ocrConfidence} /> : <EmptyState title="No extracted text" className="m-4" />)}
              </div>
            )}
          </div>
            )}
          </Tabs>
        </section>

        <aside aria-label="Record details" className="min-w-0">
          <DetailsSidebar doc={doc} onCopyChecksum={async () => toast((await copyText(doc.checksum ?? '')) ? 'Checksum copied' : 'Could not copy', 'ok')} />
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
      <dt className="text-subtle">{label}</dt>
      <dd className={cn('min-w-0 break-words text-fg', mono && 'font-mono text-[12.5px]')}>{children}</dd>
    </div>
  );
}

function DetailsSidebar({ doc, onCopyChecksum }: { doc: DocumentDetail; onCopyChecksum: () => void }) {
  const [tab, setTab] = useState('details');
  const related = useResource(tab === 'related' ? `related:${doc.id}` : null, () => DocumentService.related(doc.id));
  return (
    <div className="card overflow-hidden">
      <Tabs
        label="Record information"
        value={tab}
        onChange={setTab}
        className="[&>[role=tablist]]:px-2"
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'provenance', label: 'Provenance', count: doc.sources.length },
          { id: 'versions', label: 'Versions', count: doc.versions.length },
          { id: 'related', label: 'Related', count: doc.relationships.length || null },
        ]}
      >
        {(active, panelProps) => (
          <div {...panelProps} className="px-5 py-3 focus-visible:outline-offset-[-2px]">
            {active === 'details' && <DetailsPanel doc={doc} onCopyChecksum={onCopyChecksum} />}
            {active === 'provenance' && <ProvenancePanel doc={doc} />}
            {active === 'versions' && <VersionsPanel versions={doc.versions} current={doc.currentVersion} />}
            {active === 'related' && (
              <RelatedPanel relationships={doc.relationships} loading={related.loading} related={related.data ?? []} error={related.error} />
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
}

function DetailsPanel({ doc, onCopyChecksum }: { doc: DocumentDetail; onCopyChecksum: () => void }) {
  return (
    <>
      {doc.description && <p className="border-b border-line pb-3 pt-1 text-sm text-muted">{cleanText(doc.description)}</p>}
      <dl className="divide-y divide-line">
        <Field label="Document type">{documentTypeLabel(doc.documentType)}</Field>
        {doc.documentNumber && (
          <Field label="Record number" mono>
            {cleanText(doc.documentNumber)}
          </Field>
        )}
        <Field label="Date">{formatDate(doc.date)}</Field>
        <Field label="Status">{CURRENCY_LABELS[doc.currency]}</Field>
        {doc.governmentBody && (
          <Field label="Public body">
            <Link to={`/bodies/${encodeURIComponent(doc.governmentBody.id)}`} className="link">
              {doc.governmentBody.name}
            </Link>
          </Field>
        )}
        {doc.meeting && (
          <Field label="Meeting">
            <Link to={`/meetings/${encodeURIComponent(doc.meeting.id)}`} className="link">
              {doc.meeting.title}
            </Link>
            <span className="block text-xs text-subtle">
              {formatDate(doc.meeting.date)}
              {doc.meeting.startTime ? `, ${formatTime(doc.meeting.startTime)}` : ''}
            </span>
          </Field>
        )}
        {doc.agendaItem && (
          <Field label="Agenda item">
            Item {doc.agendaItem.number}: {cleanText(doc.agendaItem.title)}
          </Field>
        )}
        <Field label="Pages">{doc.pageCount ?? 'Unknown'}</Field>
        <Field label="File name" mono>
          {safeFileName(doc.fileName)}
        </Field>
        <Field label="File size">{formatBytes(doc.fileSize)}</Field>
        <Field label="Format">{doc.mimeType}</Field>
        <Field label="SHA-256" mono>
          {doc.checksum ? (
            <button onClick={onCopyChecksum} className="break-all text-left hover:text-accent" title="Copy checksum">
              {doc.checksum}
            </button>
          ) : (
            <span className="font-sans text-subtle">Not recorded</span>
          )}
        </Field>
        <Field label="Archived">{doc.archivedAt ? formatDateTime(doc.archivedAt) : 'Not archived'}</Field>
        <Field label="Extracted text">{doc.extractedTextAvailable ? 'Available' : 'Not available'}</Field>
        <Field label="OCR">
          {doc.ocrStatus === 'not_required' ? 'Not required (digital text)' : `${doc.ocrStatus}${doc.ocrConfidence != null ? ` · ${Math.round(doc.ocrConfidence * 100)}% confidence` : ''}`}
        </Field>
      </dl>
      {(doc.tags.length > 0 || doc.entities.length > 0) && (
        <div className="border-t border-line py-3">
          <h3 className="eyebrow mb-2">Subjects</h3>
          <ul className="flex flex-wrap gap-1.5">
            {[...doc.entities.map((e) => e.name), ...doc.tags].filter((v, i, a) => a.indexOf(v) === i).slice(0, 16).map((t) => (
              <li key={t}>
                <Link to={searchPath({ query: `"${t}"` })} className="inline-flex rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent">
                  {cleanText(t)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ProvenancePanel({ doc }: { doc: DocumentDetail }) {
  return (
    <div className="space-y-4 py-2">
      <div className="rounded-lg border border-line bg-raised/50 p-3.5 text-[13px] leading-relaxed text-muted">
        <p className="flex items-center gap-1.5 font-semibold text-fg">
          <ShieldCheck className="size-4 text-accent" aria-hidden /> Archived copy vs. original source
        </p>
        <p className="mt-1">
          The <strong>archived copy</strong> is a file this portal retrieved and preserved, identified by its SHA-256 checksum. It is not a certified copy. The{' '}
          <strong>original source</strong> is the government system that published it and remains the authority.
        </p>
      </div>
      {doc.sources.map((s) => (
        <SourceBlock key={s.id} s={s} />
      ))}
      <p className="text-xs text-subtle">
        <Link to="/sources" className="link">
          How sources are discovered and verified
        </Link>
      </p>
    </div>
  );
}

function SourceBlock({ s }: { s: DocumentSource }) {
  return (
    <div className="rounded-lg border border-line p-3.5">
      <p className="text-sm font-semibold">{s.name}</p>
      <p className="text-xs text-subtle">
        {SOURCE_TYPE_LABELS[s.sourceType]} · {s.authority}
      </p>
      <dl className="mt-2 space-y-1.5 text-[13px]">
        <div>
          <dt className="text-subtle">Original URL</dt>
          <dd className="break-all">
            <ExternalLink href={s.originalUrl} className="link">
              {displayHost(s.originalUrl) ? s.originalUrl.replace(/^https?:\/\//, '') : 'Unavailable'}
            </ExternalLink>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-subtle">Retrieved</dt>
          <dd>{formatDateTime(s.retrievedAt)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-subtle">Last verified</dt>
          <dd>{formatDateTime(s.lastVerifiedAt)}</dd>
        </div>
      </dl>
      {s.originalAvailable === false && (
        <InlineNotice tone="warn" className="mt-3" icon={<Link2Off className="size-4" />}>
          The original URL no longer resolves{s.httpStatusAtLastCheck ? ` (HTTP ${s.httpStatusAtLastCheck} at last check)` : ''}. The archived copy has been retained.
        </InlineNotice>
      )}
    </div>
  );
}

function VersionsPanel({ versions, current }: { versions: DocumentVersion[]; current: number }) {
  const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
  return (
    <div className="py-2">
      <p className="mb-3 text-[13px] text-muted">When a source replaces a file, the previous version is kept — never silently overwritten.</p>
      <ol className="space-y-2.5">
        {sorted.map((v) => {
          const url = safeUrl(v.archiveUrl);
          return (
            <li key={v.id} className={cn('rounded-lg border p-3.5', v.versionNumber === current ? 'border-accent/40 bg-accent-soft/40' : 'border-line')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">
                  Version {v.versionNumber}
                  {v.versionNumber === current && <span className="ml-1.5 text-xs font-medium text-accent">Current</span>}
                </span>
                <Badge tone={v.changeStatus === 'original' ? 'neutral' : 'accent'}>{v.changeStatus.replace(/_/g, ' ')}</Badge>
              </div>
              <p className="mt-1 text-xs text-subtle">Retrieved {formatDateTime(v.retrievedAt)}</p>
              <p className="mt-1 break-all font-mono text-[11.5px] text-muted">sha256 {v.checksum}</p>
              {v.note && <p className="mt-1.5 text-[13px] text-muted">{cleanText(v.note)}</p>}
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="link mt-1.5 inline-block text-xs">
                  Open this version
                </a>
              ) : (
                v.versionNumber !== current && <p className="mt-1.5 text-xs text-subtle">Archived file for this version is not available in demo mode.</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function relationshipHref(r: DocumentRelationship): string | null {
  if (r.toKind === 'document') return `/documents/${encodeURIComponent(r.toId)}`;
  if (r.toKind === 'meeting') return `/meetings/${encodeURIComponent(r.toId)}`;
  if (r.toKind === 'code_section') return `/code#${encodeURIComponent(r.toId)}`;
  return null;
}

function RelatedPanel({
  relationships,
  related,
  loading,
  error,
}: {
  relationships: DocumentRelationship[];
  related: Awaited<ReturnType<typeof DocumentService.related>>;
  loading: boolean;
  error: unknown;
}) {
  const explicitIds = new Set(relationships.map((r) => r.toId));
  return (
    <div className="space-y-5 py-2">
      {relationships.length > 0 && (
        <section>
          <h3 className="eyebrow mb-2">Linked records</h3>
          <ul className="space-y-1.5">
            {relationships.map((r) => {
              const href = relationshipHref(r);
              return (
                <li key={r.id} className="rounded-lg border border-line p-3">
                  <p className="text-[11.5px] font-semibold uppercase tracking-wide text-accent">{RELATIONSHIP_LABELS[r.relationshipType]}</p>
                  {href ? (
                    <Link to={href} className="mt-0.5 block text-sm font-medium hover:text-accent">
                      {cleanText(r.toTitle)}
                    </Link>
                  ) : (
                    <p className="mt-0.5 text-sm font-medium">{cleanText(r.toTitle)}</p>
                  )}
                  <p className="mt-0.5 text-xs text-subtle">
                    Basis: {r.basis.replace(/_/g, ' ')}
                    {r.evidence?.page ? ` · page ${r.evidence.page}` : ''}
                    {r.basis === 'ai_suggested' && ' · AI-suggested, unverified'}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section>
        <h3 className="eyebrow mb-1">More records</h3>
        {loading && <SkeletonText lines={4} className="mt-2" />}
        {error != null && <p className="text-sm text-subtle">Related records could not be loaded.</p>}
        {!loading && !error && (
          <div className="-mx-2">
            {related
              .filter((r) => !explicitIds.has(r.document.id))
              .map((r) => (
                <CompactDocLink key={r.document.id} doc={r.document} note={r.reason} />
              ))}
            {related.filter((r) => !explicitIds.has(r.document.id)).length === 0 && <p className="px-2 text-sm text-subtle">No other related records found.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
