import { useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { staff, when } from './api';
import { Alert, Spinner, Stat } from './ui';
import { useStaffData } from './useStaff';

interface Gap {
  series: string;
  year: number;
  highest: number;
  seen: number;
  missing: number[];
  motionOnly: number[];
}

interface MissingMeeting {
  id: string;
  title: string;
  bodyName: string | null;
  date: string;
  missing: string[];
}

interface CoverageRecord {
  id: string;
  title: string;
  type: string;
  year: number | null;
  body: string | null;
  reason?: string;
}

interface Report {
  computedAt: string;
  counts: { sequenceGaps: number; motionOnly: number; meetingsMissing: number; undated: number; noText: number };
  gaps: Gap[];
  meetings: MissingMeeting[];
  undated: CoverageRecord[];
  noText: CoverageRecord[];
}

const SERIES: Record<string, string> = { ordinance: 'Ordinances', resolution: 'Resolutions', rda_resolution: 'RDA resolutions' };
const DOCS: Record<string, string> = { agenda: 'agenda', packet: 'packet', minutes: 'minutes' };
const STEP = 10;

const pad2 = (n: number) => String(n).padStart(2, '0');
/** "2026-03, 2026-07 to 2026-09": runs of three or more numbers are shortened. */
function numbers(year: number, list: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    if (j - i >= 2) out.push(`${year}-${pad2(list[i])} to ${year}-${pad2(list[j])}`);
    else for (let k = i; k <= j; k++) out.push(`${year}-${pad2(list[k])}`);
    i = j;
  }
  return out.join(', ');
}
const typeWord = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ') : 'Record');
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

/** A list that shows ten at a time, so a long list never fills a phone screen. */
function Part<T>({ title, rows, empty, render }: { title: string; rows: T[]; empty: string; render: (r: T) => ReactNode }) {
  const [shown, setShown] = useState(STEP);
  return (
    <div className="vs-card">
      <h2 className="vs-h2">
        {title} ({rows.length.toLocaleString()})
      </h2>
      {rows.length === 0 ? (
        <p className="vs-empty">{empty}</p>
      ) : (
        <ul className="vs-list">{rows.slice(0, shown).map(render)}</ul>
      )}
      {rows.length > shown && (
        <div className="vs-actions">
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setShown(shown + STEP * 3)}>
            Show more ({(rows.length - shown).toLocaleString()} left)
          </button>
        </div>
      )}
    </div>
  );
}

function RecordRow({ r }: { r: CoverageRecord }) {
  return (
    <li className="vs-person">
      <p className="vs-row-title">
        <a className="vs-link" href={`/documents/${encodeURIComponent(r.id)}`} target="_blank" rel="noopener">
          {r.title}
        </a>
      </p>
      <p className="vs-row-sub">{[typeWord(r.type), r.body, r.year ? String(r.year) : null, r.reason].filter(Boolean).join(' · ')}</p>
    </li>
  );
}

/** Coverage: what the archive is missing, so staff know what to add. Owners and administrators only. */
export default function Coverage() {
  const data = useStaffData<Report>('/coverage/report');
  const [fresh, setFresh] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const r = fresh ?? data.data;

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      setFresh(await staff<Report>('/coverage/refresh', { method: 'POST' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The check did not finish. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const gaps = r?.gaps.filter((g) => g.missing.length || g.motionOnly.length) ?? [];

  return (
    <section className="vs-stack" aria-labelledby="vs-coverage">
      <div>
        <h1 id="vs-coverage" className="vs-title">
          Coverage
        </h1>
        <p className="vs-lede">What the archive seems to be missing: numbered ordinances and resolutions, meeting files, dates and readable text. Adding a record under Records fills a gap.</p>
      </div>
      <Alert>{error || data.error}</Alert>
      {!r && !data.error && <Spinner label="Loading" />}

      {r && (
        <>
          <div className="vs-card">
            <p className="vs-row-sub">Checked {when(r.computedAt)}. It is checked again once a day.</p>
            <div className="vs-actions">
              <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={16} aria-hidden="true" /> {busy ? 'Checking' : 'Check now'}
              </button>
            </div>
          </div>
          <ul className="vs-stats" aria-label="Totals">
            <Stat n={r.counts.sequenceGaps} label="Missing numbers" warn={r.counts.sequenceGaps > 0} />
            <Stat n={r.counts.meetingsMissing} label="Meetings missing files" warn={r.counts.meetingsMissing > 0} />
            <Stat n={r.counts.undated} label="Records with no date" />
            <Stat n={r.counts.noText} label="Records with no text" />
          </ul>

          <Part
            title="Missing numbers"
            rows={gaps}
            empty="No numbers are missing."
            render={(g) => (
              <li key={`${g.series}${g.year}`} className="vs-person">
                <p className="vs-row-title">
                  {SERIES[g.series] ?? g.series} {g.year}
                </p>
                {g.missing.length > 0 && <p className="vs-row-sub">Missing: {numbers(g.year, g.missing)}</p>}
                {g.motionOnly.length > 0 && <p className="vs-row-sub">Named in a motion but not on file: {numbers(g.year, g.motionOnly)}</p>}
                <p className="vs-row-sub">
                  Highest {g.year}-{pad2(g.highest)}, {g.seen} on file or named
                </p>
              </li>
            )}
          />
          <Part
            title="Meetings missing files"
            rows={r.meetings}
            empty="Every past meeting has its agenda, packet and minutes."
            render={(m) => (
              <li key={m.id} className="vs-person">
                <p className="vs-row-title">
                  <a className="vs-link" href={`/meetings/${encodeURIComponent(m.id)}`} target="_blank" rel="noopener">
                    {m.title}
                  </a>
                </p>
                <p className="vs-row-sub">
                  {day(m.date)}
                  {m.bodyName ? ` · ${m.bodyName}` : ''} · no {m.missing.map((x) => DOCS[x] ?? x).join(', ')}
                </p>
              </li>
            )}
          />
          <Part title="Records with no date" rows={r.undated} empty="Every record has a date." render={(x) => <RecordRow key={x.id} r={x} />} />
          <Part title="Records with no text" rows={r.noText} empty="Every record has readable text." render={(x) => <RecordRow key={x.id} r={x} />} />
        </>
      )}
    </section>
  );
}
