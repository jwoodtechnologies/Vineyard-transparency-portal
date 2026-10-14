import { useState, type FormEvent } from 'react';
import { ExternalLink, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { staff, when } from './api';
import { Alert, Field, Spinner, Stat } from './ui';
import { useStaffData } from './useStaff';

interface Item {
  id: string;
  label: string;
  url: string;
  everyMin: number;
  every: string;
  paused: boolean;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
  filesFound: number;
  nextCheckAt: string | null;
}

interface Reply {
  items: Item[];
  frequencies: Array<{ key: string; minutes: number; label: string }>;
  limits: { maxWatched: number; perTick: number; maxPageMb: number; stopShare: number };
  budget: { usedToday: number; limit: number; watchChecksToday: number; watchRowsToday: number };
}

const keyOf = (r: Reply, minutes: number) => r.frequencies.find((f) => f.minutes === minutes)?.key ?? '1d';

function PageForm({ data, item, onDone, onCancel }: { data: Reply; item?: Item; onDone: (msg: string) => void; onCancel?: () => void }) {
  const [label, setLabel] = useState(item?.label ?? '');
  const [url, setUrl] = useState(item?.url ?? '');
  const [every, setEvery] = useState(item ? keyOf(data, item.everyMin) : '1d');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await staff(item ? '/watch/edit' : '/watch/add', { body: { id: item?.id, label, url, every } });
      onDone(item ? `Saved "${label.trim()}".` : `Watching "${label.trim()}".`);
      if (!item) {
        setLabel('');
        setUrl('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={item ? 'vs-edit' : undefined} onSubmit={save} noValidate aria-label={item ? `Change ${item.label}` : 'Watch a website'}>
      <Field label="Label">{(id) => <input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Alpine School District board" maxLength={120} />}</Field>
      <Field label="Address" hint="A public web page, starting with https:// or http://.">
        {(id) => <input id={id} type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />}
      </Field>
      <Field label="How often">
        {(id) => (
          <select id={id} value={every} onChange={(e) => setEvery(e.target.value)}>
            {data.frequencies.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || !label.trim() || !url.trim()}>
          {item ? 'Save' : (
            <>
              <Plus size={16} aria-hidden="true" /> Watch this page
            </>
          )}
        </button>
        {onCancel && (
          <button type="button" className="vs-btn vs-btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Row({ item, data, onDone, onError }: { item: Item; data: Reply; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function act(path: string, body: Record<string, unknown>, msg: string) {
    onError('');
    try {
      await staff(path, { body: { id: item.id, ...body } });
      onDone(msg);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not do that.');
    }
  }
  return (
    <li className="vs-person">
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {item.label}{' '}
            <span className="vs-badge" data-tone={item.paused ? 'off' : item.lastError ? 'wait' : undefined}>
              {item.paused ? 'Paused' : item.lastError ? 'Not working' : item.lastCheckedAt ? 'Working' : 'Not checked yet'}
            </span>
          </p>
          <p className="vs-row-sub">
            <a className="vs-link" href={item.url} target="_blank" rel="noopener noreferrer">
              {item.url} <ExternalLink size={12} aria-hidden="true" />
            </a>
          </p>
          <p className="vs-row-sub">
            {item.every}
            {item.lastCheckedAt ? ` · checked ${when(item.lastCheckedAt)}` : ''}
            {item.lastChangedAt ? ` · changed ${when(item.lastChangedAt)}` : ''}
            {item.filesFound ? ` · ${item.filesFound} ${item.filesFound === 1 ? 'file' : 'files'} found` : ''}
            {!item.paused && item.nextCheckAt ? ` · next ${when(item.nextCheckAt)}` : ''}
          </p>
          {item.lastError && <p className="vs-row-sub">{item.lastError}</p>}
        </div>
      </div>
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => act('/watch/pause', { paused: !item.paused }, item.paused ? `Resumed "${item.label}".` : `Paused "${item.label}".`)}>
          {item.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />} {item.paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          <Pencil size={14} aria-hidden="true" /> {editing ? 'Close' : 'Edit'}
        </button>
        {confirm ? (
          <>
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => act('/watch/delete', {}, `Stopped watching "${item.label}". Undo is in Activity.`)}>
              Yes, delete it
            </button>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
      {editing && (
        <PageForm
          data={data}
          item={item}
          onCancel={() => setEditing(false)}
          onDone={(m) => {
            setEditing(false);
            onDone(m);
          }}
        />
      )}
    </li>
  );
}

/** Watched websites: public pages the portal checks for changes and new files. Owners and administrators only. */
export default function Watch() {
  const { data, error: loadError, reload } = useStaffData<Reply>('/watch/list');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const done = (m: string) => {
    setNote(m);
    reload();
  };
  const share = data ? Math.round((data.budget.usedToday / Math.max(1, data.budget.limit)) * 100) : 0;
  return (
    <section className="vs-stack" aria-labelledby="vs-watch">
      <div>
        <h1 id="vs-watch" className="vs-title">
          Watched websites
        </h1>
        <p className="vs-lede">The portal checks each page on its schedule, keeps a copy when it changes, and adds new PDF, Word and Excel files it links to the records.</p>
      </div>
      <Alert>{loadError || error}</Alert>
      {note && (
        <p className="vs-ok" role="status">
          {note}
        </p>
      )}
      {!data && !loadError && <Spinner label="Loading" />}
      {data && (
        <>
          <ul className="vs-stats" aria-label="Budget">
            <Stat n={`${data.items.length} of ${data.limits.maxWatched}`} label="Pages watched" />
            <Stat n={data.budget.watchChecksToday} label="Checks today" />
            <Stat n={data.budget.watchRowsToday.toLocaleString()} label="Rows written today by these checks" />
            <Stat n={`${share}%`} label={`Of today's ${data.budget.limit.toLocaleString()} row budget used`} warn={share >= data.limits.stopShare * 100} />
          </ul>
          <p className="vs-hint">
            At most {data.limits.perTick} pages are checked every five minutes, each up to {data.limits.maxPageMb} MB. Checks pause for the day at {Math.round(data.limits.stopShare * 100)}% of the row budget. Pages that robots.txt closes are not read.
          </p>
          <div className="vs-card">
            <h2 className="vs-h2">Watch a website</h2>
            {data.items.length >= data.limits.maxWatched ? <p className="vs-empty">The list is full. Delete a page to add another.</p> : <PageForm data={data} onDone={done} />}
          </div>
          <div className="vs-card">
            <h2 className="vs-h2">Pages</h2>
            {data.items.length === 0 ? (
              <p className="vs-empty">No pages are watched yet.</p>
            ) : (
              <ul className="vs-list">
                {data.items.map((i) => (
                  <Row key={i.id} item={i} data={data} onDone={done} onError={setError} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
