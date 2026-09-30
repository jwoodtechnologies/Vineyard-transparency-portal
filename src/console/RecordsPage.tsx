/** /records : every record in a category, newest first, with search inside the category. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, FileText, Search, X } from 'lucide-react';
import { Frame } from './Chrome';
import { getJson } from './api';
import { RECORD_CATEGORIES, categoryById } from './categories';
import { TYPE_LABEL, formatDate } from './format';

interface Row {
  id: string;
  title: string;
  documentType: string;
  date: string | null;
  pageCount: number | null;
  governmentBodyName: string | null;
  snippet?: string | null;
}

const PAGE = 30;

function toQuery(api: string[], q: string, page: number): string {
  const u = new URLSearchParams();
  for (const c of api) u.append('category', c);
  u.set('page', String(page));
  u.set('pageSize', String(PAGE));
  if (q) {
    u.set('q', q);
    u.set('match', 'all');
    return `/api/search?${u}`;
  }
  u.set('sort', 'date_desc');
  return `/api/documents?${u}`;
}

type Resp = { items: Array<Record<string, unknown>>; total?: number; totalCount?: number };

function rowsOf(r: Resp, searching: boolean): Row[] {
  return (r.items ?? []).map((it) => {
    const d = (searching ? it.document : it) as Record<string, unknown>;
    const ex = searching ? ((it.excerpts as Array<{ text?: string }> | undefined)?.[0]?.text ?? null) : null;
    return {
      id: String(d.id),
      title: String(d.title),
      documentType: String(d.documentType ?? 'other'),
      date: (d.date as string | null) ?? null,
      pageCount: (d.pageCount as number | null) ?? null,
      governmentBodyName: (d.governmentBodyName as string | null) ?? null,
      snippet: ex ? ex.replace(/\s+/g, ' ').slice(0, 200) : null,
    };
  });
}

export default function RecordsPage() {
  const [params, setParams] = useSearchParams();
  const cat = categoryById(params.get('c'));
  const q = (params.get('q') ?? '').trim();
  const [draft, setDraft] = useState(q);
  const [pages, setPages] = useState(1);
  const [state, setState] = useState<{ key: string; rows: Row[]; total: number; status: 'loading' | 'done' | 'error' }>({ key: '', rows: [], total: 0, status: 'loading' });

  const api = useMemo(() => cat?.api ?? RECORD_CATEGORIES.flatMap((c) => c.api), [cat]);
  const key = `${api.join(',')}|${q}|${pages}`;

  useEffect(() => {
    document.title = `${cat?.label ?? 'All records'} | Vineyard Transparency Portal`;
  }, [cat]);

  useEffect(() => {
    let live = true;
    Promise.all(Array.from({ length: pages }, (_, i) => getJson<Resp>(toQuery(api, q, i + 1)))).then(
      (list) => {
        if (!live) return;
        const rows = list.flatMap((r) => rowsOf(r, Boolean(q)));
        const total = Number(list[0]?.total ?? list[0]?.totalCount ?? rows.length);
        setState({ key, rows, total, status: 'done' });
      },
      () => live && setState({ key, rows: [], total: 0, status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [api, q, pages, key]);

  const loading = state.key !== key;
  const pick = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('c', id);
    else next.delete('c');
    setParams(next, { replace: true });
    setPages(1);
  };
  const submit = (value: string) => {
    const next = new URLSearchParams(params);
    if (value.trim()) next.set('q', value.trim());
    else next.delete('q');
    setParams(next, { replace: true });
    setPages(1);
  };

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">{cat?.label ?? 'All records'}</h1>
        <p className="vc-page-sub">{cat?.blurb ?? 'Agendas, minutes, budgets, ordinances, plans and more from Vineyard City.'}</p>
      </header>

      <div className="vc-filters vc-body-chips vc-latest-tabs" role="tablist" aria-label="Category">
        <button type="button" role="tab" aria-selected={!cat} className="vc-chip" data-active={!cat} onClick={() => pick(null)}>
          All
        </button>
        {RECORD_CATEGORIES.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={cat?.id === c.id} className="vc-chip" data-active={cat?.id === c.id} onClick={() => pick(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <form
        className="vc-rec-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <Search size={16} strokeWidth={1.9} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Search ${cat ? cat.label.toLowerCase() : 'all records'}`} aria-label="Search these records" enterKeyHint="search" />
        {draft && (
          <button
            type="button"
            className="vc-map-x"
            aria-label="Clear"
            onClick={() => {
              setDraft('');
              submit('');
            }}
          >
            <X size={15} />
          </button>
        )}
      </form>

      {!loading && state.status === 'done' && (
        <p className="vc-mdocs-count">
          {state.total.toLocaleString()} {state.total === 1 ? 'record' : 'records'}
          {q ? ` matching “${q}”` : ''}
        </p>
      )}

      {loading && state.rows.length === 0 ? (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '94%' }} />
          <span style={{ width: '82%' }} />
          <span style={{ width: '88%' }} />
        </div>
      ) : state.status === 'error' ? (
        <div className="vc-empty">These records could not be loaded. Try again in a moment.</div>
      ) : state.rows.length === 0 ? (
        <div className="vc-empty">{q ? 'No records in this category match that search.' : 'No records in this category yet.'}</div>
      ) : (
        <ul className="vc-mdocs">
          {state.rows.map((d) => (
            <li key={d.id}>
              <Link to={`/documents/${encodeURIComponent(d.id)}${q ? `?q=${encodeURIComponent(q)}` : ''}`} className="vc-mdoc">
                <span className="vc-mdoc-icon" data-kind={['agenda', 'agenda_packet', 'minutes'].includes(d.documentType) ? d.documentType : 'other'}>
                  <FileText size={15} strokeWidth={1.8} />
                </span>
                <span className="vc-mdoc-main">
                  <span className="vc-mdoc-title">{d.title}</span>
                  <span className="vc-mdoc-meta">{[TYPE_LABEL[d.documentType as keyof typeof TYPE_LABEL] ?? 'Record', d.governmentBodyName, formatDate(d.date)].filter(Boolean).join(' · ')}</span>
                  {d.snippet && <span className="vc-rec-snippet">{d.snippet}</span>}
                </span>
                <ChevronRight size={16} className="vc-mdoc-go" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && state.rows.length < state.total && (
        <div className="vc-rec-more">
          <button type="button" className="vc-secondary" onClick={() => setPages((p) => p + 1)}>
            Show more
          </button>
        </div>
      )}
    </Frame>
  );
}
