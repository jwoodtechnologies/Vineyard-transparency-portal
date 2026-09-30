import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookmarkCheck, BookmarkPlus, CircleCheck, CircleDashed, CircleHelp, FileSearch, Flag, Info, Search, Sparkles, TriangleAlert } from 'lucide-react';
import type { AskResponse, Citation } from '@/types/models';
import { useApp } from '@/app/AppContext';
import { Badge, DemoBadge, type BadgeTone } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { CopyLinkButton } from '@/components/ui/CopyButton';
import { Highlighted } from '@/components/ui/Highlighted';
import { InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { CompactDocLink, ResultCard } from '@/components/documents/ResultCard';
import { docHref } from '@/lib/routes';
import { DocTypeIcon } from '@/components/documents/DocTypeIcon';
import { useSavedToggle } from '@/hooks/useLibrary';
import { RETRIEVAL_STATUS_LABELS, documentTypeLabel } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { askPath, searchPath } from '@/lib/searchParams';
import { cleanText } from '@/lib/safety';
import { cn } from '@/lib/cn';
import { CitationPanel } from './CitationPanel';

const STATUS_TONE: Record<AskResponse['retrievalStatus'], BadgeTone> = {
  grounded: 'ok',
  partial: 'warn',
  no_results: 'neutral',
  ai_unavailable: 'warn',
  search_only: 'neutral',
};

const STATUS_ICON = {
  grounded: CircleCheck,
  partial: CircleDashed,
  no_results: CircleHelp,
  ai_unavailable: TriangleAlert,
  search_only: Search,
} as const;

function CitationMarker({ n, onOpen, active }: { n: number; onOpen: (n: number) => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      aria-label={`Source ${n}`}
      className={cn(
        'mx-0.5 inline-flex h-[1.2rem] min-w-[1.2rem] -translate-y-px items-center justify-center rounded-[5px] px-1 align-middle font-sans text-[11px] font-semibold tabular-nums transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent-ink hover:bg-accent hover:text-on-accent',
      )}
    >
      {n}
    </button>
  );
}

function highlightTerms(question: string): string {
  return question.replace(/[?!.]+$/, '');
}

export function AnswerView({ response, onFollowUp }: { response: AskResponse; onFollowUp: (q: string) => void }) {
  const [openCitation, setOpenCitation] = useState<number | null>(null);
  const { openReport } = useApp();
  const toast = useToast();
  const status = response.retrievalStatus;
  const StatusIcon = STATUS_ICON[status];
  const citation = openCitation != null ? response.citations.find((c) => c.index === openCitation) ?? null : null;
  const shareUrl = `${window.location.origin}${askPath(response.question)}`;
  const { isSaved, toggle } = useSavedToggle('question', response.question.toLowerCase(), () => ({
    title: response.question,
    path: askPath(response.question),
    subtitle: 'Question',
  }));
  const sourcesId = `sources-${response.id}`;
  const isFallback = status === 'ai_unavailable' || status === 'search_only';

  return (
    <div className="animate-fade-in">
      {/* Transparency row */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
        <Badge tone={STATUS_TONE[status]} icon={<StatusIcon className="size-3" aria-hidden />}>
          {RETRIEVAL_STATUS_LABELS[status]}
        </Badge>
        {!isFallback && (
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3.5" aria-hidden />
            Generated from indexed public records.
          </span>
        )}
        {response.citations.length > 0 && (
          <a href={`#${sourcesId}`} className="font-medium text-accent hover:underline">
            View sources ({response.citations.length})
          </a>
        )}
        {response.isDemo && <DemoBadge className="ml-auto" label="Demo answer" />}
      </div>

      {isFallback ? (
        <InlineNotice tone="warn" icon={<TriangleAlert className="size-4" />} className="mt-4">
          {response.notice ?? response.answer}
        </InlineNotice>
      ) : (
        <div className="mt-4 space-y-3 font-serif text-[17px] leading-[1.7] text-fg">
          {response.paragraphs.map((p, i) => (
            <p key={i}>
              {p.segments.map((s, j) => (
                <Fragment key={j}>
                  {cleanText(s.text)}
                  {s.citations.map((n) => (
                    <CitationMarker key={n} n={n} onOpen={setOpenCitation} active={openCitation === n} />
                  ))}
                </Fragment>
              ))}
            </p>
          ))}
        </div>
      )}

      {response.isDemo && response.notice && !isFallback && (
        <InlineNotice tone="demo" icon={<Info className="size-4" />} className="mt-4">
          {response.notice}
        </InlineNotice>
      )}

      {/* Sources */}
      {response.citations.length > 0 && (
        <section id={sourcesId} aria-label="Sources" className="mt-7 scroll-mt-24">
          <h3 className="eyebrow">Sources</h3>
          <ol className="mt-3 grid gap-2.5">
            {response.citations.map((c) => (
              <SourceCard key={c.index} c={c} question={response.question} onOpen={() => setOpenCitation(c.index)} active={openCitation === c.index} />
            ))}
          </ol>
        </section>
      )}

      {/* Search results (fallback / partial / no results) */}
      {response.searchResults && response.searchResults.length > 0 && (
        <section aria-label="Search results" className="mt-7">
          <h3 className="eyebrow">{isFallback ? 'Search results from the public-record archive' : 'Related search results'}</h3>
          <div className="mt-3 space-y-3">
            {response.searchResults.slice(0, 5).map((r) => (
              <ResultCard key={r.document.id} doc={r.document} excerpts={r.excerpts.slice(0, 1)} matches={r.matches} meetingTitle={r.meetingTitle} query={highlightTerms(response.question)} />
            ))}
          </div>
        </section>
      )}
      {status === 'no_results' && !response.searchResults?.length && (
        <p className="mt-5 text-sm text-muted">
          No indexed records matched. Try different words, a document number, or{' '}
          <Link to={searchPath({ query: response.question })} className="link">
            search the archive manually
          </Link>
          .
        </p>
      )}

      {/* Related documents */}
      {response.relatedDocuments.length > 0 && (
        <section aria-label="Related documents" className="mt-7">
          <h3 className="eyebrow">Related records</h3>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {response.relatedDocuments.map((d) => (
              <CompactDocLink key={d.id} doc={d} />
            ))}
          </div>
        </section>
      )}

      {/* Follow-ups */}
      {response.suggestedFollowUps.length > 0 && (
        <section aria-label="Suggested follow-up questions" className="mt-7">
          <h3 className="eyebrow">Follow-up questions</h3>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
            {response.suggestedFollowUps.map((f) => (
              <li key={f}>
                <button onClick={() => onFollowUp(f)} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-muted hover:text-accent">
                  <ArrowRight className="size-3.5 shrink-0 text-subtle group-hover:text-accent" aria-hidden />
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
        <ButtonLink to={searchPath({ query: response.question })} size="sm" icon={<FileSearch className="size-4" />}>
          Search the archive manually
        </ButtonLink>
        <Button
          size="sm"
          icon={isSaved ? <BookmarkCheck className="size-4 text-accent" /> : <BookmarkPlus className="size-4" />}
          onClick={async () => toast((await toggle()) ? 'Question saved on this device' : 'Removed from this device', 'ok')}
          aria-pressed={isSaved}
        >
          {isSaved ? 'Saved' : 'Save question'}
        </Button>
        <CopyLinkButton size="sm" url={shareUrl} />
        <Button
          size="sm"
          variant="ghost"
          icon={<Flag className="size-4" />}
          onClick={() => openReport({ context: { askResponseId: response.id }, subject: `Answer to “${response.question}”`, defaultType: 'incorrect_ai_summary' })}
        >
          Report an issue
        </Button>
      </div>

      <CitationPanel citation={citation} question={response.question} responseId={response.id} onClose={() => setOpenCitation(null)} />
    </div>
  );
}

function SourceCard({ c, question, onOpen, active }: { c: Citation; question: string; onOpen: () => void; active: boolean }) {
  return (
    <li className={cn('card flex gap-3 p-3.5 transition-colors', active && 'border-accent')}>
      <button
        onClick={onOpen}
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-[12px] font-semibold tabular-nums text-accent-ink hover:bg-accent hover:text-on-accent"
        aria-label={`Open source ${c.index} details`}
      >
        {c.index}
      </button>
      <div className="min-w-0 flex-1">
        <Link to={docHref({ id: c.documentId }, c.page, highlightTerms(question))} className="line-clamp-2 text-sm font-semibold leading-snug hover:text-accent">
          {cleanText(c.documentTitle)}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-subtle">
          <DocTypeIcon type={c.documentType} className="size-3" />
          {documentTypeLabel(c.documentType)}
          <span aria-hidden>·</span>
          {formatDate(c.date, 'medium')}
          {c.page && (
            <>
              <span aria-hidden>·</span>
              Page {c.page}
            </>
          )}
          {c.sectionTitle && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{cleanText(c.sectionTitle)}</span>
            </>
          )}
        </p>
        <button onClick={onOpen} className="mt-1.5 line-clamp-2 text-left font-serif text-[14px] leading-relaxed text-muted hover:text-fg">
          <Highlighted text={c.excerpt.text} ranges={c.excerpt.highlights} />
        </button>
      </div>
    </li>
  );
}
