import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AudioLines, BookOpenText, CalendarDays, ClipboardList, Clock, FileCheck2, Flag, Gavel, MapPin, MessageSquareText, Search, Video } from 'lucide-react';
import type { AgendaItem, Meeting } from '@/types/models';
import { useApp } from '@/app/AppContext';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { CopyLinkButton } from '@/components/ui/CopyButton';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { DataErrorState, InlineNotice } from '@/components/ui/States';
import { CompactDocLink } from '@/components/documents/ResultCard';
import { docHref } from '@/lib/routes';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { DocumentService, MeetingService, SourceService } from '@/services';
import { formatDate, formatDuration, formatTime } from '@/lib/format';
import { searchPath } from '@/lib/searchParams';
import { cleanText } from '@/lib/safety';
import { cn } from '@/lib/cn';

const ITEM_TYPE: Record<AgendaItem['itemType'], string> = {
  consent: 'Consent',
  business: 'Business',
  public_hearing: 'Public hearing',
  presentation: 'Presentation',
  discussion: 'Discussion',
  report: 'Report',
  closed_session: 'Closed session',
  other: 'Procedural',
};

const OUTCOME_TONE = { approved: 'ok', denied: 'danger', failed: 'danger', tabled: 'warn', continued: 'warn', withdrawn: 'neutral', unknown: 'neutral' } as const;

function RecordTile({ icon, label, status, to, href }: { icon: ReactNode; label: string; status: string; to?: string | null; href?: string | null }) {
  const inner = (
    <>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', to || href ? 'bg-accent-soft text-accent-ink' : 'bg-raised text-subtle')}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-subtle">{status}</span>
      </span>
    </>
  );
  const cls = 'flex items-center gap-3 rounded-xl border p-3.5 transition-colors';
  if (to)
    return (
      <Link to={to} className={cn(cls, 'border-line bg-surface hover:border-accent')}>
        {inner}
      </Link>
    );
  return <div className={cn(cls, 'border-dashed border-line-strong text-subtle')}>{inner}</div>;
}

export default function MeetingPage() {
  const { meetingId = '' } = useParams();
  const { data: m, error, reload } = useResource(`meeting:${meetingId}`, () => MeetingService.get(meetingId));
  useDocumentTitle(m ? `${m.title}, ${formatDate(m.date)}` : 'Meeting');
  if (error != null)
    return (
      <div className="container-page py-16">
        <DataErrorState error={error} onRetry={reload} what="this meeting" />
      </div>
    );
  if (!m)
    return (
      <div className="container-page py-10" role="status" aria-label="Loading meeting">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-3 h-4 w-1/3" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <SkeletonText lines={8} className="mt-8" />
      </div>
    );
  return <MeetingView m={m} />;
}

