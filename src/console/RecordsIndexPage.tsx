/**
 * /records/ordinances, /records/resolutions, /records/rda-resolutions: each numbered measure of a
 * year, with its title, adoption date and tally from the minutes, and links to the record and the
 * minutes page. One edge-cached call per index (GET /api/records/<index>?year=).
 */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Frame } from './Chrome';
import { useJson } from './api';
import { DocLink } from './DocLink';
import { formatDate } from './format';

interface IndexRow {
  number: string;
  title: string | null;
  adoptedOn: string | null;
  adoptedFrom: 'minutes' | 'document' | null;
  tally: string | null;
  unanimous: boolean;
  /** 'carried' when a motion for the number is in the archive (absent from an older cached response). */
  vote?: 'carried' | null;
  minutes: { documentId: string; page: number | null } | null;
  document: { id: string; title: string; status: 'draft' | 'adopted' | null } | null;
  state: 'adopted' | 'listed' | 'missing' | 'absent';
}
interface RecordIndex {
  kind: string;
  year: number | null;
  years: Array<{ year: number; count: number }>;
  rows: IndexRow[];
}

const KINDS: Record<string, { title: string; word: string; topic: string; every: string }> = {
  ordinances: { title: 'Ordinances', word: 'Ordinance', topic: 'ordinances', every: 'Every ordinance' },
  resolutions: { title: 'Resolutions', word: 'Resolution', topic: 'resolutions', every: 'Every resolution' },
  'rda-resolutions': { title: 'RDA resolutions', word: 'RDA Resolution', topic: 'rda', every: 'Every RDA resolution' },
};

/** The vote as the minutes record it, or that no motion for it is in the archive. */
function voteLabel(r: IndexRow): string | null {
  if (r.state === 'missing') return null;
  if (r.tally) return `Vote ${r.tally}`;
  if (r.unanimous) return 'Unanimous';
  if (r.vote === 'carried' || (r.vote === undefined && r.minutes)) return 'Carried';
  return 'Vote not in the archive';
}

export default function RecordsIndexPage() {
  const { index = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const kind = KINDS[index];
  const year = params.get('year') ?? '';
  const load = useJson<RecordIndex>(kind ? `/api/records/${index}${/^\d{4}$/.test(year) ? `?year=${year}` : ''}` : null);
  useEffect(() => {
    if (kind) document.title = `${kind.title} by number | Vineyard Transparency Portal`;
  }, [kind]);
  if (!kind) return <Navigate to="/records" replace />;
  const data = load.status === 'done' ? load.data : null;
  const held = data ? data.rows.filter((r) => r.state !== 'absent').length : 0;

  return (
    <Frame>
      <header className="vc-page-head">
        <Link to="/records" className="vc-rec-back">
          Records
        </Link>
        <h1 className="vc-page-title">{kind.title} by number</h1>
      </header>
      <div className="vc-rec-filters">
        <div className="vc-rec-selects">
          {data && data.years.length > 0 && (
            <label className="vc-rec-select">
              <span>Year</span>
              <select value={String(data.year ?? '')} onChange={(e) => setParams(e.target.value ? { year: e.target.value } : {}, { replace: true })}>
                {data.years.map((y) => (
                  <option key={y.year} value={y.year}>
                    {y.year} ({y.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          <Link to={`/records?topic=${kind.topic}`} className="vc-rec-reset">
            {kind.every}
          </Link>
        </div>
      </div>

      {load.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '94%' }} />
          <span style={{ width: '82%' }} />
        </div>
      )}
      {load.status === 'error' && <div className="vc-empty">This index could not be loaded. Try again in a moment.</div>}
      {data && data.rows.length === 0 && <div className="vc-empty">No numbered {kind.title.toLowerCase()} are in the archive yet.</div>}
      {data && data.rows.length > 0 && (
        <>
          <p className="vc-mdocs-count">
            {held} of {data.rows.length} numbers for {data.year} in the archive. Dates and tallies are from the minutes.
          </p>
          <ol className="vc-idx">
            {data.rows.map((r) =>
              r.state === 'absent' ? (
                <li key={r.number} className="vc-idx-absent" data-state="absent">
                  {kind.word} {r.number}. Not in the archive.
                </li>
              ) : (
              <li key={r.number} className="vc-idx-row" data-state={r.state}>
                <div className="vc-idx-num">
                  {kind.word} {r.number}
                </div>
                <div className="vc-idx-main">
                  <div className="vc-idx-title">{r.state === 'missing' ? 'Not in the archive' : (r.title ?? 'Untitled')}</div>
                  <div className="vc-idx-meta">
                    {r.state === 'missing' ? (
                      <span>Cited in the minutes</span>
                    ) : r.adoptedOn ? (
                      <span>Adopted {formatDate(r.adoptedOn)}</span>
                    ) : r.state === 'adopted' ? (
                      <span>Adopted, date not found</span>
                    ) : (
                      <span>No adoption found in the minutes read</span>
                    )}
                    {voteLabel(r) && <span>{voteLabel(r)}</span>}
                  </div>
                  <div className="vc-idx-links">
                    {r.document && (
                      <DocLink id={r.document.id} className="vc-idx-link">
                        {r.document.status === 'draft' ? 'Draft copy' : 'Document'}
                      </DocLink>
                    )}
                    {r.minutes && (
                      <DocLink id={r.minutes.documentId} page={r.minutes.page} className="vc-idx-link">
                        Minutes{r.minutes.page ? `, page ${r.minutes.page}` : ''}
                      </DocLink>
                    )}
                  </div>
                </div>
              </li>
              ),
            )}
          </ol>
        </>
      )}
    </Frame>
  );
}
