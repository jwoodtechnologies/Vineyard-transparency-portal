/** /services: every city form, portal, report and service the city links, as buttons by group. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, ClipboardList, CreditCard, Map as MapIcon, Phone, Search } from 'lucide-react';
import { Frame } from './Chrome';
import { Link } from 'react-router-dom';
import { DIRECTORY, DIRECTORY_GROUPS } from './directory';

const ICON = { form: ClipboardList, pay: CreditCard, call: Phone, mail: Phone, page: ArrowUpRight, map: MapIcon } as const;

export default function ServicesPage() {
  const [q, setQ] = useState('');
  useEffect(() => {
    document.title = 'City services | Vineyard Transparency Portal';
  }, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? DIRECTORY.filter((e) => `${e.label} ${e.hint ?? ''} ${e.group}`.toLowerCase().includes(t) || e.match.test(q)) : DIRECTORY;
  }, [q]);
  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">City services</h1>
        <p className="vc-page-sub">Forms, portals and reports from the city, grouped. Each opens the official city page or form.</p>
      </header>
      <form className="vc-rec-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <Search size={16} strokeWidth={1.9} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Records request, permits, jobs, fee schedule..." aria-label="Search city services" />
      </form>
      <div className="vc-svc">
        {DIRECTORY_GROUPS.map((g) => {
          const list = shown.filter((e) => e.group === g);
          if (!list.length) return null;
          return (
            <details key={`${g}:${q ? 'q' : ''}`} className="vc-svc-group" open={Boolean(q)}>
              <summary className="vc-svc-head">
                <span className="vc-svc-name">{g}</span>
                <span className="vc-svc-count">{list.length}</span>
                <ChevronDown size={16} strokeWidth={1.9} className="vc-svc-chev" />
              </summary>
              <ul className="vc-svc-list">
                {list.map((e) => {
                  const Icon = ICON[e.kind];
                  return (
                    <li key={e.id}>
                      <Link to={`/services/${e.id}`} className="vc-svc-row">
                        <span className="vc-svc-icon" data-kind={e.kind}>
                          <Icon size={14} strokeWidth={2} />
                        </span>
                        <span className="vc-svc-text">
                          <span className="vc-svc-label">{e.label}</span>
                          {e.hint && <span className="vc-svc-hint">{e.hint}</span>}
                        </span>
                        <ChevronRight size={15} strokeWidth={1.8} className="vc-svc-go" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </div>
    </Frame>
  );
}
