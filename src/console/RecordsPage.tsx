/**
 * /records : every record, filtered. Opens with the category from the home tile already selected
 * (?c=meetings), then narrows by record type, year, meeting body and search. All matching records
 * load as you scroll, newest first, grouped by month.
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, FileText, Search, X } from 'lucide-react';
import { Frame } from './Chrome';
import { getJson, useJson } from './api';
import { RECORD_CATEGORIES, categoryById } from './categories';
import { TYPE_LABEL, formatDate } from './format';

interface Row {
  id: string;
  title: string;
  documentType: string;
  date: string | null;
  governmentBodyName: string | null;
  snippet?: string | null;
}

interface Bucket {
  value: string;
  label: string;
  count: number;
}
interface Facets {
  years: Bucket[];
  documentTypes: Bucket[];
  governmentBodies: Bucket[];
}

const PAGE = 100;
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
      governmentBodyName: (d.governmentBodyName as string | null) ?? null,
      snippet: ex ? ex.replace(/\s+/g, ' ').slice(0, 200) : null,
    };
  });
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthOf = (d: string | null) => (d && /^\d{4}-\d{2}/.test(d) ? MONTH.format(new Date(`${d.slice(0, 7)}-01T00:00:00Z`)) : 'Undated');

function RecordList({ rows, q, grouped }: { rows: Row[]; q: string; grouped: boolean }) {
  const groups: Array<{ label: string; rows: Row[] }> = [];
  for (const r of rows) {
    const label = grouped ? monthOf(r.date) : '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else groups.push({ label, rows: [r] });
  }
  return (
    <>
      {groups.map((g, i) => (
        <section key={`${g.label}-${i}`} className="vc-rec-group">
          {g.label && <h2 className="vc-rec-month">{g.label}</h2>}
          <ul className="vc-mdocs">
            {g.rows.map((d) => (
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
        </section>
      ))}
    </>
  );
}

/** Meeting packets and other records that discuss the category's subject. */
function TopicRecords({ topics, exclude }: { topics: string; exclude: Set<string> }) {
  const [state, setState] = useState<{ key: string; rows: Row[] }>({ key: '', rows: [] });
  useEffect(() => {
    let live = true;
    const u = new URLSearchParams({ q: topics, match: 'any', page: '1', pageSize: '50', sort: 'date_desc' });
    getJson<Resp>(`/api/search?${u}`).then(
      (r) => live && setState({ key: topics, rows: rowsOf(r, true) }),
      () => live && setState({ key: topics, rows: [] }),
    );
    return () => {
      live = false;
    };
  }, [topics]);
  const rows = state.rows.filter((r) => !exclude.has(r.id));
  if (!rows.length) return null;
  return (
    <section className="vc-rec-topic">
      <h2 className="vc-rec-topic-title">Also discussed in meeting records</h2>
      <RecordList rows={rows} q="" grouped={false} />
    </section>
  );
}

