import { Link } from 'react-router-dom';
import { CalendarDays, FileSearch } from 'lucide-react';
import type { DocumentSummary, MatchExplanation, SourceExcerpt } from '@/types/models';
import { Badge, DemoBadge } from '@/components/ui/Badge';
import { Highlighted } from '@/components/ui/Highlighted';
import { CURRENCY_LABELS, documentTypeLabel } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { cleanText } from '@/lib/safety';
import { cn } from '@/lib/cn';
import { DocTypeIcon } from './DocTypeIcon';
import { docHref } from '@/lib/routes';

const FIELD_LABELS: Record<MatchExplanation['field'], string> = {
  title: 'Title',
  document_number: 'Document number',
  full_text: 'Text',
  entity: 'Subject',
  metadata: 'Metadata',
  semantic: 'Related meaning',
};

export function DocumentMeta({ doc, meetingTitle, className }: { doc: DocumentSummary; meetingTitle?: string | null; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-subtle', className)}>
      <span className="inline-flex items-center gap-1.5 font-medium text-muted">
        <DocTypeIcon type={doc.documentType} className="size-3.5" />
        {documentTypeLabel(doc.documentType)}
      </span>
      {doc.documentNumber && (
        <>
          <span aria-hidden>·</span>
          <span className="font-mono text-[12px]">{cleanText(doc.documentNumber)}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <time dateTime={doc.date ?? undefined}>{formatDate(doc.date, 'medium')}</time>
      {doc.governmentBodyName && (
        <>
          <span aria-hidden>·</span>
          <span>{doc.governmentBodyName}</span>
        </>
      )}
      {meetingTitle && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>·</span>
          <CalendarDays className="size-3.5" aria-hidden />
          {meetingTitle}
        </span>
      )}
    </div>
  );
}

export function CurrencyBadge({ currency }: { currency: DocumentSummary['currency'] }) {
  if (currency === 'historical' || currency === 'unknown') return null;
  return <Badge tone={currency === 'current' ? 'ok' : currency === 'superseded' ? 'warn' : 'accent'}>{CURRENCY_LABELS[currency]}</Badge>;
}

export function MatchExplanationLine({ matches }: { matches: MatchExplanation[] }) {
  if (!matches.length) return null;
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
      <span className="inline-flex items-center gap-1 font-medium text-muted">
        <FileSearch className="size-3.5" aria-hidden />
        Matched
      </span>
      {matches.map((m, i) => (
        <span key={i}>
          {FIELD_LABELS[m.field]}: {m.terms.map((t) => `“${t}”`).join(', ')}
          {m.page ? ` · page ${m.page}` : ''}
          {m.detail && m.field !== 'full_text' ? ` · ${m.detail}` : ''}
        </span>
      ))}
    </p>
  );
}

export function ExcerptBlock({ excerpt, href }: { excerpt: SourceExcerpt; href: string }) {
  return (
    <Link to={href} className="group mt-3 block rounded-lg border-l-2 border-line-strong bg-raised/60 px-3.5 py-2.5 transition-colors hover:border-accent">
      <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-subtle group-hover:text-accent">
        {excerpt.page ? `Page ${excerpt.page}` : 'Excerpt'}
        {excerpt.sectionTitle ? ` · ${cleanText(excerpt.sectionTitle)}` : ''}
      </span>
      <span className="font-serif text-[14.5px] leading-relaxed text-fg">
        <Highlighted text={excerpt.text} ranges={excerpt.highlights} />
      </span>
    </Link>
  );
}

export function ResultCard({
  doc,
  excerpts = [],
  matches = [],
  meetingTitle,
  query,
  className,
}: {
  doc: DocumentSummary;
  excerpts?: SourceExcerpt[];
  matches?: MatchExplanation[];
  meetingTitle?: string | null;
  query?: string;
  className?: string;
}) {
  const firstPage = excerpts[0]?.page ?? null;
  return (
    <article className={cn('card p-4 transition-shadow hover:shadow-sm sm:p-5', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {doc.isDemo && <DemoBadge />}
        <CurrencyBadge currency={doc.currency} />
      </div>
      <h3 className="mt-2 text-[16.5px] font-semibold leading-snug tracking-[-0.005em]">
        <Link to={docHref(doc, firstPage, query)} className="hover:text-accent hover:underline hover:decoration-accent/40 hover:underline-offset-2">
          {cleanText(doc.title)}
        </Link>
      </h3>
      <DocumentMeta doc={doc} meetingTitle={meetingTitle} className="mt-1.5" />
      {excerpts.slice(0, 2).map((ex, i) => (
        <ExcerptBlock key={`${ex.chunkId}-${i}`} excerpt={ex} href={docHref(doc, ex.page, query)} />
      ))}
      {!excerpts.length && doc.description && <p className="mt-2.5 line-clamp-2 text-sm text-muted">{cleanText(doc.description)}</p>}
      <MatchExplanationLine matches={matches} />
    </article>
  );
}

export function CompactDocLink({ doc, note, className }: { doc: DocumentSummary; note?: string; className?: string }) {
  return (
    <Link to={docHref(doc)} className={cn('group flex gap-3 rounded-lg p-2.5 transition-colors hover:bg-raised', className)}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
        <DocTypeIcon type={doc.documentType} />
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-accent">{cleanText(doc.title)}</span>
        <span className="mt-0.5 block text-xs text-subtle">
          {documentTypeLabel(doc.documentType)} · {formatDate(doc.date, 'medium')}
          {note ? ` · ${note}` : ''}
        </span>
      </span>
    </Link>
  );
}
