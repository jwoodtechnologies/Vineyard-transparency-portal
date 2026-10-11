/**
 * The city's Construction Projects page as last stored by the portal's five-minute check: the
 * page's own "at a glance" table, its documents and full text, with the date it was read.
 * Nothing here is typed by hand; every value is the city's.
 */
import { ArrowUpRight, ChevronDown, FileText } from 'lucide-react';
import { useJson } from './api';
import { formatDate, formatDateTime, normalizeDatesInText } from '@/lib/dates';

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
  documents?: Array<{ url: string; label: string; group?: string | null }>;
  versions?: Array<{ retrievedAt: string }>;
}

const fmt = (iso: string, withTime = false) => (withTime ? formatDateTime(iso) : formatDate(iso));

/** The city's heading in sentence case with its date in the one format: "At a glance: updated Oct 5, 2026". */
const tidyHeading = (h: string) => normalizeDatesInText(h === h.toUpperCase() ? h.charAt(0) + h.slice(1).toLowerCase() : h);

function groupDocs(docs: NonNullable<ConstructionSnapshot['documents']>): Array<[string | null, typeof docs]> {
  const out = new Map<string | null, typeof docs>();
  for (const d of docs) out.set(d.group ?? null, [...(out.get(d.group ?? null) ?? []), d]);
  return [...out.entries()];
}

/**
 * The whole "City construction page" section. It is not shown at all until a readable copy exists:
 * the portal never shows an empty section.
 */
export function CitySnapshot({ cityPage, data }: { cityPage: string; /** Already loaded with the page's own response; undefined loads it here. */ data?: ConstructionSnapshot | null }) {
  const load = useJson<ConstructionSnapshot>(data === undefined ? '/api/construction' : null);
  const s = data !== undefined ? data : load.status === 'done' ? load.data : null;
  if (!s || !s.available || !s.asOf) return null;
  const g = s.glance;
  return (
    <section className="vc-latest-sec">
      <div className="vc-latest-sec-head">
        <h2>City construction page</h2>
        <a className="vc-latest-more" href={s.sourceUrl || cityPage} target="_blank" rel="noopener noreferrer">
          City&apos;s page <ArrowUpRight size={12} strokeWidth={2} />
        </a>
      </div>
    <div className="vc-snap">
      <p className="vc-cp-asof">
        As of {fmt(s.asOf as string)}
        {s.lastCheckedAt ? <span className="vc-snap-checked">Checked {fmt(s.lastCheckedAt, true)}</span> : null}
      </p>
      {g && g.rows.length > 0 ? (
        <>
          {g.heading && <h3 className="vc-snap-h">{tidyHeading(g.heading)}</h3>}
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
                        {/^status$/i.test(h.trim()) && r[h] ? <span className="vc-tag">{r[h]}</span> : normalizeDatesInText(r[h] || '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        null
      )}
      {s.documents && s.documents.length > 0 && (
        <details className="vc-cp-docs" open={!g || !g.rows.length}>
          <summary>
            <FileText size={15} strokeWidth={1.8} /> City documents <span>{s.documents.length}</span>
            <ChevronDown size={15} strokeWidth={1.9} className="vc-cp-docs-chev" />
          </summary>
          {groupDocs(s.documents).map(([group, docs]) => (
            <div key={group ?? 'other'} className="vc-snap-group">
              {group && <h4 className="vc-snap-h">{group}</h4>}
              <ul>
                {docs.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.label} <ArrowUpRight size={13} strokeWidth={1.9} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
              <p key={i}>{normalizeDatesInText(line)}</p>
            ))}
          </div>
        </details>
      )}
      {s.versions && s.versions.length > 1 && <p className="vc-cp-fine">{s.versions.length} stored versions of this page. Each change is kept with the time it was read.</p>}
    </div>
    </section>
  );
}
