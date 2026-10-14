/**
 * Fix records and meetings: correct any record in the archive (title, type, date, meeting), hide a duplicate or misfiled one,
 * and mark a meeting canceled or moved, change its time or place, or add its video. The automated reads of the city's sites
 * leave every change alone, and each one is in Activity with Undo.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EyeOff, Pencil, RotateCcw, Search } from 'lucide-react';
import { staff } from './api';
import type { MeetingOption } from './recordsLib';
import { Alert, Field } from './ui';
import { useStaffData } from './useStaff';
import { refocus } from './usePiece';

interface Rec {
  id: string;
  title: string;
  document_type: string;
  document_date: string | null;
  meeting_id: string | null;
  meeting_title: string | null;
  meeting_date: string | null;
  manual_json: string | null;
}
interface Held {
  id: string;
  title: string;
  document_type: string;
  document_date: string | null;
  reason: string;
}
interface Mtg {
  id: string;
  title: string;
  government_body_name: string | null;
  meeting_date: string;
  start_time: string | null;
  location: string | null;
  status: string;
  manual_json: string | null;
}
type Types = Array<{ key: string; label: string }>;

const meetingLabel = (m: { title: string | null; meeting_date: string | null }) => `${m.meeting_date ?? ''} ${m.title ?? ''}`.trim();

function RecordForm({ r, types, meetings, onSaved, onCancel }: { r: Rec; types: Types; meetings: MeetingOption[]; onSaved: (msg: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(r.title);
  const [type, setType] = useState(r.document_type);
  const [date, setDate] = useState(r.document_date ?? '');
  const [meeting, setMeeting] = useState(r.meeting_id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = [...meetings];
  if (r.meeting_id && !options.some((m) => m.id === r.meeting_id)) options.unshift({ id: r.meeting_id, title: r.meeting_title ?? 'Meeting', meeting_date: r.meeting_date, government_body_name: null });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Give the record a title.');
    const body: Record<string, unknown> = { id: r.id };
    if (title.trim() !== r.title) body.title = title;
    if (type !== r.document_type) body.type = type;
    if (date !== (r.document_date ?? '')) body.date = date;
    if (meeting !== (r.meeting_id ?? '')) body.meetingId = meeting;
    if (Object.keys(body).length === 1) return onSaved(`Nothing changed in ${r.title}, so there was nothing to save.`);
    setBusy(true);
    setError('');
    try {
      await staff('/archive/fix', { body });
      onSaved(`Saved ${title.trim()}. The portal shows it within a few minutes, and the city site reads leave it alone.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="vs-edit" onSubmit={submit} noValidate aria-label={`Correct ${r.title}`}>
      <Field label="Title">{(id) => <input id={id} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Type">
        {(id) => (
          <select id={id} value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Date of the record">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <Field label="Meeting it belongs to" hint="Agendas and minutes also become that meeting's agenda or minutes.">
        {(id) => (
          <select id={id} value={meeting} onChange={(e) => setMeeting(e.target.value)}>
            <option value="">No meeting</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {meetingLabel(m)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RecordRow({ r, types, meetings, onDone }: { r: Rec; types: Types; meetings: MeetingOption[]; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const editBtn = useRef<HTMLButtonElement>(null);
  const typeLabel = types.find((t) => t.key === r.document_type)?.label ?? r.document_type;
  async function hide() {
    setError('');
    try {
      await staff('/archive/hide', { body: { id: r.id, reason } });
      onDone(`Hid ${r.title}. Its link now says why. You can put it back below or undo it from Activity.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hide that.');
    }
  }
  return (
    <li className="vs-person">
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {r.title}
            {r.manual_json && (
              <span className="vs-badge" data-tone="off">
                Corrected
              </span>
            )}
          </p>
          <p className="vs-row-sub">{[typeLabel, r.document_date, r.meeting_title ? `${r.meeting_title}, ${r.meeting_date ?? ''}` : ''].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button
          type="button"
          ref={editBtn}
          className="vs-btn vs-btn-small vs-btn-quiet"
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Correct'} ${r.title}`}
          onClick={() => {
            setOpen(!open);
            setHiding(false);
          }}
        >
          <Pencil size={14} aria-hidden="true" /> {open ? 'Close' : 'Correct'}
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" aria-expanded={hiding} aria-label={`Hide ${r.title}`} onClick={() => setHiding(!hiding)}>
          <EyeOff size={14} aria-hidden="true" /> Hide
        </button>
        <a className="vs-btn vs-btn-small vs-btn-quiet" href={`/documents/${encodeURIComponent(r.id)}`} target="_blank" rel="noopener noreferrer">
          Open
        </a>
      </div>
      {hiding && (
        <div className="vs-confirm">
          <Field label="Why it is being hidden" hint='Shown at its old link, for example: "A second copy of the approved minutes."'>
            {(id) => <input id={id} autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <p className="vs-hint">It leaves every page, search and answer. Votes read from it stay. You can put it back at any time.</p>
          <div className="vs-actions">
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={() => void hide()}>
              Yes, hide it
            </button>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setHiding(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      <Alert>{error}</Alert>
      {open && (
        <RecordForm
          r={r}
          types={types}
          meetings={meetings}
          onCancel={() => {
            setOpen(false);
            refocus(editBtn.current);
          }}
          onSaved={(msg) => {
            setOpen(false);
            refocus(editBtn.current);
            onDone(msg);
          }}
        />
      )}
    </li>
  );
}

function MeetingRow({ m, onDone }: { m: Mtg; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(m.status === 'cancelled' ? 'cancelled' : 'scheduled');
  const [date, setDate] = useState(m.meeting_date);
  const [time, setTime] = useState(m.start_time ?? '');
  const [place, setPlace] = useState(m.location ?? '');
  const [video, setVideo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const editBtn = useRef<HTMLButtonElement>(null);
  const changed = Boolean(m.manual_json);
  async function save(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { id: m.id };
    if (status !== (m.status === 'cancelled' ? 'cancelled' : 'scheduled')) body.status = status;
    if (date !== m.meeting_date) body.date = date;
    if (time !== (m.start_time ?? '')) body.startTime = time;
    if (place.trim() !== (m.location ?? '')) body.location = place;
    if (video.trim()) body.video = video.trim();
    if (Object.keys(body).length === 1) return setError('Change something first.');
    setBusy(true);
    setError('');
    try {
      await staff('/archive/meeting', { body });
      setOpen(false);
      refocus(editBtn.current);
      onDone(`Saved ${m.title}, ${date}. The calendar, the meeting page and Latest show it within a few minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  async function original() {
    setBusy(true);
    try {
      await staff('/archive/meeting', { body: { id: m.id, unlock: ['status', 'meeting_date', 'start_time', 'location', 'media', 'original_date'] } });
      onDone(`${m.title} goes back to what the city lists at the next read, within a few minutes.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="vs-person" data-off={m.status === 'cancelled'}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {m.title}
            {m.status === 'cancelled' && (
              <span className="vs-badge" data-tone="wait">
                Canceled
              </span>
            )}
            {changed && (
              <span className="vs-badge" data-tone="off">
                Changed by staff
              </span>
            )}
          </p>
          <p className="vs-row-sub">{[m.meeting_date, m.start_time, m.location].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="vs-actions">
        <button
          type="button"
          ref={editBtn}
          className="vs-btn vs-btn-small vs-btn-quiet"
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Change'} ${m.title} on ${m.meeting_date}`}
          onClick={() => setOpen(!open)}
        >
          <Pencil size={14} aria-hidden="true" /> {open ? 'Close' : 'Change'}
        </button>
        {changed && !open && (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={busy} onClick={() => void original()}>
            <RotateCcw size={14} aria-hidden="true" /> What the city lists
          </button>
        )}
      </div>
      {open && (
        <form className="vs-edit" onSubmit={save} noValidate aria-label={`Change ${m.title} on ${m.meeting_date}`}>
          <div className="vs-seg" role="radiogroup" aria-label="Is it happening?">
            <button type="button" role="radio" aria-checked={status === 'scheduled'} aria-pressed={status === 'scheduled'} onClick={() => setStatus('scheduled')}>
              Happening
            </button>
            <button type="button" role="radio" aria-checked={status === 'cancelled'} aria-pressed={status === 'cancelled'} onClick={() => setStatus('cancelled')}>
              Canceled
            </button>
          </div>
          <Field label="Date" hint="Change it to move the meeting. The old date is remembered.">
            {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Start time">{(id) => <input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
          <Field label="Place">{(id) => <input id={id} autoComplete="off" value={place} onChange={(e) => setPlace(e.target.value)} />}</Field>
          <Field label="Video link" hint="Optional. The full address of the recording or livestream, starting with https://.">
            {(id) => <input id={id} type="url" inputMode="url" autoCapitalize="none" spellCheck={false} value={video} onChange={(e) => setVideo(e.target.value)} />}
          </Field>
          <Alert>{error}</Alert>
          <div className="vs-actions">
            <button type="submit" className="vs-btn vs-btn-primary" disabled={busy}>
              Save
            </button>
            <button type="button" className="vs-btn vs-btn-quiet" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export default function Archive() {
  const [tab, setTab] = useState<'records' | 'meetings'>('records');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setApplied(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const recs = useStaffData<{ items: Rec[]; hidden: Held[]; types: Types }>(`/archive/find?q=${encodeURIComponent(applied)}`);
  const mtgs = useStaffData<{ items: Mtg[] }>(`/archive/meetings?q=${encodeURIComponent(applied)}`);
  const choices = useStaffData<{ items: MeetingOption[] }>('/records/meetings');
  const done = (msg: string) => {
    setNotice(msg);
    recs.reload();
    mtgs.reload();
  };
  async function putBack(h: Held) {
    try {
      await staff('/archive/unhide', { body: { id: h.id } });
      done(`${h.title} is back in the archive.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not put that back.');
    }
  }

  return (
    <section className="vs-stack vs-stack-flow" aria-labelledby="vs-archive">
      <div>
        <h1 id="vs-archive" className="vs-title">
          Fix records and meetings
        </h1>
        <p className="vs-lede">
          Correct any record in the archive, hide a duplicate, or mark a meeting canceled or moved. The automatic reads of the city&apos;s sites leave your changes alone, and each one can be undone
          from Activity.
        </p>
      </div>
      <div role="status" className="vs-sr">
        {notice}
      </div>
      {notice && (
        <p className="vs-ok vs-ok-sticky" aria-hidden="true">
          {notice}
        </p>
      )}
      <div className="vs-seg" role="group" aria-label="What to fix">
        <button type="button" aria-pressed={tab === 'records'} onClick={() => setTab('records')}>
          Records
        </button>
        <button type="button" aria-pressed={tab === 'meetings'} onClick={() => setTab('meetings')}>
          Meetings
        </button>
      </div>
      <div className="vs-search" data-tour="fix">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          aria-label={tab === 'records' ? 'Search records' : 'Search meetings'}
          placeholder={tab === 'records' ? 'Search by title or number, for example Ordinance 2026-08' : 'Search by name or date, for example 2026-10-14'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div hidden={tab !== 'records'}>
        <Alert>{recs.error}</Alert>
        {!applied && <p className="vs-hint">Search for the record you want to fix.</p>}
        {applied && recs.data && recs.data.items.length === 0 && <p className="vs-empty">No record matches that.</p>}
        <ul className="vs-list">
          {recs.data?.items.map((r) => (
            <RecordRow key={`${r.id}:${r.title}:${r.document_date}:${r.meeting_id}`} r={r} types={recs.data!.types} meetings={choices.data?.items ?? []} onDone={done} />
          ))}
        </ul>
        {recs.data && recs.data.hidden.length > 0 && (
          <div className="vs-stack">
            <h2 className="vs-h2">Hidden records</h2>
            <ul className="vs-list">
              {recs.data.hidden.map((h) => (
                <li key={h.id} className="vs-person" data-off="true">
                  <div className="vs-row">
                    <div className="vs-row-main">
                      <p className="vs-row-title">{h.title}</p>
                      <p className="vs-row-sub">{[h.document_date, h.reason].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                  <div className="vs-actions">
                    <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" aria-label={`Put back ${h.title}`} onClick={() => void putBack(h)}>
                      <RotateCcw size={14} aria-hidden="true" /> Put back
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div hidden={tab !== 'meetings'}>
        <Alert>{mtgs.error}</Alert>
        {!applied && <p className="vs-hint">Meetings from the last 60 days and coming up. Search to find an older one.</p>}
        {mtgs.data && mtgs.data.items.length === 0 && <p className="vs-empty">No meeting matches that.</p>}
        <ul className="vs-list">
          {mtgs.data?.items.map((m) => (
            <MeetingRow key={`${m.id}:${m.status}:${m.meeting_date}:${m.location}:${m.manual_json}`} m={m} onDone={done} />
          ))}
        </ul>
      </div>
    </section>
  );
}