export default function RecordsPage() {
  const [params, setParams] = useSearchParams();
  const cat = categoryById(params.get('c'));
  const q = (params.get('q') ?? '').trim();
  const typesKey = (params.get('t') ?? '')
    .split(',')
    .filter((t) => cat?.types.some((x) => x.id === t))
    .join(',');
  const types = useMemo(() => typesKey.split(',').filter(Boolean), [typesKey]);
  const year = params.get('y') ?? '';
  const body = params.get('b') ?? '';
  const sort = params.get('s') === 'old' ? 'date_asc' : params.get('s') === 'az' ? 'title' : 'date_desc';
  const [draft, setDraft] = useState(q);
  const [pages, setPages] = useState(1);
  const facets = useJson<Facets>('/api/browse/facets');

  const query = useMemo(() => {
    const u = new URLSearchParams();
    if (types.length) types.forEach((t) => u.append('type', t));
    else (cat?.types ?? []).forEach((t) => u.append('type', t.id));
    if (year) u.set('year', year);
    if (body) u.set('body', body);
    u.set('sort', sort);
    if (q) {
      u.set('q', q);
      u.set('match', 'all');
    }
    return u.toString();
  }, [cat, types, year, body, sort, q]);
  const key = `${query}|${pages}`;
  const [state, setState] = useState<{ key: string; rows: Row[]; total: number; status: 'done' | 'error' }>({ key: '', rows: [], total: 0, status: 'done' });

  useEffect(() => {
    document.title = `${cat?.label ?? 'All records'} | Vineyard Transparency Portal`;
  }, [cat]);

  useEffect(() => {
    let live = true;
    const url = (page: number) => `${q ? '/api/search' : '/api/documents'}?${query}&page=${page}&pageSize=${PAGE}`;
    Promise.all(Array.from({ length: pages }, (_, i) => getJson<Resp>(url(i + 1)))).then(
      (list) => {
        if (!live) return;
        const seen = new Set<string>();
        const rows = list.flatMap((r) => rowsOf(r, Boolean(q))).filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
        setState({ key, rows, total: Number(list[0]?.total ?? list[0]?.totalCount ?? rows.length), status: 'done' });
      },
      () => live && setState({ key, rows: [], total: 0, status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [query, pages, key, q]);

  const loading = state.key !== key;
  const more = !loading && state.rows.length < state.total;

  // Keep loading as the reader nears the end of the list, until every record is shown.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    let asked = false;
    const check = () => {
      const el = sentinel.current;
      if (asked || !el) return;
      if (el.getBoundingClientRect().top < window.innerHeight + 900) {
        asked = true;
        setPages((p) => p + 1);
      }
    };
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    const t = setTimeout(check, 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [more, state.rows.length]);

  const update = (patch: Record<string, string | null>, keepTypes = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!keepTypes) next.delete('t');
    setParams(next, { replace: true });
    setPages(1);
  };
  const toggleType = (id: string) => {
    const set = new Set(types);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ t: [...set].join(',') || null });
  };

  const typeCount = new Map((facets.status === 'done' ? facets.data.documentTypes : []).map((b) => [b.value, b.count]));
  const years = facets.status === 'done' ? facets.data.years : [];
  const bodies = facets.status === 'done' ? facets.data.governmentBodies : [];
  const filtered = Boolean(types.length || year || body || q);

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">{cat?.label ?? 'All records'}</h1>
        <p className="vc-page-sub">{cat?.blurb ?? 'Every record in the archive. Pick a category or narrow by type, year and meeting body.'}</p>
      </header>

      <div className="vc-filters vc-body-chips vc-latest-tabs" role="tablist" aria-label="Category">
        <button type="button" role="tab" aria-selected={!cat} className="vc-chip" data-active={!cat} onClick={() => update({ c: null }, false)}>
          All records
        </button>
        {RECORD_CATEGORIES.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={cat?.id === c.id} className="vc-chip" data-active={cat?.id === c.id} onClick={() => update({ c: c.id }, false)}>
            {c.label}
          </button>
        ))}
      </div>

      <form
        className="vc-rec-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() || null });
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
              update({ q: null });
            }}
          >
            <X size={15} />
          </button>
        )}
      </form>

      <div className="vc-rec-filters">
        {cat && (
          <div className="vc-rec-types" role="group" aria-label="Record type">
            {cat.types.map((t) => (
              <button key={t.id} type="button" className="vc-rec-type" data-active={types.includes(t.id)} aria-pressed={types.includes(t.id)} onClick={() => toggleType(t.id)}>
                {t.label}
                {typeCount.get(t.id) ? <span className="vc-rec-type-n">{typeCount.get(t.id)}</span> : null}
              </button>
            ))}
          </div>
        )}
        <div className="vc-rec-selects">
          <label className="vc-rec-select">
            <span>Year</span>
            <select value={year} onChange={(e) => update({ y: e.target.value || null })}>
              <option value="">All years</option>
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </select>
          </label>
          <label className="vc-rec-select">
            <span>Body</span>
            <select value={body} onChange={(e) => update({ b: e.target.value || null })}>
              <option value="">All bodies</option>
              {bodies.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="vc-rec-select">
            <span>Sort</span>
            <select value={params.get('s') ?? ''} onChange={(e) => update({ s: e.target.value || null })}>
              <option value="">Newest first</option>
              <option value="old">Oldest first</option>
              <option value="az">Title A to Z</option>
            </select>
          </label>
          {filtered && (
            <button type="button" className="vc-rec-reset" onClick={() => { setDraft(''); update({ t: null, y: null, b: null, q: null, s: null }); }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

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
        cat?.topics && !filtered ? null : <div className="vc-empty">No records match these filters.</div>
      ) : (
        <RecordList rows={state.rows} q={q} grouped={sort !== 'title'} />
      )}

      {more && (
        <div ref={sentinel} className="vc-rec-more">
          <button type="button" className="vc-secondary" onClick={() => setPages((p) => p + 1)}>
            Show more ({(state.total - state.rows.length).toLocaleString()} left)
          </button>
        </div>
      )}

      {!filtered && cat?.topics && !loading && state.status === 'done' && !more && <TopicRecords key={cat.id} topics={cat.topics} exclude={new Set(state.rows.map((r) => r.id))} />}
    </Frame>
  );
}
