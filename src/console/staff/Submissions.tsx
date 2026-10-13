import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { staff, when } from './api';
import { Alert } from './ui';
import { useStaffData } from './useStaff';

interface Pending {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  status_text: string | null;
  location: string | null;
  file_name: string | null;
  file_size: number | null;
  person: string;
  created_at: string;
}

interface Item extends Pending {
  document_id: string | null;
  reports: number;
  hidden_at: string | null;
  removed_at: string | null;
}

interface ListReply {
  pending: Pending[];
  items: Item[];
  open: boolean;
  storage: { used: number; limit: number };
}

interface LogItem {
  id: number;
  at: string;
  action: string;
  submission_id: string | null;
  person: string | null;
  detail: string | null;
}

const KIND: Record<string, string> = { file: 'File', note: 'Note', link: 'Link', project: 'Project' };
const LOG_WORD: Record<string, string> = {
  submit: 'Sent in',
  approve: 'Approved',
  reject: 'Rejected',
  hide: 'Hidden',
  restore: 'Put back',
  remove: 'Removed',
  report: 'Reported by a resident',
  pause: 'Submissions paused',
  resume: 'Submissions opened',
  delete: 'Test item deleted',
};

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Two taps for anything that cannot be undone. */
function Confirm({ label, yes, onYes, icon }: { label: string; yes: string; onYes: () => Promise<void>; icon?: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setAsking(true)}>
        {icon} {label}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className="vs-btn vs-btn-small vs-btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onYes();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {yes}
      </button>
      <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setAsking(false)}>
        Keep it
      </button>
    </>
  );
}

/** What a resident sent: the words, the link, the file. */
function Details({ s }: { s: Pending }) {
  return (
    <>
      <p className="vs-row-title">{s.title}</p>
      <p className="vs-row-sub">
        {KIND[s.kind] ?? 'Item'} · sent {when(s.created_at)} · resident {s.person}
      </p>
      {s.body && <p className="vs-row-sub vs-sub-body">{s.body}</p>}
      {s.status_text && <p className="vs-row-sub">Status: {s.status_text}</p>}
      {s.location && <p className="vs-row-sub">Where: {s.location}</p>}
      {s.url && <p className="vs-row-sub">Link: {s.url}</p>}
      {s.file_name && (
        <p className="vs-row-sub">
          File: {s.file_name}
          {s.file_size ? ` (${mb(s.file_size)})` : ''}
        </p>
      )}
    </>
  );
}

function PendingRow({ s, act }: { s: Pending; act: (path: string, id: string, done: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="vs-person">
      <Details s={s} />
      <div className="vs-actions">
        <button
          type="button"
          className="vs-btn vs-btn-small vs-btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await act('/submissions/approve', s.id, `Approved. "${s.title}" is on the portal now, labelled as a resident submission.`);
            setBusy(false);
          }}
        >
          Approve
        </button>
        {s.file_name && (
          <a className="vs-btn vs-btn-small vs-btn-quiet" href={`/api/staff/submissions/file?id=${encodeURIComponent(s.id)}`} target="_blank" rel="noopener noreferrer">
            <FileText size={14} aria-hidden="true" /> Open the file
          </a>
        )}
        <Confirm label="Reject" yes="Yes, reject and delete it" onYes={() => act('/submissions/reject', s.id, `Rejected. "${s.title}" and its file were deleted.`)} />
      </div>
    </li>
  );
}

function ItemRow({ s, act }: { s: Item; act: (path: string, id: string, done: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const live = !s.hidden_at && !s.removed_at;
  return (
    <li className="vs-person">
      <p className="vs-row-title">
        {s.title}
        {s.removed_at ? (
          <span className="vs-badge" data-tone="off">
            Removed
          </span>
        ) : s.hidden_at ? (
          <span className="vs-badge" data-tone="wait">
            Hidden
          </span>
        ) : (
          <span className="vs-badge">On the portal</span>
        )}
      </p>
      <p className="vs-row-sub">
        {KIND[s.kind] ?? 'Item'} · sent {when(s.created_at)}
        {s.reports > 0 ? ` · ${plural(s.reports, 'report')}` : ''}
      </p>
      {!s.removed_at && (
        <div className="vs-actions">
          {live && s.document_id && (
            <Link className="vs-btn vs-btn-small vs-btn-quiet" to={`/documents/${s.document_id}`} target="_blank" rel="noopener">
              <ExternalLink size={14} aria-hidden="true" /> View
            </Link>
          )}
          {live ? (
            <button
              type="button"
              className="vs-btn vs-btn-small vs-btn-quiet"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await act('/submissions/hide', s.id, `Hidden. "${s.title}" is off the portal and out of search. You can put it back here or undo it from Activity.`);
                setBusy(false);
              }}
            >
              Hide
            </button>
          ) : (
            <button
              type="button"
              className="vs-btn vs-btn-small vs-btn-quiet"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await act('/submissions/restore', s.id, `Put back. "${s.title}" is on the portal again.`);
                setBusy(false);
              }}
            >
              Put back
            </button>
          )}
          <Confirm label="Remove for good" yes="Yes, remove and delete the file" onYes={() => act('/submissions/remove', s.id, `Removed. "${s.title}" and its file were deleted.`)} />
        </div>
      )}
    </li>
  );
}

