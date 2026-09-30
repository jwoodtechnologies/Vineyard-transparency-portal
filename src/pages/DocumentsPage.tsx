import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { CategoryId, SearchSort } from '@/types/models';
import { PageHeader } from '@/components/layout/PageHeader';
import { ResultCard } from '@/components/documents/ResultCard';
import { ButtonLink } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { ResultSkeleton } from '@/components/ui/Skeleton';
import { DataErrorState, EmptyState } from '@/components/ui/States';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useResource } from '@/hooks/useResource';
import { BrowseService, DocumentService } from '@/services';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

type ListSort = Exclude<SearchSort, 'relevance'>;

export default function DocumentsPage() {
  useDocumentTitle('Documents');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sort = (['date_desc', 'date_asc', 'title'].includes(params.get('sort') ?? '') ? params.get('sort') : 'date_desc') as ListSort;
  const collection = params.get('collection') as CategoryId | null;
  const categories = useResource('categories', BrowseService.categories);
  const list = useResource(`docs:${page}:${sort}:${collection}`, () =>
    DocumentService.list({ page, pageSize: 15, sort, filters: collection ? { categories: [collection] } : undefined }),
  );
  const shown = list.data ?? (list.loading ? list.previous : undefined);

  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    if (!('page' in next)) p.delete('page');
    setParams(p);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <PageHeader
        eyebrow="Archive"
        title="Documents"
        description="Every record in the archive, newest first. Each document has a permanent link you can share."
        actions={
          <ButtonLink to="/search" icon={<Search className="size-4" />}>
            Search documents
          </ButtonLink>
        }
      />
      <div className="container-page grid gap-8 py-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Collections" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <h2 className="eyebrow mb-2">Collection</h2>
          <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0 [scrollbar-width:thin]">
            <li>
              <button
                onClick={() => set({ collection: null })}
                aria-current={!collection ? 'true' : undefined}
                className={cn('w-full whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm', !collection ? 'bg-accent-soft font-medium text-accent-ink' : 'text-muted hover:bg-raised')}
              >
                All documents
              </button>
            </li>
            {categories.data
              ?.filter((c) => (c.documentCount ?? 1) > 0)
              .map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => set({ collection: c.id })}
                    aria-current={collection === c.id ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm',
                      collection === c.id ? 'bg-accent-soft font-medium text-accent-ink' : 'text-muted hover:bg-raised',
                    )}
                  >
                    {c.label}
                    {c.documentCount != null && <span className="text-xs tabular-nums text-subtle">{c.documentCount}</span>}
                  </button>
                </li>
              ))}
          </ul>
        </nav>
        <section aria-label="Documents" aria-busy={list.loading} className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">{shown ? `${formatNumber(shown.total)} documents` : 'Loading…'}</p>
            <label className="flex items-center gap-2 text-sm text-subtle">
              Sort
              <select value={sort} onChange={(e) => set({ sort: e.target.value })} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-fg">
                <option value="date_desc">Newest first</option>
                <option value="date_asc">Oldest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </label>
          </div>
          {list.error != null && <DataErrorState error={list.error} onRetry={list.reload} what="documents" />}
          {!shown && list.loading && <ResultSkeleton count={5} />}
          {shown && shown.total === 0 && <EmptyState title="No documents in this collection yet" />}
          {shown && (
            <div className={cn('space-y-3', list.loading && 'opacity-60')}>
              {shown.items.map((d) => (
                <ResultCard key={d.id} doc={d} />
              ))}
              <Pagination page={shown.page} pageSize={shown.pageSize} total={shown.total} onPage={(p) => set({ page: String(p) })} />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
