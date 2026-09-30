import { CalendarDays, FileText, Flag } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Citation } from '@/types/models';
import { useApp } from '@/app/AppContext';
import { DemoBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ExternalLink } from '@/components/ui/ExternalLink';
import { Highlighted } from '@/components/ui/Highlighted';
import { docHref } from '@/lib/routes';
import { documentTypeLabel } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { cleanText, displayHost, safeUrl } from '@/lib/safety';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-subtle">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Side panel (bottom sheet on phones) showing exactly where a cited claim comes from. */
export function CitationPanel({ citation, question, responseId, onClose }: { citation: Citation | null; question: string; responseId: string; onClose: () => void }) {
  const { openReport } = useApp();
  const c = citation;
  const archive = safeUrl(c?.archiveUrl);
  return (
    <Dialog open={c !== null} onClose={onClose} title={c ? `Source ${c.index}` : 'Source'} description="The record this part of the answer comes from." placement="responsive-right">
      {c && (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap gap-1.5">{c.isDemo && <DemoBadge label="Demo record" />}</div>
            <h3 className="mt-2 font-serif text-lg font-semibold leading-snug">{cleanText(c.documentTitle)}</h3>
          </div>

          <figure className="rounded-xl border border-line bg-raised/60 p-4">
            <figcaption className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-subtle">
              Excerpt{c.page ? ` · page ${c.page}` : ''}
              {c.sectionTitle ? ` · ${cleanText(c.sectionTitle)}` : ''}
            </figcaption>
            <blockquote className="font-serif text-[15.5px] leading-relaxed">
              <Highlighted text={c.excerpt.text} ranges={c.excerpt.highlights} />
            </blockquote>
          </figure>

          <div className="flex flex-wrap gap-2">
            <ButtonLink to={docHref({ id: c.documentId }, c.page, question.replace(/[?!.]+$/, ''))} variant="primary" icon={<FileText className="size-4" />} onClick={onClose}>
              {c.page ? `Open record at page ${c.page}` : 'Open record'}
            </ButtonLink>
            {archive && (
              <a href={`${archive}${c.page ? `#page=${c.page}` : ''}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-raised">
                Archived copy
              </a>
            )}
          </div>

          <dl className="divide-y divide-line border-y border-line">
            <Row label="Type">{documentTypeLabel(c.documentType)}</Row>
            {c.documentNumber && (
              <Row label="Number">
                <span className="font-mono text-[13px]">{cleanText(c.documentNumber)}</span>
              </Row>
            )}
            <Row label="Date">{formatDate(c.date)}</Row>
            {c.governmentBodyName && <Row label="Body">{c.governmentBodyName}</Row>}
            {c.meetingTitle && (
              <Row label="Meeting">
                {c.meetingId ? (
                  <Link to={`/meetings/${encodeURIComponent(c.meetingId)}`} className="link inline-flex items-center gap-1" onClick={onClose}>
                    <CalendarDays className="size-3.5" aria-hidden />
                    {c.meetingTitle}
                  </Link>
                ) : (
                  c.meetingTitle
                )}
              </Row>
            )}
            {c.agendaItem && <Row label="Agenda item">{cleanText(c.agendaItem)}</Row>}
            {c.page && <Row label="Page">{c.page}</Row>}
            <Row label="Original source">
              {c.originalUrl ? (
                <ExternalLink href={c.originalUrl} className="link">
                  {displayHost(c.originalUrl) ?? 'Original'}
                </ExternalLink>
              ) : (
                <span className="text-subtle">Not recorded</span>
              )}
            </Row>
          </dl>

          <Button
            size="sm"
            variant="ghost"
            icon={<Flag className="size-4" />}
            onClick={() => {
              onClose();
              openReport({ context: { askResponseId: responseId, citationIndex: c.index, documentId: c.documentId }, subject: `Citation [${c.index}]: ${c.documentTitle}`, defaultType: 'incorrect_citation' });
            }}
          >
            Report an incorrect citation
          </Button>
        </div>
      )}
    </Dialog>
  );
}
