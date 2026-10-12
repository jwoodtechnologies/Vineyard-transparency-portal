/**
 * Sources: every public system the portal reads, what it covers, when it was last checked and when
 * a new record last arrived from it. One edge-cached request (/api/sources).
 */
import './styles';
import { ExternalLink } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { formatDate } from './format';
import type { SourceRegistryEntry } from '@/types/models';
import { MAP_ONLY, sourceRows } from './sources';
import { Link } from 'react-router-dom';
import { ErrorNote } from './ErrorNote';

const STATUS_LABEL: Record<string, string> = {
  active: 'Working',
  degraded: 'Partly working',
  unreachable: 'Not reachable at last check',
  changed: 'Site changed',
  authentication_required: 'Needs a login, not read',
  blocked: 'Not allowed by the site, not read',
  unknown: 'Not checked yet',
};

function SourceCard({ s }: { s: SourceRegistryEntry }) {
  const status = s.health?.status ?? 'unknown';
  const checked = formatDate(s.health?.lastCheckedAt ?? s.lastChecked);
  const newest = formatDate(s.lastNewRecordAt ?? null);
  return (
    <section className="vc-board">
      <div className="vc-board-head" style={{ cursor: 'default' }}>
        <span className="vc-board-title">
          <span className="vc-board-name">{s.name}</span>
          <span className="vc-board-sub">
            {s.authority}
            {status !== 'active' ? ` · ${STATUS_LABEL[status] ?? STATUS_LABEL.unknown}` : ''}
          </span>
        </span>
      </div>
      <div className="vc-board-body">
        {s.description && <p className="vc-source-desc">{s.description}</p>}
        <dl className="vc-source-facts">
          <div>
            <dt>Last checked</dt>
            <dd>{checked ?? 'Not yet'}</dd>
          </div>
          {MAP_ONLY.has(s.id) ? (
            <div>
              <dt>Used for</dt>
              <dd>
                <Link to="/map">City map</Link>
              </dd>
            </div>
          ) : (
            <>
              <div>
                <dt>Last new record</dt>
                <dd>{newest ?? 'None yet'}</dd>
              </div>
              <div>
                <dt>Records</dt>
                <dd>{(s.documentCount ?? 0).toLocaleString('en-US')}</dd>
              </div>
            </>
          )}
        </dl>
        <a className="vc-chip" href={s.baseUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={13} /> Open source site
        </a>
      </div>
    </section>
  );
}

export default function SourcesPage() {
  const load = useJson<SourceRegistryEntry[]>('/api/sources');
  const rows = load.status === 'done' && Array.isArray(load.data) ? sourceRows(load.data) : [];
  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Sources</h1>
      </header>
      {load.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '90%' }} />
          <span style={{ width: '76%' }} />
        </div>
      )}
      {load.status === 'error' && <ErrorNote>The sources could not be loaded.</ErrorNote>}
      {load.status === 'done' && !rows.length && <div className="vc-empty">No sources are listed yet.</div>}
      <div className="vc-boards">
        {rows.map((s) => (
          <SourceCard key={s.id} s={s} />
        ))}
      </div>
    </Frame>
  );
}
