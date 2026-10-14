import { RefreshCw } from "lucide-react";
import { when } from "./api";
import { Alert, Spinner, Stat } from "./ui";
import { useStaffData } from "./useStaff";

interface Row {
  group: "Worker" | "GitHub" | "Source" | "Watched website";
  id: string;
  name: string;
  reads: Array<{ label: string; url: string | null }>;
  every: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  status: string;
  tone: "ok" | "wait" | "off";
  detail: string | null;
}

const GROUPS: Array<{ key: Row["group"]; title: string }> = [
  { key: "Worker", title: "Checks the Worker runs" },
  { key: "GitHub", title: "Jobs on GitHub" },
  { key: "Source", title: "Sources" },
  { key: "Watched website", title: "Watched websites" },
];

/** "In 4 min", "In 3 h", or the day and time. */
function next(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const ms = Date.parse(iso) - Date.now();
  if (ms < 60_000) return "Now";
  if (ms < 3_600_000) return `In ${Math.round(ms / 60_000)} min`;
  if (ms < 24 * 3_600_000) return `In ${Math.round(ms / 3_600_000)} h`;
  return when(iso);
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <table className="vs-table">
      <thead>
        <tr>
          <th scope="col">Job</th>
          <th scope="col">What it reads</th>
          <th scope="col">How often</th>
          <th scope="col">Last run</th>
          <th scope="col">Last success</th>
          <th scope="col">Next run</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row" data-label="Job">
              {r.name}
            </th>
            <td data-label="What it reads">
              <span>
                {r.reads.length === 0
                  ? "Nothing now"
                  : r.reads.map((x, i) => (
                      <span key={i} className="vs-table-read">
                        {x.url ? (
                          <a
                            className="vs-link"
                            href={x.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {x.label}
                          </a>
                        ) : (
                          x.label
                        )}
                      </span>
                    ))}
              </span>
            </td>
            <td data-label="How often">{r.every}</td>
            <td data-label="Last run">
              {r.lastRunAt ? when(r.lastRunAt) : "Not recorded"}
            </td>
            <td data-label="Last success">
              {r.lastSuccessAt ? when(r.lastSuccessAt) : "Not recorded"}
            </td>
            <td data-label="Next run">{next(r.nextRunAt)}</td>
            <td data-label="Status">
              <span>
                <span
                  className="vs-badge"
                  data-tone={r.tone === "ok" ? undefined : r.tone}
                >
                  {r.status}
                </span>
                {r.detail && (
                  <span className="vs-table-detail">{r.detail}</span>
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Schedules: every scheduled job and source, read from the real settings. Owners and administrators only. */
export default function Schedules() {
  const data = useStaffData<{
    generatedAt: string;
    workerCron: string;
    items: Row[];
  }>("/schedules/list");
  const d = data.data;
  const failing = d ? d.items.filter((r) => r.tone === "wait").length : 0;
  return (
    <section className="vs-stack" aria-labelledby="vs-schedules">
      <div>
        <h1 id="vs-schedules" className="vs-title">
          Schedules
        </h1>
        <p className="vs-lede">
          Every scheduled job and source, from the cron settings in the code.
        </p>
      </div>
      <Alert>{data.error}</Alert>
      {!d && !data.error && <Spinner label="Loading" />}
      {d && (
        <>
          <ul className="vs-stats" aria-label="Totals">
            <Stat n={d.items.length} label="Jobs and sources" />
            <Stat n={failing} label="Not working" warn={failing > 0} />
            <Stat n={d.workerCron} label="Worker cron" />
          </ul>
          <div className="vs-actions">
            <button
              type="button"
              className="vs-btn vs-btn-quiet"
              disabled={data.loading}
              onClick={data.reload}
            >
              <RefreshCw size={16} aria-hidden="true" /> Read again
            </button>
            <span className="vs-hint">
              Read {when(d.generatedAt)}. Times in your time zone.
            </span>
          </div>
          {GROUPS.map((g) => {
            const rows = d.items.filter((r) => r.group === g.key);
            if (!rows.length) return null;
            return (
              <div key={g.key} className="vs-card">
                <h2 className="vs-h2">{g.title}</h2>
                <Table rows={rows} />
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