function MeetingView({ m }: { m: Meeting }) {
  const { openReport } = useApp();
  const allDocIds = [...new Set(m.agendaItems.flatMap((i) => i.documentIds))];
  const docs = useResource(`meeting-docs:${m.id}`, () => DocumentService.byIds(allDocIds));
  const sources = useResource('sources', SourceService.list);
  const docMap = new Map(docs.data?.map((d) => [d.id, d]));
  const video = m.media.find((x) => x.kind === 'video');
  const audio = m.media.find((x) => x.kind === 'audio');
  const transcript = m.media.find((x) => x.kind === 'transcript');

  return (
    <div>
      <div className="border-b border-line bg-surface">
        <div className="container-page py-8">
          <nav aria-label="Breadcrumb" className="text-[13px] text-subtle">
            <Link to="/meetings" className="hover:text-fg">
              Meetings
            </Link>{' '}
            /{' '}
            <Link to={`/bodies/${encodeURIComponent(m.governmentBodyId)}`} className="hover:text-fg">
              {m.governmentBodyName}
            </Link>
          </nav>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.isDemo && <DemoBadge label="Demo meeting — sample data" />}
            {m.status === 'scheduled' && <Badge tone="accent">Upcoming</Badge>}
            <Badge>{m.meetingType.replace('_', ' ')}</Badge>
          </div>
          <h1 className="mt-2 font-serif text-[1.8rem] font-semibold leading-tight sm:text-[2.2rem]">{m.title}</h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4 text-subtle" aria-hidden />
              {formatDate(m.date)}
            </span>
            {m.startTime && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4 text-subtle" aria-hidden />
                {formatTime(m.startTime)}
              </span>
            )}
            {m.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4 text-subtle" aria-hidden />
                {m.location}
              </span>
            )}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <ButtonLink to={searchPath({ query: '', filters: { meetingId: m.id } })} size="sm" icon={<Search className="size-4" />}>
              All records from this meeting
            </ButtonLink>
            <CopyLinkButton size="sm" url={`${window.location.origin}/meetings/${encodeURIComponent(m.id)}`} />
            <Button size="sm" variant="ghost" icon={<Flag className="size-4" />} onClick={() => openReport({ subject: `${m.title}, ${formatDate(m.date)}`, defaultType: 'missing_document' })}>
              Report issue
            </Button>
          </div>
        </div>
      </div>

      <div className="container-page grid gap-10 py-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="records-h">
            <h2 id="records-h" className="eyebrow mb-3">
              Meeting records
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <RecordTile icon={<ClipboardList className="size-4" />} label="Agenda" status={m.agendaDocumentId ? 'Published' : 'Not available'} to={m.agendaDocumentId ? docHref({ id: m.agendaDocumentId }) : null} />
              <RecordTile icon={<BookOpenText className="size-4" />} label="Agenda packet" status={m.packetDocumentId ? 'Staff reports & exhibits' : 'Not available'} to={m.packetDocumentId ? docHref({ id: m.packetDocumentId }) : null} />
              <RecordTile
                icon={<FileCheck2 className="size-4" />}
                label="Minutes"
                status={m.minutesStatus === 'approved' ? 'Approved' : m.minutesStatus === 'draft' ? 'Draft — not yet approved' : 'Not yet available'}
                to={m.minutesDocumentId ? docHref({ id: m.minutesDocumentId }) : null}
              />
              <RecordTile icon={<Video className="size-4" />} label="Video" status={video ? `${formatDuration(video.durationSeconds) ?? 'Recording'}${video.url ? '' : ' · link not archived in demo'}` : 'Not available'} />
              <RecordTile icon={<AudioLines className="size-4" />} label="Audio" status={audio ? formatDuration(audio.durationSeconds) ?? 'Recording' : 'Not available'} />
              <RecordTile
                icon={<MessageSquareText className="size-4" />}
                label="Transcript"
                status={transcript ? 'Machine transcript — may contain errors' : 'Not available'}
                to={transcript?.documentId ? docHref({ id: transcript.documentId }) : null}
              />
            </div>
            {m.minutesStatus === 'draft' && (
              <InlineNotice tone="warn" className="mt-3">
                These minutes are a draft. Draft minutes are not the official record until approved by the body.
              </InlineNotice>
            )}
          </section>

          <section aria-labelledby="agenda-h">
            <h2 id="agenda-h" className="eyebrow mb-3">
              Agenda items
            </h2>
            <ol className="space-y-3">
              {m.agendaItems.map((item) => (
                <li key={item.id} id={`item-${item.number}`} className={cn('card scroll-mt-24 p-4 sm:p-5', item.itemType === 'other' && 'bg-canvas')}>
                  <div className="flex gap-3">
                    <span className="flex h-7 min-w-9 shrink-0 items-center justify-center rounded-md bg-raised px-1.5 font-mono text-[13px] font-medium text-muted">{item.number}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold leading-snug">{cleanText(item.title)}</h3>
                        <Badge>{ITEM_TYPE[item.itemType]}</Badge>
                      </div>
                      {item.description && <p className="mt-1 text-sm text-muted">{cleanText(item.description)}</p>}

                      {item.documentIds.length > 0 && (
                        <div className="-mx-2 mt-2">
                          {item.documentIds.map((id) => {
                            const d = docMap.get(id);
                            return d ? <CompactDocLink key={id} doc={d} /> : <Skeleton key={id} className="mx-2 my-2 h-10" />;
                          })}
                        </div>
                      )}
                      {m.packetDocumentId && item.packetPageStart && (
                        <Link to={docHref({ id: m.packetDocumentId }, item.packetPageStart)} className="link mt-1 inline-block text-xs">
                          In the agenda packet: pages {item.packetPageStart}–{item.packetPageEnd}
                        </Link>
                      )}

                      {item.motions.length > 0 && (
                        <ul className="mt-3 space-y-2 border-t border-line pt-3">
                          {item.motions.map((mo) => (
                            <li key={mo.id} className="flex gap-2.5 text-sm">
                              <Gavel className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                              <div>
                                <p>
                                  {cleanText(mo.description)} <Badge tone={OUTCOME_TONE[mo.outcome]}>{mo.outcome}</Badge>
                                </p>
                                <p className="mt-0.5 text-xs text-subtle">
                                  {mo.voteRecord ? cleanText(mo.voteRecord) : 'No vote recorded'} ·{' '}
                                  <Link to={docHref({ id: mo.evidence.documentId }, mo.evidence.page)} className="link">
                                    Source: minutes{mo.evidence.page ? `, p. ${mo.evidence.page}` : ''}
                                  </Link>
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="card p-5" aria-labelledby="src-h">
            <h2 id="src-h" className="eyebrow">
              Sources
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {m.sourceIds.map((id) => {
                const s = sources.data?.find((x) => x.id === id);
                return (
                  <li key={id}>
                    <Link to={`/sources/${encodeURIComponent(id)}`} className="link">
                      {s?.name ?? id}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-subtle">Motions and votes are shown exactly as recorded in the minutes and link to the page that records them.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
