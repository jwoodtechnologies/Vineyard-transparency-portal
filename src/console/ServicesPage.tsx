/** /services: every city form, portal, report and service the city links, as buttons by group. */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, ClipboardList, CreditCard, Map as MapIcon, Phone, Search } from 'lucide-react';
import { Frame } from './Chrome';
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
        <p className="vc-page-sub">Every form, portal and report the city links from its Transparency Portal. Each button opens the official city page or form.</p>
      </header>
      <form className="vc-rec-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <Search size={16} strokeWidth={1.9} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Records request, permits, jobs, fee schedule..." aria-label="Search city services" />
      </form>
      {DIRECTORY_GROUPS.map((g) => {
        const list = shown.filter((e) => e.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className="vc-rec-group">
            <h2 className="vc-rec-month">{g}</h2>
            <div className="vc-quick vc-services">
              {list.map((e) => {
                const Icon = ICON[e.kind];
                return (
                  <a key={e.id} href={e.href} className="vc-quick-item" target="_blank" rel="noopener noreferrer">
                    <span className="vc-quick-icon" data-kind={e.kind}>
                      <Icon size={14} strokeWidth={2} />
                    </span>
                    <span className="vc-quick-text">
                      <span className="vc-quick-label">{e.label}</span>
                      {e.hint && <span className="vc-quick-hint">{e.hint}</span>}
                    </span>
                  </a>
                );
              })}
            </div>
          </section>
        );
      })}
    </Frame>
  );
}
