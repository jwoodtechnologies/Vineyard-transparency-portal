import { useId, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookmarkCheck, BookmarkPlus, Search as SearchIcon, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { SearchFacets, SearchFilters, SearchRequest, SearchSort } from '@/types/models';
import { FilterPanel } from '@/components/search/FilterPanel';
import { ResultCard } from '@/components/documents/ResultCard';
import { Button } from '@/components/ui/Button';
import { CopyLinkButton } from '@/components/ui/CopyButton';
import { Dialog } from '@/components/ui/Dialog';
import { Pagination } from '@/components/ui/Pagination';
import { ResultSkeleton } from '@/components/ui/Skeleton';
import { DataErrorState, EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSavedToggle } from '@/hooks/useLibrary';
import { useResource } from '@/hooks/useResource';
import { SearchService } from '@/services';
import { recordHistory } from '@/lib/library';
import { askPath, countActiveFilters, paramsToSearchRequest, searchRequestToParams } from '@/lib/searchParams';
import { CATEGORY_LABELS, DOCUMENT_TYPE_LABELS } from '@/lib/labels';
import { formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

const SORTS: Array<{ value: SearchSort; label: string }> = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'title', label: 'Title A–Z' },
];

const TIPS = [
  ['"parking enforcement"', 'Exact phrase'],
  ['DEMO-RES-2026-04', 'Document number'],
  ['towing contract', 'All words'],
  ['FY 2027 budget', 'Fiscal year'],
];

