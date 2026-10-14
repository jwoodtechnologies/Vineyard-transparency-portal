import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { FileUp, Link2, StickyNote, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StaffError, staff, staffUpload } from './api';
import { Alert, Field, Spinner } from './ui';
import { MeetingSelect, TypeSelect } from './RecordFields';
import { FILE_ACCEPT, MAX_FILE_BYTES, guessType, sizeLabel, titleFromFile, type MeetingOption, type RecordType } from './recordsLib';
import { MAX_BATCH, STATUS_WORD, bulkItems, bulkSummary, sendAll, type BulkItem } from './bulkLib';

type Mode = 'file' | 'note' | 'link';
export interface Added {
  /** The staff upload's id, to follow its indexing. */
  id: string | null;
  title: string;
  documentId: string | null;
  minutes: boolean;
  /** Indexing: done, queued, no_text or failed (recordsLib indexState). */
  status: string;
}

interface Props {
  types: RecordType[];
  meetings: MeetingOption[];
  onAdded: (a: Added) => void;
  /** After files are added together: the list of what staff added is read again. */
  onBatch?: () => void;
}

const MODES: Array<{ key: Mode; label: string; Icon: typeof FileUp }> = [
  { key: 'file', label: 'File', Icon: FileUp },
  { key: 'note', label: 'Note', Icon: StickyNote },
  { key: 'link', label: 'Link', Icon: Link2 },
];

function FileForm({ types, meetings, onAdded, onBatch }: Props) {
  const keys = useMemo(() => types.map((t) => t.key), [types]);
  const [many, setMany] = useState<File[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('other');
  const [date, setDate] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [body, setBody] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  /** One file opens the form below; several open the list for adding them together. */
  function pick(list: FileList | null | undefined) {
    const files = [...(list ?? [])];
    setError('');
    if (files.length > 1) {
      setMany(files);
      return;
    }
    const f = files[0] ?? null;
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setError(`That file is ${sizeLabel(f.size)}. Files can be up to 25 MB.`);
      return;
    }
    setFile(f);
    setType(guessType(f.name, keys));
  }

  function drop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files);
  }

  /** A meeting on the chosen date is picked for them (they can change it). */
  function chooseDate(v: string) {
    setDate(v);
    if (v && !meetingId) {
      const m = meetings.find((x) => x.meeting_date?.startsWith(v));
      if (m) setMeetingId(m.id);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    form.append('type', type);
    const finalTitle = title.trim() || titleFromFile(file.name);
    if (finalTitle) form.append('title', finalTitle);
    if (date) form.append('date', date);
    if (meetingId) form.append('meetingId', meetingId);
    if (body.trim()) form.append('body', body.trim());
    try {
      const r = await staffUpload<{ id: string; documentId: string | null; status: string }>('/records/file', form);
      onAdded({ id: r.id, title: finalTitle || file.name, documentId: r.documentId, minutes: type === 'minutes', status: r.status });
      setFile(null);
      setTitle('');
      setType('other');
      setDate('');
      setMeetingId('');
      setBody('');
      if (input.current) input.current.value = '';
    } catch (err) {
      setError(err instanceof StaffError ? err.message : 'The file could not be added.');
    } finally {
      setBusy(false);
    }
  }

  if (many) {
    return (
      <BulkForm
        types={types}
        meetings={meetings}
        files={many}
        onBatch={onBatch}
        onClose={() => {
          setMany(null);
          if (input.current) input.current.value = '';
        }}
      />
    );
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Add a file">
      <label className="vs-file" data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
        <input ref={input} className="vs-sr" type="file" multiple accept={FILE_ACCEPT} onChange={(e) => pick(e.target.files)} />
        <FileUp size={22} aria-hidden="true" />
        <span className="vs-file-text">
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{sizeLabel(file.size)}. Tap to choose a different file.</span>
            </>
          ) : (
            <>
              <strong>Choose files</strong>
              <span>PDF, picture, text or CSV, up to 25 MB each. Choose or drop one file, or up to {MAX_BATCH} at once.</span>
            </>
          )}
        </span>
      </label>
      {file && (
        <div className="vs-after">
          <Field label="Title" hint="Leave it as is to use the file name.">
            {(id) => <input id={id} value={title} placeholder={titleFromFile(file.name)} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <TypeSelect value={type} onChange={setType} types={types} />
          <Field label="Date of the record" hint="Optional. The meeting date for agendas and minutes.">{(id) => <input id={id} type="date" value={date} onChange={(e) => chooseDate(e.target.value)} />}</Field>
          <MeetingSelect value={meetingId} onChange={setMeetingId} meetings={meetings} />
          <Field label="Short description" hint="Optional. Shown with the record.">{(id) => <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
          {type === 'minutes' && <p className="vs-hint vs-note">Minutes are read for votes automatically. The Votes page picks them up within about ten minutes.</p>}
        </div>
      )}
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={!file || busy}>
          {busy ? <Spinner label="Uploading" /> : <FileUp size={16} aria-hidden="true" />} {busy ? 'Uploading' : 'Add file'}
        </button>
      </div>
    </form>
  );
}

