import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { when } from './api';
import { Alert, Spinner, Stat } from './ui';
import { useStaffData } from './useStaff';

interface Job {
  kind: 'job' | 'source';
  id: string;
  name: string;
  consecutiveFailures: number;
  failing: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  status?: string;
}

interface Usage {
  used: number;
  cap: number;
}

interface HealthReply {
  generatedAt: string;
  threshold: number;
  jobs: Job[];
  sources: Job[];
  aiFallbacks: { total: number; byReason: Array<{ reason: string; n: number }> } | null;
  ai: { public: Usage; tests: Usage; total: Usage & { allowance: number }; resetsAtMountain: string } | null;
}

const round = (n: number) => Math.round(n).toLocaleString();
const order = (a: Job, b: Job) => Number(b.failing) - Number(a.failing) || b.consecutiveFailures - a.consecutiveFailures || a.name.localeCompare(b.name);

function Rows({ title, rows }: { title: string; rows: Job[] }) {
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort(order);
  const shown = all ? sorted : sorted.filter((r) => r.failing || r.consecutiveFailures > 0).concat(sorted.filter((r) => !r.failing && r.consecutiveFailures === 0).slice(0, 5));
  return (
    <div className="vs-card">
      <h2 className="vs-h2">{title}</h2>
      {rows.length === 0 ? (
        <p className="vs-empty">Nothing has run yet.</p>
      ) : (
        <ul className="vs-list">
          {shown.map((r) => (
            <li key={r.id} className="vs-person">
              <p className="vs-row-title">
                {r.name}
                {r.failing ? (
                  <span className="vs-badge" data-tone="wait">
                    Failing
                  </span>
                ) : r.consecutiveFailures > 0 ? (
                  <span className="vs-badge" data-tone="wait">
                    {r.consecutiveFailures === 1 ? '1 failure' : `${r.consecutiveFailures} failures`}
                  </span>
                ) : (
                  <span className="vs-badge">Working</span>
                )}
              </p>
              <p className="vs-row-sub">
                Last worked {r.lastSuccessAt ? when(r.lastSuccessAt) : 'never'}
                {r.lastRunAt && r.lastRunAt !== r.lastSuccessAt ? ` · last ran ${when(r.lastRunAt)}` : ''}
              </p>
              {r.lastError && <p className="vs-row-sub">{r.lastError}</p>}
            </li>
          ))}
        </ul>
      )}
      {shown.length < sorted.length && (
        <div className="vs-actions">
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setAll(true)}>
            Show all {sorted.length}
          </button>
        </div>
      )}
    </div>
  );
}

/** Health: whether the scheduled jobs and the city sources are working, and how the assistant is holding up. Owners and administrators only. */
export default function Health() {
  const data = useStaffData<HealthReply>('/health/report');
  const d = data.data;
  const failing = d ? [...d.jobs, ...d.sources].filter((r) => r.failing).length : 0;

  return (
    <section className="vs-stack" aria-labelledby="vs-health">
      <div>
        <h1 id="vs-health" className="vs-title">
          Health
        </h1>
        <p className="vs-lede">Whether the portal is reading the city's sources on schedule, and whether the assistant had to fall back to a simpler answer today.</p>
      </div>
      <Alert>{data.error}</Alert>
      {!d && !data.error && <Spinner label="Loading" />}

      {d && (
        <>
          <div className="vs-card">
            <p className="vs-row-sub">
              Read {when(d.generatedAt)}. Something is marked failing after {d.threshold} failures in a row.
            </p>
            <div className="vs-actions">
              <button type="button" className="vs-btn vs-btn-quiet" disabled={data.loading} onClick={data.reload}>
                <RefreshCw size={16} aria-hidden="true" /> Read again
              </button>
            </div>
          </div>
          <ul className="vs-stats" aria-label="Totals">
            <Stat n={failing} label="Failing now" warn={failing > 0} />
            <Stat n={d.jobs.length + d.sources.length} label="Jobs and sources" />
            <Stat n={d.aiFallbacks?.total ?? 0} label="Simpler answers today" warn={(d.aiFallbacks?.total ?? 0) > 0} />
            {d.ai && <Stat n={round(d.ai.total.used)} label={`AI units of ${round(d.ai.total.allowance)} today`} warn={d.ai.total.used >= d.ai.total.cap} />}
          </ul>

          {d.aiFallbacks && d.aiFallbacks.byReason.length > 0 && (
            <div className="vs-card">
              <h2 className="vs-h2">Why the assistant fell back today</h2>
              <ul className="vs-list">
                {d.aiFallbacks.byReason.map((r) => (
                  <li key={r.reason} className="vs-person">
                    <p className="vs-row-title">{r.reason}</p>
                    <p className="vs-row-sub">{r.n === 1 ? 'Once' : `${r.n} times`}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Rows title="Scheduled jobs" rows={d.jobs} />
          <Rows title="City sources" rows={d.sources} />
          {d.ai && <p className="vs-small">AI use resets at {d.ai.resetsAtMountain}.</p>}
        </>
      )}
    </section>
  );
}
