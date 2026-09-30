import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, CalendarDays, FileStack, History, MessageSquareQuote, Quote, SearchCheck } from 'lucide-react';
import { AskBox, type AskMode } from '@/components/ask/AskBox';
import { ArchiveStatus } from '@/components/archive/ArchiveStatus';
import { DemoBadge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useLibrary } from '@/hooks/useLibrary';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useResource } from '@/hooks/useResource';
import { BrowseService, MeetingService, SearchService, SourceService } from '@/services';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { askPath, searchPath } from '@/lib/searchParams';
import { recordHistory } from '@/lib/library';
import { SOURCE_TYPE_LABELS } from '@/lib/labels';

const STEPS = [
  { Icon: MessageSquareQuote, title: 'Ask a question', body: 'In plain language, the way you’d ask a clerk.' },
  { Icon: SearchCheck, title: 'Search public records', body: 'Agendas, minutes, ordinances, contracts, budgets, notices.' },
  { Icon: Quote, title: 'See the sources', body: 'Every answer cites the record and page it came from.' },
];

export default function HomePage() {
  useDocumentTitle(null);
  const navigate = useNavigate();
  const desktop = useMediaQuery('(min-width: 768px)');
  const suggestions = useResource('suggestions', SearchService.suggestions);
  const { history } = useLibrary();

  const go = (value: string, mode: AskMode) => {
    if (mode === 'ask') {
      void recordHistory('question', value, askPath(value));
      navigate(askPath(value));
    } else {
      navigate(searchPath({ query: value }));
    }
  };

  const askSuggestions = suggestions.data?.filter((s) => s.mode === 'ask') ?? [];
  const searchSuggestions = suggestions.data?.filter((s) => s.mode === 'search') ?? [];

  return (
    <div className="flex flex-col">
      {/* ---------------------------------------------------------------- Hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--vtp-accent-soft),transparent_70%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:linear-gradient(var(--vtp-line)_1px,transparent_1px),linear-gradient(90deg,var(--vtp-line)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]"
        />
        <div className="container-page relative flex min-h-[calc(100dvh-8rem)] flex-col justify-center py-12 sm:py-16">
          <div className="mx-auto w-full max-w-3xl">
            <p className="eyebrow text-center">Vineyard, Utah · Public records</p>
            <h1 className="mt-4 text-center font-serif text-[2.35rem] font-semibold leading-[1.08] tracking-[-0.02em] text-fg sm:text-[3.4rem]">
              Search the public record.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-center text-[16.5px] leading-relaxed text-muted sm:text-lg">
              Ask a question about Vineyard and see the records behind the answer.
            </p>

            <AskBox className="mt-9" onSubmit={go} autoFocus={desktop} />

            <div className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-[1.35fr_1fr]">
              <div>
                <h2 className="eyebrow">Try asking</h2>
                <ul className="mt-2 space-y-0.5">
                  {suggestions.loading
                    ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="my-2 h-4 w-4/5" />)
                    : askSuggestions.slice(0, 5).map((s) => (
                        <li key={s.id}>
                          <button
                            onClick={() => go(s.text, 'ask')}
                            className="group flex w-full items-center gap-2 rounded-md py-1.5 text-left text-[14.5px] text-muted hover:text-accent"
                          >
                            <ArrowRight className="size-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
                            {s.text}
                          </button>
                        </li>
                      ))}
                </ul>
              </div>
              <div>
                <h2 className="eyebrow">Or search for</h2>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {searchSuggestions.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={searchPath({ query: s.text })}
                        className="inline-flex rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12.5px] text-muted hover:border-accent hover:text-accent"
                      >
                        {s.text}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <ol className="mx-auto mt-14 grid w-full max-w-4xl gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3" aria-label="How it works">
            {STEPS.map(({ Icon, title, body }, i) => (
              <li key={title} className="flex gap-3 bg-surface/90 p-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    <span className="mr-1.5 text-subtle tabular-nums">{i + 1}.</span>
                    {title}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------------------- Below the fold */}
      <div className="container-page grid gap-12 py-14 lg:grid-cols-[1fr_340px]">
        <div className="space-y-12">
          <Collections />
          <RecentMeetings />
        </div>
        <aside className="space-y-8">
          <ArchiveStatus />
          {history && history.length > 0 && (
            <section aria-labelledby="recent-heading" className="card p-5">
              <div className="flex items-center justify-between">
                <h2 id="recent-heading" className="eyebrow flex items-center gap-1.5">
                  <History className="size-3.5" aria-hidden /> Recent on this device
                </h2>
                <Link to="/saved" className="text-xs text-subtle hover:text-fg">
                  Manage
                </Link>
              </div>
              <ul className="mt-3 space-y-1">
                {history.slice(0, 5).map((h) => (
                  <li key={h.key}>
                    <Link to={h.path} className="flex items-baseline justify-between gap-3 rounded-md py-1 text-sm text-muted hover:text-accent">
                      <span className="truncate">{h.text}</span>
                      <span className="shrink-0 text-xs text-subtle">{formatRelative(h.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <SourcesSummary />
        </aside>
      </div>
    </div>
  );
}

function Collections() {
  const { data, loading } = useResource('categories', BrowseService.categories);
  return (
    <section aria-labelledby="collections-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="collections-heading" className="font-serif text-2xl font-semibold tracking-[-0.01em]">
            Browse the archive
          </h2>
          <p className="mt-1 text-sm text-muted">Every collection is searchable and every record links to its source.</p>
        </div>
        <Link to="/browse" className="hidden shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline sm:inline-flex">
          All ways to browse <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <ul className="mt-5 grid overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3 [&>li]:bg-surface" style={{ gap: 1 }}>
        {loading &&
          Array.from({ length: 9 }, (_, i) => (
            <li key={i} className="p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-4/5" />
            </li>
          ))}
        {data
          ?.filter((c) => c.id !== 'other')
          .slice(0, 12)
          .map((c) => (
            <li key={c.id}>
              <Link to={searchPath({ query: '', filters: { categories: [c.id as never] } })} className="group flex h-full flex-col p-4 transition-colors hover:bg-raised">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[14.5px] font-semibold group-hover:text-accent">{c.label}</span>
                  {c.documentCount != null && <span className="text-xs tabular-nums text-subtle">{formatNumber(c.documentCount)}</span>}
                </span>
                <span className="mt-0.5 text-[13px] leading-snug text-muted">{c.description}</span>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}

function RecentMeetings() {
  const { data, loading } = useResource('home-meetings', () => MeetingService.list({ pageSize: 4, sort: 'date_desc' }));
  return (
    <section aria-labelledby="meetings-heading">
      <div className="flex items-end justify-between gap-4">
        <h2 id="meetings-heading" className="font-serif text-2xl font-semibold tracking-[-0.01em]">
          Recent meetings
        </h2>
        <Link to="/meetings" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline">
          All meetings <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface">
        {loading &&
          [0, 1, 2].map((i) => (
            <li key={i} className="p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </li>
          ))}
        {data?.items.map((m) => (
          <li key={m.id}>
            <Link to={`/meetings/${encodeURIComponent(m.id)}`} className="group flex items-center gap-4 p-4 hover:bg-raised">
              <span className="flex w-12 shrink-0 flex-col items-center rounded-lg border border-line bg-canvas py-1 text-center">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">{formatDate(m.date, 'medium').split(' ')[0]}</span>
                <span className="text-lg font-semibold leading-tight tabular-nums">{Number(m.date.slice(8, 10))}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium group-hover:text-accent">{m.title}</span>
                  {m.isDemo && <DemoBadge />}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-subtle">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="size-3" aria-hidden />
                    {formatDate(m.date)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <FileStack className="size-3" aria-hidden />
                    {m.agendaItemCount} agenda items
                  </span>
                  <span>{m.status === 'scheduled' ? 'Upcoming' : m.minutesStatus === 'approved' ? 'Minutes approved' : m.minutesStatus === 'draft' ? 'Draft minutes' : 'No minutes yet'}</span>
                </span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-subtle group-hover:text-accent" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourcesSummary() {
  const { data } = useResource('sources', SourceService.list);
  const real = data?.filter((s) => !s.isDemo) ?? [];
  return (
    <section aria-labelledby="sources-heading" className="card p-5">
      <h2 id="sources-heading" className="eyebrow">
        Where records come from
      </h2>
      <ul className="mt-3 space-y-2.5">
        {real.slice(0, 6).map((s) => (
          <li key={s.id}>
            <Link to={`/sources/${encodeURIComponent(s.id)}`} className="group block">
              <span className="block text-sm font-medium group-hover:text-accent">{s.name}</span>
              <span className="block text-xs text-subtle">
                {SOURCE_TYPE_LABELS[s.sourceType]} · {s.authority}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/sources" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        Source provenance <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}