function describeFilterChips(f: SearchFilters, facets: SearchFacets | null) {
  const chips: Array<{ key: string; label: string; remove: (f: SearchFilters) => SearchFilters }> = [];
  const lookup = (list: { value: string; label: string }[] | undefined, v: string) => list?.find((b) => b.value === v)?.label ?? v;
  f.categories?.forEach((c) =>
    chips.push({ key: `c${c}`, label: CATEGORY_LABELS[c] ?? c, remove: (x) => ({ ...x, categories: x.categories?.filter((y) => y !== c) }) }),
  );
  f.documentTypes?.forEach((t) =>
    chips.push({ key: `t${t}`, label: DOCUMENT_TYPE_LABELS[t] ?? t, remove: (x) => ({ ...x, documentTypes: x.documentTypes?.filter((y) => y !== t) }) }),
  );
  f.years?.forEach((y) => chips.push({ key: `y${y}`, label: String(y), remove: (x) => ({ ...x, years: x.years?.filter((z) => z !== y) }) }));
  f.governmentBodyIds?.forEach((b) =>
    chips.push({ key: `b${b}`, label: lookup(facets?.governmentBodies, b), remove: (x) => ({ ...x, governmentBodyIds: x.governmentBodyIds?.filter((y) => y !== b) }) }),
  );
  f.sourceIds?.forEach((s) =>
    chips.push({ key: `s${s}`, label: lookup(facets?.sources, s), remove: (x) => ({ ...x, sourceIds: x.sourceIds?.filter((y) => y !== s) }) }),
  );
  if (f.dateFrom) chips.push({ key: 'from', label: `From ${formatDate(f.dateFrom, 'medium')}`, remove: (x) => ({ ...x, dateFrom: undefined }) });
  if (f.dateTo) chips.push({ key: 'to', label: `To ${formatDate(f.dateTo, 'medium')}`, remove: (x) => ({ ...x, dateTo: undefined }) });
  if (f.meetingId) chips.push({ key: 'meeting', label: 'This meeting only', remove: (x) => ({ ...x, meetingId: undefined }) });
  return chips;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const req = useMemo(() => paramsToSearchRequest(params), [params]);
  const [draft, setDraft] = useState(req.query);
  const [prevQuery, setPrevQuery] = useState(req.query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputId = useId();
  const activeFilters = countActiveFilters(req.filters);
  const shouldSearch = Boolean(req.query.trim()) || activeFilters > 0;
  const key = shouldSearch ? searchRequestToParams(req).toString() : null;
  const { data, previous, error, loading, reload } = useResource(key, () => SearchService.search(req));
  const shown = data ?? (loading ? previous : undefined);
  useDocumentTitle(req.query ? `“${req.query}” — Search` : 'Search');

  // Keep the input in sync when the URL changes (back/forward, facet links).
  if (req.query !== prevQuery) {
    setPrevQuery(req.query);
    setDraft(req.query);
  }

  const update = (next: Partial<SearchRequest>, resetPage = true) => {
    const merged: SearchRequest = { ...req, ...next, page: resetPage ? 1 : (next.page ?? req.page) };
    setParams(searchRequestToParams(merged));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    update({ query: q });
    if (q) void recordHistory('search', q, `/search?${searchRequestToParams({ ...req, query: q, page: 1 }).toString()}`);
  };

  const pathForSave = `/search?${searchRequestToParams({ ...req, page: 1 }).toString()}`;
  const { isSaved, toggle } = useSavedToggle('search', pathForSave, () => ({
    title: req.query || 'Filtered records',
    path: pathForSave,
    subtitle: activeFilters ? `${activeFilters} filter${activeFilters === 1 ? '' : 's'}` : 'Search',
  }));

  const chips = describeFilterChips(req.filters ?? {}, shown?.facets ?? null);
  const filterPanel = <FilterPanel facets={shown?.facets ?? null} filters={req.filters ?? {}} onChange={(filters) => update({ filters })} />;

  return (
    <div className="container-wide py-6 sm:py-8">
      <form onSubmit={submit} role="search" aria-label="Search public records" className="mx-auto max-w-4xl lg:mx-0">
        <label htmlFor={inputId} className="sr-only">
          Search public records
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-subtle" aria-hidden />
            <input
              id={inputId}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder='Keywords, "exact phrases", document numbers…'
              enterKeyHint="search"
              className="h-12 w-full rounded-xl border border-line-strong bg-surface pl-11 pr-4 text-[15.5px] shadow-sm placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>
          <Button type="submit" variant="primary" size="lg" className="px-5">
            Search
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div role="radiogroup" aria-label="Match" className="inline-flex rounded-lg border border-line bg-raised p-0.5">
            {(
              [
                ['all', 'All words'],
                ['any', 'Any word'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={(req.match ?? 'all') === m}
                onClick={() => update({ match: m })}
                className={cn('h-7 rounded-md px-2.5 text-[13px] font-medium', (req.match ?? 'all') === m ? 'bg-surface text-fg shadow-sm' : 'text-subtle hover:text-fg')}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={Boolean(req.titleOnly)} onChange={(e) => update({ titleOnly: e.target.checked })} className="size-4 accent-[var(--vtp-accent)]" />
            Titles only
          </label>
          {req.query && (
            <button type="button" onClick={() => navigate(askPath(req.query))} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
              <Sparkles className="size-3.5" aria-hidden />
              Ask this as a question
            </button>
          )}
        </div>
      </form>

      <div className="mt-6 grid gap-8 lg:grid-cols-[260px_1fr]">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-2">{filterPanel}</div>
        </aside>

        <section aria-label="Results" aria-busy={loading} className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button size="sm" className="lg:hidden" icon={<SlidersHorizontal className="size-4" />} onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
              Filters{activeFilters ? ` (${activeFilters})` : ''}
            </Button>
            <p className="text-sm text-muted" aria-live="polite">
              {shown ? (
                <>
                  <strong className="font-semibold text-fg">{formatNumber(shown.total)}</strong> {shown.total === 1 ? 'record' : 'records'}
                  {req.query && (
                    <>
                      {' '}
                      for <span className="font-medium text-fg">“{req.query}”</span>
                    </>
                  )}
                </>
              ) : shouldSearch && loading ? (
                'Searching…'
              ) : null}
            </p>
            {shouldSearch && (
              <div className="ml-auto flex items-center gap-2">
                <label className="sr-only" htmlFor={`${inputId}-sort`}>
                  Sort
                </label>
                <select
                  id={`${inputId}-sort`}
                  value={req.sort ?? (req.query ? 'relevance' : 'date_desc')}
                  onChange={(e) => update({ sort: e.target.value as SearchSort })}
                  className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px]"
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={isSaved}
                  icon={isSaved ? <BookmarkCheck className="size-4 text-accent" /> : <BookmarkPlus className="size-4" />}
                  onClick={async () => toast((await toggle()) ? 'Search saved on this device' : 'Removed from this device')}
                >
                  <span className="hidden sm:inline">{isSaved ? 'Saved' : 'Save'}</span>
                </Button>
                <CopyLinkButton size="sm" variant="ghost" url={`${window.location.origin}${pathForSave}`} label="Share" />
              </div>
            )}
          </div>

          {chips.length > 0 && (
            <ul className="mb-4 flex flex-wrap gap-1.5" aria-label="Active filters">
              {chips.map((c) => (
                <li key={c.key}>
                  <button
                    onClick={() => update({ filters: c.remove(req.filters ?? {}) })}
                    className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent-soft py-1 pl-2 pr-1.5 text-xs font-medium text-accent-ink hover:border-accent"
                    aria-label={`Remove filter: ${c.label}`}
                  >
                    {c.label}
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
              <li>
                <button onClick={() => update({ filters: {} })} className="px-1.5 py-1 text-xs font-medium text-subtle hover:text-fg">
                  Clear all
                </button>
              </li>
            </ul>
          )}

          {!shouldSearch && (
            <EmptyState icon={<SearchIcon className="size-5" />} title="Search the public-record archive">
              <p>Search works with or without AI: titles, full text, document numbers, and exact phrases.</p>
              <ul className="mt-4 grid gap-1.5 text-left sm:grid-cols-2">
                {TIPS.map(([example, label]) => (
                  <li key={example}>
                    <button onClick={() => update({ query: example })} className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-accent">
                      <span className="block font-mono text-[13px] text-fg">{example}</span>
                      <span className="block text-xs text-subtle">{label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </EmptyState>
          )}

          {shouldSearch && error != null && !loading && <DataErrorState error={error} onRetry={reload} what="search results" />}
          {shouldSearch && !shown && loading && <ResultSkeleton />}

          {shown && shown.total === 0 && !loading && (
            <EmptyState title="No records found">
              <p>
                No indexed records match{req.query ? ` “${req.query}”` : ''}
                {activeFilters ? ' with the current filters' : ''}. Try fewer words, “Any word” matching, or removing filters.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {activeFilters > 0 && <Button onClick={() => update({ filters: {} })}>Clear filters</Button>}
                {req.match !== 'any' && req.query && <Button onClick={() => update({ match: 'any' })}>Match any word</Button>}
              </div>
            </EmptyState>
          )}

          {shown && shown.total > 0 && (
            <div className={cn('space-y-3 transition-opacity', loading && 'opacity-60')}>
              {shown.items.map((r) => (
                <ResultCard key={r.document.id} doc={r.document} excerpts={r.excerpts} matches={r.matches} meetingTitle={r.meetingTitle} query={req.query} />
              ))}
              <Pagination page={shown.page} pageSize={shown.pageSize} total={shown.total} onPage={(page) => update({ page }, false)} />
              <p className="pt-2 text-xs text-subtle">
                Retrieval: {shown.retrieval.join(' + ').replace(/_/g, ' ')} · {shown.tookMs} ms
              </p>
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        placement="bottom"
        footer={
          <>
            <Button onClick={() => update({ filters: {} })} disabled={!activeFilters}>
              Clear all
            </Button>
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>
              Show {shown ? formatNumber(shown.total) : ''} results
            </Button>
          </>
        }
      >
        {filterPanel}
      </Dialog>
    </div>
  );
}
