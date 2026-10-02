/**
 * The "Past budgets" view of /budget: every budget, audit and budget resolution the archive holds, grouped by
 * fiscal year (back to 1991), with a search box. Each row opens the real PDF in a new tab.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, FileText, Search } from 'lucide-react';
import type { DocumentSummary } from '@/types/models';
import { useJson } from './api';
import { NEW_TAB, isPdf, pdfHref } from './files';
import { TYPE_LABEL, formatDate } from './format';
import { cleanTitle, fiscalYearOf } from './budget';

interface Archive {
  items: DocumentSummary[];
  total: number;
}

interface Group {
  fy: number;
  docs: DocumentSummary[];
}

const DECADES = [
  { id: '2020', label: '2020s' },
  { id: '2010', label: '2010s' },
  { id: '2000', label: '2000s' },
  { id: '1990', label: '1990s' },
] as const;

function Row({ d }: { d: DocumentSummary }) {
  const meta = [TYPE_LABEL[d.documentType] ?? 'Record', formatDate(d.date) ?? (d.year ? String(d.year) : null), d.pageCount ? `${d.pageCount} ${d.pageCount === 1 ? 'page' : 'pages'}` : null].filter(Boolean).join(' · ');
  const body = (
    <>
      <FileText size={15} strokeWidth={1.8} className="vc-bud-doc-ic" />
      <span className="vc-bud-doc-main">
        <span className="vc-bud-doc-title">{cleanTitle(d.title)}</span>
        <span className="vc-bud-doc-meta">{meta}</span>
      </span>
      <ArrowUpRight size={14} strokeWidth={1.8} className="vc-bud-doc-go" />
    </>
  );
  // A PDF opens as the PDF itself. Anything that is not a file (a web page, a code section) opens in the portal.
  return isPdf(d.mimeType) ? (
    <a className="vc-bud-doc" href={pdfHref(d.id)} {...NEW_TAB}>
      {body}
    </a>
  ) : (
    <Link className="vc-bud-doc" to={`/documents/${encodeURIComponent(d.id)}`}>
      {body}
    </Link>
  );
}

export default function BudgetArchive() {
  const load = useJson<Archive>('/api/budget/archive');
  const [q, setQ] = useState('');
  const [decade, setDecade] = useState<string | null>(null);
  // null: only the newest year is open. After the first tap it is the exact set the reader opened.
  const [open, setOpen] = useState<Set<number> | null>(null);

  const groups: Group[] = useMemo(() => {
    if (load.status !== 'done') return [];
    const needle = q.trim().toLowerCase();
    const words = needle.split(/\s+/).filter(Boolean);
    const by = new Map<number, DocumentSummary[]>();
    for (const d of load.data.items) {
      const fy = fiscalYearOf(d) ?? 0; // 0: the record states no year
      if (decade && Math.floor(fy / 10) * 10 !== Number(decade)) continue;
      const hay = `${d.title} ${TYPE_LABEL[d.documentType] ?? ''} ${fy || ''} ${d.year ?? ''} ${d.date ?? ''}`.toLowerCase();
      if (words.length && !words.every((w) => hay.includes(w) || (/^fy\d{2}$/.test(w) && fy % 100 === Number(w.slice(2))))) continue;
      const list = by.get(fy) ?? [];
      list.push(d);
      by.set(fy, list);
    }
    return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([fy, docs]) => ({ fy, docs }));
  }, [load, q, decade]);

  const searching = q.trim().length > 0;
  const shown = groups.reduce((n, g) => n + g.docs.length, 0);
  const newest = groups.find((g) => g.fy > 0)?.fy ?? groups[0]?.fy;
  const isOpen = (g: Group) => searching || decade != null || (open ? open.has(g.fy) : g.fy === newest);
  const toggle = (g: Group) =>
    setOpen((cur) => {
      const next = new Set(cur ?? (newest != null ? [newest] : []));
      if (next.has(g.fy)) next.delete(g.fy);
      else next.add(g.fy);
      return next;
    });

  return (
    <div className="vc-bud-arch">
      <p className="vc-bud-lede">
        Adopted budgets, budget resolutions, audits and financial reports, by fiscal year. A fiscal year runs July 1 to June 30 and is named for the year it ends, so fiscal 2027 ends June 30, 2027. Each one opens the original PDF.
      </p>

      <form className="vc-rec-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <Search size={16} strokeWidth={1.9} />
        <input type="search" placeholder="Search by year or word: 2018, audit, tax rate" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search past budgets" />
      </form>

      <div className="vc-bud-chips" role="group" aria-label="Filter by decade">
        <button type="button" className="vc-chip" data-active={decade == null} onClick={() => setDecade(null)}>
          All years
        </button>
        {DECADES.map((d) => (
          <button key={d.id} type="button" className="vc-chip" data-active={decade === d.id} onClick={() => setDecade((c) => (c === d.id ? null : d.id))}>
            {d.label}
          </button>
        ))}
      </div>

      {load.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '88%' }} />
          <span style={{ width: '72%' }} />
          <span style={{ width: '80%' }} />
        </div>
      )}
      {load.status === 'error' && <div className="vc-empty">The past budgets could not be loaded right now. Try again in a moment.</div>}

      {load.status === 'done' && (
        <>
          <p className="vc-bud-total">
            {shown === 0 ? 'Nothing matches.' : (
              <>
                <b>{shown}</b> {shown === 1 ? 'document' : 'documents'} across <b>{groups.filter((g) => g.fy > 0).length}</b> fiscal {groups.filter((g) => g.fy > 0).length === 1 ? 'year' : 'years'}
              </>
            )}
          </p>
          <ul className="vc-bud-years">
            {groups.map((g) => {
              const on = isOpen(g);
              return (
                <li key={g.fy} data-open={on}>
                  <button type="button" className="vc-bud-row vc-bud-fy" aria-expanded={on} onClick={() => toggle(g)}>
                    <span className="vc-bud-row-name">{g.fy ? `Fiscal year ${g.fy}` : 'Year not stated'}</span>
                    <span className="vc-bud-row-amt">
                      {g.docs.length} {g.docs.length === 1 ? 'file' : 'files'}
                    </span>
                    <ChevronDown size={15} strokeWidth={1.8} className="vc-bud-chev" />
                  </button>
                  {on && (
                    <ul className="vc-bud-docs">
                      {g.docs.map((d) => (
                        <li key={d.id}>
                          <Row d={d} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="vc-bud-fine">
            Not finding it? <Link to={`/records?c=finance${searching ? `&q=${encodeURIComponent(q.trim())}` : ''}`}>Search every budget and finance record</Link> or{' '}
            <Link to={`/?q=${encodeURIComponent(searching ? `${q.trim()} budget` : 'What did the city adopt for its budget in earlier years?')}`}>ask the portal</Link>.
          </p>
        </>
      )}
    </div>
  );
}
