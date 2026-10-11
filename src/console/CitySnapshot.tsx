/**
 * The city's Construction Projects page as last stored by the portal's five-minute check: the
 * page's own "at a glance" table, its documents and full text, with the date it was read.
 * Nothing here is typed by hand; every value is the city's.
 */
import { ArrowUpRight, ChevronDown, FileText } from 'lucide-react';
import { useJson } from './api';

interface Glance {
  heading: string | null;
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface ConstructionSnapshot {
  available: boolean;
  sourceUrl: string;
  asOf?: string;
  lastCheckedAt?: string | null;
  heading?: string | null;
  glance?: Glance | null;
  text?: string;
  documents?: Array<{ url: string; label: string }>;
  versions?: Array<{ retrievedAt: string }>;
}

const fmt = (iso: string, withTime = false) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(iso));

export function CitySnapshot() {
  const load = useJson<ConstructionSnapshot>('/api/construction');
  if (load.status === 'loading') return <p className="vc-cp-lede">Loading the city&apos;s page.</p>;
  if (load.status === 'error') return <p className="vc-cp-lede">The stored copy of the city&apos;s page did not load. Reload to try again.</p>;
  const s = load.data;
  if (!s.available || !s.asOf) {
    return (
      <p className="vc-cp-lede">
        Not read yet.{' '}
        <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
          City&apos;s page
        </a>
      </p>
    );
  }
  const g = s.glance;
  return (
    <div className="vc-snap">
      <p className="vc-cp-asof">
        As of {fmt(s.asOf)}
        {s.lastCheckedAt ? <span className="vc-snap-checked">Checked {fmt(s.lastCheckedAt, true)}</span> : null}
      </p>
      {g && g.rows.length > 0 ? (
        <>
          {g.heading && <h3 className="vc-snap-h">{g.heading}</h3>}
          <div className="vc-snap-table-wrap">
            <table className="vc-snap-table">
              <thead>
                <tr>
                  {g.headers.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i}>
                    {g.headers.map((h, j) => (
                      <td key={h} data-label={h} data-first={j === 0 || undefined}>
                        {r[h] || ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="vc-cp-lede">The city&apos;s page has no project table.</p>
      )}
      {s.documents && s.documents.length > 0 && (
        <details className="vc-cp-docs">
          <summary>
            <FileText size={15} strokeWidth={1.8} /> City documents <span>{s.documents.length}</span>
            <ChevronDown size={15} strokeWidth={1.9} className="vc-cp-docs-chev" />
          </summary>
          <ul>
            {s.documents.map((d) => (
              <li key={d.url}>
                <a href={d.url} target="_blank" rel="noopener noreferrer">
                  {d.label} <ArrowUpRight size={13} strokeWidth={1.9} />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.text && (
        <details className="vc-cp-docs">
          <summary>
            Full page text
            <ChevronDown size={15} strokeWidth={1.9} className="vc-cp-docs-chev" />
          </summary>
          <div className="vc-snap-text">
            {s.text.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </details>
      )}
      {s.versions && s.versions.length > 1 && <p className="vc-cp-fine">{s.versions.length} stored versions of this page. Each change is kept with the time it was read.</p>}
    </div>
  );
}
