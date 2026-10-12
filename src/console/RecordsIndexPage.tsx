/**
 * /records/ordinances, /records/resolutions, /records/rda-resolutions: each numbered measure of a
 * year, one row each: number, short title, a status chip, the adoption date and tally from the
 * minutes, and the minutes page. One edge-cached call per index (GET /api/records/<index>?year=).
 */
import './styles';
import { useEffect } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { DocLink } from './DocLink';
import { formatDate } from './format';
import { setHead } from '@/lib/head';
import { ErrorNote } from './ErrorNote';
import { YearChips } from './YearChips';

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
  /** Adopted with a carried motion (or the adopted copy), a draft, or no adoption in the archive. */
  status?: 'adopted' | 'draft' | 'none';
  /** For a draft: the newest draft copy's date and the body it went to. */
  draft?: { date: string | null; body: string | null } | null;
  state: 'adopted' | 'listed' | 'missing' | 'absent';
}
interface RecordIndex {
  kind: string;
  year: number | null;
  years: Array<{ year: number; count: number }>;
  rows: IndexRow[];
}

const KINDS: Record<string, { title: string; word: string; topic: string; every: string }> = {
  ordinances: { title: 'Ordinances', word: 'Ordinance', topic: 'ordinances', every: 'All ordinances' },
  resolutions: { title: 'Resolutions', word: 'Resolution', topic: 'resolutions', every: 'All resolutions' },
  'rda-resolutions': { title: 'RDA resolutions', word: 'RDA Resolution', topic: 'rda', every: 'All RDA records' },
};

/** Adopted, Draft, or no adoption in the archive (from the state when an older response has no status). */
function rowStatus(r: IndexRow): 'adopted' | 'draft' | 'none' {
  if (r.status) return r.status;
  if (r.state === 'adopted') return 'adopted';
  return r.document?.status === 'draft' ? 'draft' : 'none';
}

/** The vote as recorded: "Vote 4 to 0", else "Carried" for a carried motion with no tally; nothing otherwise. */
function voteLabel(r: IndexRow): string | null {
  if (r.state === 'missing' || rowStatus(r) !== 'adopted') return null;
  if (r.tally) return `Vote ${r.tally.replace(/^(\d+)\s*-\s*(\d+)/, '$1 to $2')}`;
  if (r.vote === 'carried' || (r.vote === undefined && r.minutes)) return 'Carried';
  return null;
}

/** The status chip: Adopted, Draft, Cited (named in the minutes, no copy held), or none. */
function chipLabel(r: IndexRow): string | null {
  if (r.state === 'missing') return 'Cited';
  const s = rowStatus(r);
  return s === 'adopted' ? 'Adopted' : s === 'draft' ? 'Draft' : null;
}

/** The date line: the adoption date, the draft's body and date, or what is not in the archive. */
function dateLabel(r: IndexRow): string {
  if (r.state === 'missing') return 'Named in the minutes';
  const s = rowStatus(r);
  if (s === 'adopted') return formatDate(r.adoptedOn) ?? 'Date not found';
  if (s === 'draft') return [r.draft?.body, r.draft?.date ? formatDate(r.draft.date) : null].filter(Boolean).join(', ') || 'Not adopted';
  return 'Adoption not in the archive';
}

/** What to draw: each number held, and each run of numbers not held as one quiet line. */
type Item = { row: IndexRow } | { gap: [string, string] };
function itemsOf(rows: IndexRow[]): Item[] {
  const out: Item[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (r.state !== 'absent') out.push({ row: r });
    else if (last && 'gap' in last) last.gap[1] = r.number;
    else out.push({ gap: [r.number, r.number] });
  }
  return out;
}

export default function RecordsIndexPage() {
  const { index = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const kind = KINDS[index];
  const year = params.get('year') ?? '';
  const load = useJson<RecordIndex>(kind ? `/api/records/${index}${/^\d{4}$/.test(year) ? `?year=${year}` : ''}` : null);
  useEffect(() => {
    if (kind) setHead(`${kind.title} by number`);
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
        <Link to={`/records?topic=${kind.topic}`} className="vc-rec-index-link">
          {kind.every} <ChevronRight size={14} />
        </Link>
      </header>
      {data && <YearChips years={data.years.map((y) => y.year)} value={String(data.year ?? '')} onPick={(y) => setParams(y ? { year: y } : {}, { replace: true })} />}

      {load.status === 'loading' && (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '94%' }} />
          <span style={{ width: '82%' }} />
        </div>
      )}
      {load.status === 'error' && <ErrorNote>This index could not be loaded.</ErrorNote>}
      {data && data.rows.length === 0 && <div className="vc-empty">No numbered {kind.title.toLowerCase()} are in the archive yet.</div>}
      {data && data.rows.length > 0 && (
        <>
          <p className="vc-mdocs-count">
            {held} of {data.rows.length} numbers in the archive
          </p>
          <ol className="vc-irows">
            {itemsOf(data.rows).map((it) => {
              if ('gap' in it) {
                const [a, b] = it.gap;
                return (
                  <li key={a} className="vc-irow" data-state="absent">
                    <span className="vc-irow-num">{a === b ? a : `${a} to ${b.replace(/^\d{4}-/, '')}`}</span>
                    <span className="vc-irow-gap">Not in the archive</span>
                  </li>
                );
              }
              const r = it.row;
              const chip = chipLabel(r);
              const vote = voteLabel(r);
              const title = r.state === 'missing' ? 'No copy in the archive' : (r.title ?? 'Title not in the archive');
              // The row opens the measure itself, else the minutes that record it.
              const open = r.document ? { id: r.document.id, page: null } : r.minutes ? { id: r.minutes.documentId, page: r.minutes.page } : null;
              const minutesToo = r.document && r.minutes ? r.minutes : null;
              return (
                <li key={r.number} className="vc-irow" data-state={r.state} data-status={rowStatus(r)}>
                  <span className="vc-irow-num">{r.number}</span>
                  <span className="vc-irow-main">
                    {open ? (
                      <DocLink id={open.id} page={open.page} className="vc-irow-title" aria-label={`${kind.word} ${r.number}: ${title}`}>
                        {title}
                      </DocLink>
                    ) : (
                      <span className="vc-irow-title">{title}</span>
                    )}
                    <span className="vc-irow-meta">
                      <span className="vc-irow-pair">
                        {chip && (
                          <span className="vc-schip" data-status={r.state === 'missing' ? 'cited' : rowStatus(r)}>
                            {chip}
                          </span>
                        )}
                        <span>{dateLabel(r)}</span>
                      </span>
                      {(vote || minutesToo) && (
                        <span className="vc-irow-pair">
                          {vote && <span>{vote}</span>}
                          {minutesToo && (
                            <DocLink id={minutesToo.documentId} page={minutesToo.page} className="vc-irow-link">
                              Minutes
                            </DocLink>
                          )}
                        </span>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Frame>
  );
}
