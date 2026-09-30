import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import type { DocumentSummary, TimelineEvent } from '@/types/models';
import { Badge } from '@/components/ui/Badge';
import { docHref } from '@/lib/routes';
import { formatDate, formatMonthYear } from '@/lib/format';
import { cleanText } from '@/lib/safety';

const KIND_LABEL: Record<TimelineEvent['kind'], string> = {
  application: 'Application',
  hearing: 'Hearing',
  meeting: 'Meeting',
  approval: 'Approval',
  agreement: 'Agreement',
  notice: 'Notice',
  report: 'Report',
  other: 'Event',
};

/**
 * Reusable, evidence-linked timeline. Every event lists the records that establish it; events
 * without evidence are not rendered (the contract requires evidence for every event).
 */
export function Timeline({ events, documents }: { events: TimelineEvent[]; documents: Map<string, DocumentSummary> }) {
  const sorted = [...events].filter((e) => e.evidence.length > 0).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ol className="relative ml-3 border-l border-line-strong">
      {sorted.map((e) => (
        <li key={e.id} className="relative min-w-0 pb-8 pl-7 last:pb-0">
          <span aria-hidden className="absolute -left-[7px] top-1.5 size-3.5 rounded-full border-2 border-surface bg-accent ring-4 ring-accent-soft" />
          <div className="flex flex-wrap items-center gap-2">
            <time dateTime={e.date} className="text-sm font-semibold text-fg">
              {e.datePrecision === 'day' ? formatDate(e.date) : e.datePrecision === 'month' ? formatMonthYear(e.date) : e.date.slice(0, 4)}
            </time>
            <Badge tone="neutral">{KIND_LABEL[e.kind]}</Badge>
            {e.governmentBodyName && <span className="text-xs text-subtle">{e.governmentBodyName}</span>}
          </div>
          <h3 className="mt-1 text-[15px] font-semibold">{cleanText(e.title)}</h3>
          <p className="mt-0.5 text-sm text-muted">{cleanText(e.description)}</p>
          <ul className="mt-2.5 min-w-0 space-y-1.5" aria-label="Evidence">
            {e.evidence.map((ev, i) => {
              const doc = documents.get(ev.documentId);
              return (
                <li key={i} className="min-w-0">
                  <Link
                    to={docHref({ id: ev.documentId }, ev.page)}
                    className="flex w-fit max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                  >
                    <FileText className="size-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{doc ? cleanText(doc.title) : ev.documentId}</span>
                    {ev.page && <span className="shrink-0 text-subtle">p. {ev.page}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          {e.meetingId && (
            <Link to={`/meetings/${encodeURIComponent(e.meetingId)}`} className="link mt-2 inline-block text-xs">
              View meeting
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}