const GUESS = '';

/** Many files at once: shared details, a title for each, then each file is sent in turn with its progress shown. */
function BulkForm({ types, meetings, files, onBatch, onClose }: Omit<Props, 'onAdded'> & { files: File[]; onClose: () => void }) {
  const keys = useMemo(() => types.map((t) => t.key), [types]);
  const [first] = useState(() => bulkItems(files));
  const [items, setItems] = useState<BulkItem[]>(first.items);
  const [left, setLeft] = useState<string[]>(first.left);
  const [type, setType] = useState(GUESS);
  const [date, setDate] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const more = useRef<HTMLInputElement>(null);

  const update = (key: string, patch: Partial<BulkItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const addFiles = (list: FileList | null | undefined) => {
    const r = bulkItems([...(list ?? [])], items.length);
    setItems((xs) => [...xs, ...r.items]);
    setLeft(r.left);
    if (more.current) more.current.value = '';
  };

  function chooseDate(v: string) {
    setDate(v);
    if (v && !meetingId) {
      const m = meetings.find((x) => x.meeting_date?.startsWith(v));
      if (m) setMeetingId(m.id);
    }
  }

  async function run(retry: boolean) {
    if (busy) return;
    setBusy(true);
    const r = await sendAll(
      items,
      async (item) => {
        const form = new FormData();
        form.append('file', item.file);
        form.append('type', type || guessType(item.file.name, keys));
        form.append('title', item.title.trim() || titleFromFile(item.file.name) || item.file.name);
        if (date) form.append('date', date);
        if (meetingId) form.append('meetingId', meetingId);
        if (body.trim()) form.append('body', body.trim());
        const res = await staffUpload<{ documentId: string | null }>('/records/file', form);
        return res.documentId;
      },
      update,
      retry,
    );
    setBusy(false);
    if (r.added) onBatch?.();
  }

  const waiting = items.filter((i) => i.status === 'ready').length;
  const failed = items.filter((i) => i.status === 'error').length;
  const done = items.length > 0 && items.every((i) => i.status === 'added');
  const minutes = items.some((i) => (type || guessType(i.file.name, keys)) === 'minutes');

  return (
    <div role="group" aria-label="Add several files">
      <p className="vs-hint vs-bulk-intro">These details apply to every file. You can change each title below.</p>
      <Field label="Type of record">
        {(id) => (
          <select id={id} value={type} disabled={busy} onChange={(e) => setType(e.target.value)}>
            <option value={GUESS}>Guess from each file name</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Date of the records" hint="Optional. The meeting date for agendas and minutes.">
        {(id) => <input id={id} type="date" value={date} disabled={busy} onChange={(e) => chooseDate(e.target.value)} />}
      </Field>
      <MeetingSelect value={meetingId} onChange={setMeetingId} meetings={meetings} />
      <Field label="Short description" hint="Optional. Shown with each record.">
        {(id) => <textarea id={id} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      {minutes && <p className="vs-hint vs-note">Minutes are read for votes automatically. The Votes page picks them up within about ten minutes.</p>}

      <p className="vs-bulk-sum" role="status">
        {bulkSummary(items)}
      </p>
      {left.length > 0 && (
        <ul className="vs-bulk-left">
          {left.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <ul className="vs-list vs-bulk">
        {items.map((i) => (
          <li key={i.key} className="vs-person">
            <Field label={`Title for ${i.file.name}`}>
              {(id) => <input id={id} value={i.title} disabled={busy || i.status === 'added'} onChange={(e) => update(i.key, { title: e.target.value })} />}
            </Field>
            <p className="vs-row-sub">
              <span className="vs-badge" data-tone={i.status === 'error' ? 'wait' : i.status === 'added' ? undefined : 'off'}>
                {STATUS_WORD[i.status]}
              </span>{' '}
              {sizeLabel(i.file.size)}
              {i.status === 'added' && i.documentId && (
                <>
                  {' · '}
                  <Link to={`/documents/${i.documentId}`} target="_blank" rel="noopener" className="vs-link">
                    See it on the portal
                  </Link>
                </>
              )}
            </p>
            {i.status === 'error' && <p className="vs-bulk-err">{i.message}</p>}
            {(i.status === 'ready' || i.status === 'error') && !busy && (
              <div className="vs-actions">
                <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setItems((xs) => xs.filter((x) => x.key !== i.key))}>
                  <X size={14} aria-hidden="true" /> Leave this one out
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="vs-actions">
        {waiting > 0 && (
          <button type="button" className="vs-btn vs-btn-primary" disabled={busy} onClick={() => void run(false)}>
            {busy ? <Spinner label="Adding" /> : <FileUp size={16} aria-hidden="true" />} {busy ? 'Adding' : `Add ${waiting} ${waiting === 1 ? 'file' : 'files'}`}
          </button>
        )}
        {failed > 0 && !waiting && (
          <button type="button" className="vs-btn vs-btn-primary" disabled={busy} onClick={() => void run(true)}>
            Retry failed ({failed})
          </button>
        )}
        {!busy && !done && items.length < MAX_BATCH && (
          <label className="vs-btn vs-btn-quiet">
            <input ref={more} className="vs-sr" type="file" multiple accept={FILE_ACCEPT} onChange={(e) => addFiles(e.target.files)} />
            Add more files
          </label>
        )}
        {!busy && (
          <button type="button" className="vs-btn vs-btn-quiet" onClick={onClose}>
            {done ? 'Add other files' : 'Start over'}
          </button>
        )}
      </div>
    </div>
  );
}

function NoteForm({ onAdded }: Props) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await staff<{ id: string; documentId: string | null; status: string }>('/records/note', { body: { title, text } });
      onAdded({ id: r.id, title: title.trim() || text.trim().split('\n')[0].slice(0, 80), documentId: r.documentId, minutes: false, status: r.status });
      setTitle('');
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The note could not be added.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Add a note">
      <Field label="Title" hint="Optional.">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Note">{(id) => <textarea id={id} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || !text.trim()}>
          Add note
        </button>
      </div>
    </form>
  );
}

function LinkForm({ onAdded }: Props) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await staff<{ id: string; documentId: string | null; status: string }>('/records/link', { body: { url, title, description: body } });
      onAdded({ id: r.id, title: title.trim() || url, documentId: r.documentId, minutes: false, status: r.status });
      setUrl('');
      setTitle('');
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The link could not be added.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Add a link">
      <Field label="Web address" hint="Starts with https://">{(id) => <input id={id} type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
      <Field label="Title" hint="Optional. The site name is used if you leave it empty.">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      <Field label="Short description" hint="Optional.">{(id) => <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      <Alert>{error}</Alert>
      <div className="vs-actions">
        <button type="submit" className="vs-btn vs-btn-primary" disabled={busy || !url.trim()}>
          Add link
        </button>
      </div>
    </form>
  );
}

/** One card that adds a file, a note or a link. */
export default function RecordAdd(props: Props) {
  const [mode, setMode] = useState<Mode>('file');
  return (
    <div className="vs-card" data-tour="add-record">
      <h2 className="vs-h2">Add to the portal</h2>
      <div className="vs-seg" role="group" aria-label="What to add">
        {MODES.map(({ key, label, Icon }) => (
          <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)} data-tour={key === 'note' ? 'add-note' : undefined}>
            <Icon size={16} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {mode === 'file' && <FileForm {...props} />}
      {mode === 'note' && <NoteForm {...props} />}
      {mode === 'link' && <LinkForm {...props} />}
    </div>
  );
}
