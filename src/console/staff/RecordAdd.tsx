import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { FileUp, Link2, StickyNote } from 'lucide-react';
import { StaffError, staff, staffUpload } from './api';
import { Alert, Field, Spinner } from './ui';
import { MeetingSelect, TypeSelect } from './RecordFields';
import { FILE_ACCEPT, MAX_FILE_BYTES, guessType, sizeLabel, titleFromFile, type MeetingOption, type RecordType } from './recordsLib';

type Mode = 'file' | 'note' | 'link';
export interface Added {
  title: string;
  documentId: string | null;
  minutes: boolean;
}

interface Props {
  types: RecordType[];
  meetings: MeetingOption[];
  onAdded: (a: Added) => void;
}

const MODES: Array<{ key: Mode; label: string; Icon: typeof FileUp }> = [
  { key: 'file', label: 'File', Icon: FileUp },
  { key: 'note', label: 'Note', Icon: StickyNote },
  { key: 'link', label: 'Link', Icon: Link2 },
];

function FileForm({ types, meetings, onAdded }: Props) {
  const keys = useMemo(() => types.map((t) => t.key), [types]);
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

  function pick(f: File | null) {
    setError('');
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
    pick(e.dataTransfer.files[0] ?? null);
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
      const r = await staffUpload<{ documentId: string | null }>('/records/file', form);
      onAdded({ title: finalTitle || file.name, documentId: r.documentId, minutes: type === 'minutes' });
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

  return (
    <form onSubmit={submit} noValidate aria-label="Add a file">
      <label className="vs-file" data-over={over} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
        <input ref={input} className="vs-sr" type="file" accept={FILE_ACCEPT} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        <FileUp size={22} aria-hidden="true" />
        <span className="vs-file-text">
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{sizeLabel(file.size)}. Tap to choose a different file.</span>
            </>
          ) : (
            <>
              <strong>Choose a file</strong>
              <span>PDF, picture, text or CSV, up to 25 MB. You can also drop one here.</span>
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
      const r = await staff<{ documentId: string | null }>('/records/note', { body: { title, text } });
      onAdded({ title: title.trim() || text.trim().split('\n')[0].slice(0, 80), documentId: r.documentId, minutes: false });
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
      const r = await staff<{ documentId: string | null }>('/records/link', { body: { url, title, description: body } });
      onAdded({ title: title.trim() || url, documentId: r.documentId, minutes: false });
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
    <div className="vs-card">
      <h2 className="vs-h2">Add to the portal</h2>
      <div className="vs-seg" role="group" aria-label="What to add">
        {MODES.map(({ key, label, Icon }) => (
          <button key={key} type="button" aria-pressed={mode === key} onClick={() => setMode(key)}>
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
