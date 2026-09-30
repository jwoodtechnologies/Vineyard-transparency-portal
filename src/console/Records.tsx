import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { DocumentType, FacetBucket, SearchFilters, SearchResult, SearchSort } from '@/types/models';
import { docHref } from '@/lib/routes';
import type { Turn } from './types';
import { TYPE_LABEL, formatDate } from './format';
import { Highlighted } from './Highlighted';

interface MenuProps {
  label: string;
  value: string | null;
  options: FacetBucket[];
  onPick: (value: string | null) => void;
  showCounts?: boolean;
}

function FilterMenu({ label, value, options, onPick, showCounts = true }: MenuProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const current = options.find((o) => o.value === value);
  if (!options.length && !value) return null;
  return (
    <div className="vc-filter" ref={box}>
      <button type="button" className="vc-chip" data-active={Boolean(value)} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {current ? current.label : label}
        <ChevronDown size={14} strokeWidth={2} />
      </button>
      {open && (
        <div className="vc-menu" role="listbox" aria-label={label}>
          <button type="button" className="vc-option" role="option" aria-selected={!value} data-selected={!value} onClick={() => (onPick(null), setOpen(false))}>
            <span className="vc-option-check">{!value && <Check size={14} strokeWidth={2.4} />}</span>
            Any {label.toLowerCase()}
          </button>
          {options.map((o) => (
            <button key={o.value} type="button" className="vc-option" role="option" aria-selected={o.value === value} data-selected={o.value === value} onClick={() => (onPick(o.value), setOpen(false))}>
              <span className="vc-option-check">{o.value === value && <Check size={14} strokeWidth={2.4} />}</span>
              {o.label}
              {showCounts && <span className="vc-option-count">{o.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SORTS: FacetBucket[] = [
  { value: 'relevance', label: 'Most relevant', count: 0 },
  { value: 'date_desc', label: 'Newest first', count: 0 },
  { value: 'date_asc', label: 'Oldest first', count: 0 },
];

interface Props {
  turn: Turn;
  onFilters: (filters: SearchFilters, sort: SearchSort) => void;
  onMore: () => void;
  onPreview: (r: SearchResult) => void;
  onHide?: () => void;
  /** Documents already shown as the answer's sources. */
  exclude?: Set<string>;
  title?: string;
}

export function Records({ turn, onFilters, onMore, onPreview, onHide, exclude, title = 'Records' }: Props) {
  const r = turn.records;
  const f = turn.filters;
  const facets = r?.facets;
  const type = f.documentTypes?.[0] ?? null;
  const year = f.years?.[0] != null ? String(f.years[0]) : null;
  const body = f.governmentBodyIds?.[0] ?? null;
  const active = Boolean(type || year || body);

  const items = (r?.items ?? []).filter((i) => !exclude?.has(i.document.id));
  if (turn.recordsStatus === 'idle') return null;
  if (turn.recordsStatus === 'done' && r && r.total === 0 && !active) return null;

  const set = (next: Partial<{ type: string | null; year: string | null; body: string | null }>) => {
    const t = next.type !== undefined ? next.type : type;
    const y = next.year !== undefined ? next.year : year;
    const b = next.body !== undefined ? next.body : body;
    onFilters({ ...(t ? { documentTypes: [t as DocumentType] } : {}), ...(y ? { years: [Number(y)] } : {}), ...(b ? { governmentBodyIds: [b] } : {}) }, turn.sort);
  };

  return (
    <section className="vc-records" aria-label="Matching records">
      <div className="vc-records-head">
        <p className="vc-label" style={{ margin: 0 }}>
          {title}
        </p>
        <div className="vc-filters">
          <FilterMenu label="Type" value={type} options={facets?.documentTypes ?? []} onPick={(v) => set({ type: v })} />
          <FilterMenu label="Year" value={year} options={facets?.years ?? []} onPick={(v) => set({ year: v })} />
          <FilterMenu label="Body" value={body} options={facets?.governmentBodies ?? []} onPick={(v) => set({ body: v })} />
          <FilterMenu label="Sort" value={turn.sort === 'relevance' ? null : turn.sort} options={SORTS.slice(1)} showCounts={false} onPick={(v) => onFilters(turn.filters, (v ?? 'relevance') as SearchSort)} />
          {active && (
            <button type="button" className="vc-chip vc-chip-clear" onClick={() => onFilters({}, turn.sort)}>
              <X size={13} strokeWidth={2.2} /> Clear
            </button>
          )}
          {onHide && (
            <button type="button" className="vc-chip vc-chip-hide" onClick={onHide} aria-label="Hide records">
              <ChevronUp size={14} strokeWidth={2} /> Hide
            </button>
          )}
        </div>
      </div>

      {turn.recordsStatus === 'loading' && !r && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '92%' }} />
          <span style={{ width: '78%' }} />
          <span style={{ width: '85%' }} />
        </div>
      )}
      {turn.recordsStatus === 'error' && <div className="vc-empty">The record search is unavailable right now.</div>}
      {r && items.length === 0 && <div className="vc-empty">No records match these filters.</div>}

      {r && items.length > 0 && (
        <div className="vc-results" style={{ opacity: turn.recordsStatus === 'loading' ? 0.55 : 1, transition: 'opacity .2s' }}>
          {items.map((item, i) => {
            const ex = item.excerpts[0];
            const d = item.document;
            return (
              <Link
                key={d.id}
                to={docHref(d, ex?.page ?? null, turn.question)}
                className="vc-result"
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onPreview(item);
                }}
              >
                <div className="vc-result-meta">
                  <span className="vc-type">{TYPE_LABEL[d.documentType] ?? 'Record'}</span>
                  {formatDate(d.date) && (
                    <>
                      <span className="vc-dot" />
                      <span>{formatDate(d.date)}</span>
                    </>
                  )}
                  {d.governmentBodyName && (
                    <>
                      <span className="vc-dot" />
                      <span>{d.governmentBodyName}</span>
                    </>
                  )}
                </div>
                <h3 className="vc-result-title">{d.title}</h3>
                {ex && (
                  <p className="vc-excerpt">
                    <Highlighted text={ex.text} ranges={ex.highlights} />
                  </p>
                )}
                <div className="vc-result-foot">
                  {ex?.page != null && <span className="vc-tag">Page {ex.page}</span>}
                  {d.pageCount != null && <span className="vc-tag">{d.pageCount} pages</span>}
                  <span className="vc-tag">
                    <Archive size={11} strokeWidth={2} /> Archived
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {r && r.items.length < r.total && (
        <div className="vc-more">
          <button type="button" className="vc-secondary" onClick={onMore} disabled={turn.recordsStatus === 'loading'}>
            Show more records
          </button>
        </div>
      )}
    </section>
  );
}
