import { useId, useState } from 'react';
import type { FacetBucket, SearchFacets, SearchFilters } from '@/types/models';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

type ArrayKey = 'documentTypes' | 'categories' | 'years' | 'governmentBodyIds' | 'sourceIds';

function FacetGroup({
  title,
  buckets,
  selected,
  onToggle,
  limit = 6,
}: {
  title: string;
  buckets: FacetBucket[];
  selected: string[];
  onToggle: (value: string) => void;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  if (!buckets.length && !selected.length) return null;
  // Always show selected values, even if they have zero results under the current query.
  const all = [...buckets, ...selected.filter((s) => !buckets.some((b) => b.value === s)).map((s) => ({ value: s, label: s, count: 0 }))];
  const visible = expanded ? all : all.slice(0, limit);
  return (
    <fieldset className="border-b border-line py-4 first:pt-0 last:border-b-0">
      <legend className="eyebrow mb-2.5">{title}</legend>
      <ul className="space-y-0.5" id={id}>
        {visible.map((b) => {
          const checked = selected.includes(b.value);
          return (
            <li key={b.value}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-raised has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                <input type="checkbox" checked={checked} onChange={() => onToggle(b.value)} className="size-4 rounded accent-[var(--vtp-accent)]" />
                <span className={cn('min-w-0 flex-1 truncate', checked ? 'font-medium text-fg' : 'text-muted')}>{b.label}</span>
                <span className="text-xs tabular-nums text-subtle">{formatNumber(b.count)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {all.length > limit && (
        <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} aria-controls={id} className="mt-1.5 px-1.5 text-xs font-medium text-accent hover:underline">
          {expanded ? 'Show fewer' : `Show all ${all.length}`}
        </button>
      )}
    </fieldset>
  );
}

export function FilterPanel({ facets, filters, onChange }: { facets: SearchFacets | null; filters: SearchFilters; onChange: (f: SearchFilters) => void }) {
  const fromId = useId();
  const toId = useId();
  const toggle = (key: ArrayKey, value: string) => {
    const current = (filters[key] ?? []) as Array<string | number>;
    const typed = key === 'years' ? Number(value) : value;
    const next = current.includes(typed) ? current.filter((v) => v !== typed) : [...current, typed];
    onChange({ ...filters, [key]: next.length ? next : undefined });
  };
  const sel = (key: ArrayKey) => ((filters[key] ?? []) as Array<string | number>).map(String);

  return (
    <div>
      {!facets && <p className="text-sm text-subtle">Filters appear with results.</p>}
      {facets && (
        <>
          <FacetGroup title="Collection" buckets={facets.categories} selected={sel('categories')} onToggle={(v) => toggle('categories', v)} />
          <FacetGroup title="Document type" buckets={facets.documentTypes} selected={sel('documentTypes')} onToggle={(v) => toggle('documentTypes', v)} />
          <FacetGroup title="Year" buckets={facets.years} selected={sel('years')} onToggle={(v) => toggle('years', v)} />
          <FacetGroup title="Public body" buckets={facets.governmentBodies} selected={sel('governmentBodyIds')} onToggle={(v) => toggle('governmentBodyIds', v)} />
          <FacetGroup title="Record source" buckets={facets.sources} selected={sel('sourceIds')} onToggle={(v) => toggle('sourceIds', v)} />
        </>
      )}
      <fieldset className="pt-4">
        <legend className="eyebrow mb-2.5">Date range</legend>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={fromId} className="mb-1 block text-xs text-subtle">
              From
            </label>
            <input
              id={fromId}
              type="date"
              value={filters.dateFrom ?? ''}
              max={filters.dateTo}
              onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || undefined })}
              className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={toId} className="mb-1 block text-xs text-subtle">
              To
            </label>
            <input
              id={toId}
              type="date"
              value={filters.dateTo ?? ''}
              min={filters.dateFrom}
              onChange={(e) => onChange({ ...filters, dateTo: e.target.value || undefined })}
              className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm"
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}
