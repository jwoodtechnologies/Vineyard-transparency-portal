import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Pencil, Search, Trash2 } from 'lucide-react';
import { staff, when } from './api';
import { Alert, Field } from './ui';
import RecordAdd, { type Added } from './RecordAdd';
import { MeetingSelect, TypeSelect } from './RecordFields';
import { useMeetings } from './useMeetings';
import { KIND_LABEL, day, meetingLabel, sizeLabel, statusNote, type MeetingOption, type RecordItem, type RecordType } from './recordsLib';
import { useStaffData } from './useStaff';

function EditForm({ item, types, meetings, onSaved, onCancel }: { item: RecordItem; types: RecordType[]; meetings: MeetingOption[]; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [type, setType] = useState(item.typeKey ?? 'other');
  const [date, setDate] = useState(item.doc_date ?? '');
  const [meetingId, setMeetingId] = useState(item.meeting_id ?? '');
  const [body, setBody] = useState(item.body ?? '');
  const [url, setUrl] = useState(item.url ?? '');
  const [status, setStatus] = useState(item.status_text ?? '');
  const [location, setLocation] = useState(item.location ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await staff('/records/edit', { body: { id: item.id, title, ...(item.kind === 'file' ? { type } : {}), date, body, text: body, description: body, url, status, location, meetingId } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  const current = item.meeting_id ? { id: item.meeting_id, label: item.meeting_title ? meetingLabel({ title: item.meeting_title, meeting_date: item.meeting_date, government_body_name: null }) : 'The chosen meeting' } : null;
  return (
    <form className="vs-edit" onSubmit={save} noValidate aria-label={`Change ${item.title}`}>
      <Field label="Title">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      {item.kind === 'file' && <TypeSelect value={type} onChange={setType} types={types} />}
      {item.kind === 'link' && <Field label="Web address">{(id) => <input id={id} type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>}
      {item.kind === 'project' && (
        <>
          <Field label="Status">{(id) => <input id={id} value={status} onChange={(e) => setStatus(e.target.value)} />}</Field>
          <Field label="Location">{(id) => <input id={id} value={location} onChange={(e) => setLocation(e.target.value)} />}</Field>
        </>
      )}
      <Field label="Date of the record">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
      <MeetingSelect value={meetingId} onChange={setMeetingId} meetings={meetings} current={current} />
      <Field label={item.kind === 'note' ? 'Note' : 'Short description'}>{(id) => <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || !title.trim()}>
          Save
        </button>
        <button type="button" className="vs-btn vs-btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({ item, types, meetings, onChanged, onError }: { item: RecordItem; types: RecordType[]; meetings: MeetingOption[]; onChanged: () => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const typeLabel = item.kind === 'file' ? (types.find((t) => t.key === item.typeKey)?.label ?? 'Other') : null;
  const meta = [typeLabel, day(item.doc_date), item.meeting_date ? meetingLabel({ title: item.meeting_title ?? '', meeting_date: item.meeting_date, government_body_name: null }) : '', item.file_size ? sizeLabel(item.file_size) : ''].filter(Boolean);
  const note = statusNote(item.index_status);

  async function remove() {
    onError('');
    try {
      await staff('/records/delete', { body: { id: item.id } });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove that.');
      setConfirm(false);
    }
  }

  return (
    <li className="vs-person">
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">
            {item.title} <span className="vs-badge" data-tone="off">{KIND_LABEL[item.kind]}</span>
          </p>
          {meta.length > 0 && <p className="vs-row-sub">{meta.join(' · ')}</p>}
          <p className="vs-row-sub">
            Added {when(item.created_at)}
            {item.added_by ? ` by ${item.added_by}` : ''}
          </p>
          {note && <p className="vs-row-sub">{note}</p>}
        </div>
      </div>
      <div className="vs-actions">
        {item.document_id && (
          <Link className="vs-btn vs-btn-small vs-btn-quiet" to={`/documents/${item.document_id}`} target="_blank" rel="noopener">
            <ExternalLink size={14} aria-hidden="true" /> View
          </Link>
        )}
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          <Pencil size={14} aria-hidden="true" /> {editing ? 'Close' : 'Edit'}
        </button>
        {confirm ? (
          <>
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" onClick={remove}>
              Yes, remove it
            </button>
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        )}
      </div>
      {confirm && <p className="vs-hint">Removing takes it off the portal and deletes the stored file. This cannot be undone.</p>}
      {editing && (
        <EditForm
          item={item}
          types={types}
          meetings={meetings}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

/** Records and meetings: add files, notes and links, and fix or remove what was added. */
export default function Records() {
  const meetings = useMeetings();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setApplied(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error: loadError, reload } = useStaffData<{ items: RecordItem[]; types: RecordType[] }>(`/records/uploads${applied ? `?q=${encodeURIComponent(applied)}` : ''}`);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<Added | null>(null);
  const banner = useRef<HTMLParagraphElement>(null);
  // The form is long on a phone, so bring the confirmation into view after an add.
  useEffect(() => {
    if (added) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [added]);
  const types = data?.types ?? [];

  return (
    <section className="vs-stack" aria-labelledby="vs-records">
      <div>
        <h1 id="vs-records" className="vs-title">
          Records
        </h1>
        <p className="vs-lede">Add agendas, minutes, reports and other documents. Whatever you add can be searched and opened on the portal right away.</p>
      </div>

      {added && (
        <p className="vs-ok" role="status" ref={banner}>
          Added “{added.title}”. It is on the portal now.
          {added.documentId && (
            <>
              {' '}
              <Link to={`/documents/${added.documentId}`} target="_blank" rel="noopener" className="vs-link">
                See it on the portal
              </Link>
              .
            </>
          )}
          {added.minutes && ' The Votes page will include these minutes within about ten minutes.'}
        </p>
      )}

      {types.length > 0 ? (
        <RecordAdd
          types={types}
          meetings={meetings}
          onAdded={(a) => {
            setAdded(a);
            setError('');
            setQ('');
            reload();
          }}
        />
      ) : (
        !loadError && <p className="vs-empty">Loading</p>
      )}

      <div>
        <h2 className="vs-h2">Added by staff</h2>
        <div className="vs-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" aria-label="Search what staff added" placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Alert>{error || loadError}</Alert>
        {data && data.items.length === 0 && <p className="vs-empty">{applied ? 'Nothing matches that.' : 'Nothing has been added yet.'}</p>}
        <ul className="vs-list">
          {data?.items.map((item) => (
            <Row
              key={item.id}
              item={item}
              types={types}
              meetings={meetings}
              onError={setError}
              onChanged={() => {
                setAdded(null);
                reload();
              }}
            />
          ))}
        </ul>
        {data && data.items.length >= 100 && <p className="vs-hint">Showing the 100 most recent. Search to find older ones.</p>}
      </div>
    </section>
  );
}