type Tab = 'pending' | 'items' | 'log';

/** Resident submissions: approve or reject what residents sent, and look after what is public. */
export default function Submissions() {
  const list = useStaffData<ListReply>('/submissions/list');
  const [tab, setTab] = useState<Tab>('pending');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [logItems, setLogItems] = useState<LogItem[] | null>(null);
  const banner = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice]);
  useEffect(() => {
    if (tab !== 'log') return;
    let live = true;
    staff<{ items: LogItem[] }>('/submissions/log').then(
      (r) => live && setLogItems(r.items),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [tab, list.data]);

  async function act(path: string, id: string, done: string) {
    setError('');
    setNotice('');
    try {
      await staff(path, { body: { id } });
      setNotice(done);
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    }
  }

  async function flip(open: boolean) {
    setError('');
    setNotice('');
    setSwitching(true);
    try {
      await staff('/submissions/switch', { body: { open } });
      setNotice(open ? 'Submissions are open. Residents can send items again.' : 'Submissions are paused. The public page says so, and nothing new can be sent.');
      list.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setSwitching(false);
    }
  }

  const d = list.data;
  const shown = d?.items ?? [];
  const reported = shown.filter((s) => s.reports > 0 && !s.removed_at).length;

  return (
    <section className="vs-stack" aria-labelledby="vs-subs">
      <div>
        <h1 id="vs-subs" className="vs-title">
          Submissions
        </h1>
        <p className="vs-lede">
          What residents sent from the public Submit a record page. Nothing is public until you approve it, and approved items are labelled as resident submitted, not a city record.
        </p>
      </div>

      {notice && (
        <p className="vs-ok vs-ok-sticky" role="status" ref={banner}>
          {notice}
        </p>
      )}
      <Alert>{error || list.error}</Alert>

      {d && (
        <div className="vs-card vs-stack">
          <p className="vs-row-title">
            {d.open ? 'Submissions are open' : 'Submissions are paused'}
            <span className="vs-badge" data-tone={d.open ? undefined : 'wait'}>
              {d.open ? 'Open' : 'Paused'}
            </span>
          </p>
          <p className="vs-row-sub">
            {plural(d.pending.length, 'item')} waiting · {reported ? `${plural(reported, 'item')} reported · ` : ''}
            {mb(d.storage.used)} of {mb(d.storage.limit)} used for files
          </p>
          <div className="vs-actions">
            <button type="button" className="vs-btn vs-btn-quiet" disabled={switching} onClick={() => void flip(!d.open)}>
              {d.open ? 'Pause submissions' : 'Open submissions'}
            </button>
          </div>
        </div>
      )}

      <div className="vs-seg" role="group" aria-label="Show">
        <button type="button" aria-pressed={tab === 'pending'} onClick={() => setTab('pending')}>
          Waiting{d ? ` (${d.pending.length})` : ''}
        </button>
        <button type="button" aria-pressed={tab === 'items'} onClick={() => setTab('items')}>
          Approved
        </button>
        <button type="button" aria-pressed={tab === 'log'} onClick={() => setTab('log')}>
          Log
        </button>
      </div>

      {tab === 'pending' && (
        <div>
          {d && d.pending.length === 0 && <p className="vs-empty">Nothing is waiting for review.</p>}
          <ul className="vs-list">
            {d?.pending.map((s) => (
              <PendingRow key={s.id} s={s} act={act} />
            ))}
          </ul>
        </div>
      )}

      {tab === 'items' && (
        <div>
          {d && shown.length === 0 && <p className="vs-empty">No approved submissions yet.</p>}
          <ul className="vs-list">
            {[...shown]
              .sort((a, b) => Number(Boolean(a.removed_at)) - Number(Boolean(b.removed_at)) || b.reports - a.reports)
              .map((s) => (
                <ItemRow key={s.id} s={s} act={act} />
              ))}
          </ul>
        </div>
      )}

      {tab === 'log' && (
        <div>
          {logItems && logItems.length === 0 && <p className="vs-empty">Nothing in the log yet.</p>}
          <ul className="vs-list">
            {logItems?.slice(0, 100).map((l) => (
              <li key={l.id} className="vs-person">
                <p className="vs-row-title">{LOG_WORD[l.action] ?? l.action}</p>
                <p className="vs-row-sub">
                  {when(l.at)}
                  {l.detail ? ` · ${l.detail}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
