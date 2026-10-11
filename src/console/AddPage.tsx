/**
 * /add : "Add to the record". Anyone can add a document (PDF, PNG or JPG), a project, a note or a
 * link. Items show right away in their own collection, labelled "Resident submitted. Not a city
 * record." Everything is plain text.
 */
import './styles';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, FolderKanban, Link2, StickyNote } from 'lucide-react';
import { Frame } from './Chrome';
import { RESIDENT_LABEL } from './format';
import { setHead } from '@/lib/head';

type Kind = 'file' | 'project' | 'note' | 'link';
const KINDS: Array<{ id: Kind; label: string; Icon: typeof FileUp }> = [
  { id: 'file', label: 'Document', Icon: FileUp },
  { id: 'project', label: 'Project', Icon: FolderKanban },
  { id: 'note', label: 'Note', Icon: StickyNote },
  { id: 'link', label: 'Link', Icon: Link2 },
];
const MAX_BYTES = 15 * 1024 * 1024;

type Sent = { status: 'idle' } | { status: 'sending' } | { status: 'done'; documentId: string | null } | { status: 'error'; message: string };

async function send(url: string, init: RequestInit): Promise<{ documentId?: string }> {
  const r = await fetch(url, init);
  const j = (await r.json().catch(() => ({}))) as { documentId?: string; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? 'That could not be added. Try again later.');
  return j;
}

export default function AddPage() {
  const [open, setOpen] = useState<boolean | null>(null);
  const [kind, setKind] = useState<Kind>('file');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [sent, setSent] = useState<Sent>({ status: 'idle' });
  const form = useRef<HTMLFormElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHead('Add to the record');
    let live = true;
    fetch('/api/add/status', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ open?: boolean }>)
      .then((j) => live && setOpen(j.open !== false), () => live && setOpen(true));
    return () => {
      live = false;
    };
  }, []);

  const choose = (f: File | null | undefined) => {
    setFileError(null);
    if (!f) return;
    if (!/\.(pdf|png|jpe?g)$/i.test(f.name) && !/^(application\/pdf|image\/png|image\/jpeg)$/.test(f.type)) {
      setFileError('Only PDF, PNG or JPG files.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError('Files can be up to 15 MB.');
      return;
    }
    setFile(f);
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const text = (k: string) => String(fd.get(k) ?? '');
    let req: Promise<{ documentId?: string }>;
    if (kind === 'file') {
      if (!file) {
        setFileError('Choose a file to add.');
        return;
      }
      const body = new FormData();
      body.append('file', file);
      body.append('title', text('title'));
      body.append('description', text('description'));
      body.append('website', text('website'));
      req = send('/api/add/file', { method: 'POST', body });
    } else {
      const payload: Record<string, string> = { kind, website: text('website') };
      for (const k of ['title', 'name', 'description', 'status', 'location', 'text', 'url']) if (fd.has(k)) payload[k] = text(k);
      req = send('/api/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    }
    setSent({ status: 'sending' });
    req.then(
      (j) => {
        setSent({ status: 'done', documentId: j.documentId ?? null });
        form.current?.reset();
        setFile(null);
      },
      (err: Error) => setSent({ status: 'error', message: err.message }),
    );
  };

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Add to the record</h1>
        <p className="vc-add-lede">Share a document, a project, a note or a link about Vineyard. It shows right away with the label "{RESIDENT_LABEL}"</p>
      </header>

      {open === null ? (
        <div className="vc-skeleton" aria-hidden="true">
          <span style={{ width: '60%' }} />
          <span style={{ width: '90%' }} />
        </div>
      ) : !open ? (
        <div className="vc-empty">Submissions are paused.</div>
      ) : sent.status === 'done' ? (
        <div className="vc-add-done" role="status">
          <p className="vc-add-done-title">Added.</p>
          <div className="vc-add-actions">
            {sent.documentId && (
              <Link to={`/documents/${encodeURIComponent(sent.documentId)}`} className="vc-primary">
                View it
              </Link>
            )}
            <button type="button" className="vc-secondary" onClick={() => setSent({ status: 'idle' })}>
              Add another
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="vc-add-kinds" role="radiogroup" aria-label="What to add">
            {KINDS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={kind === id}
                className="vc-add-kind"
                data-active={kind === id}
                onClick={() => {
                  setKind(id);
                  setSent({ status: 'idle' });
                }}
              >
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <form ref={form} className="vc-add-form" onSubmit={submit} noValidate={false}>
            {/* Left empty by people; filled only by bots. */}
            <div className="vc-add-trap" aria-hidden="true">
              <label>
                Website
                <input name="website" type="text" tabIndex={-1} autoComplete="off" />
              </label>
            </div>

            {kind === 'file' && (
              <>
                <div
                  className="vc-add-drop"
                  data-over={over}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    choose(e.dataTransfer.files?.[0]);
                  }}
                >
                  <FileUp size={22} strokeWidth={1.6} aria-hidden="true" />
                  <span className="vc-add-drop-title">{file ? file.name : 'Drop a file here'}</span>
                  <span className="vc-add-hint">PDF, PNG or JPG, up to 15 MB.</span>
                  <button type="button" className="vc-secondary" onClick={() => picker.current?.click()}>
                    {file ? 'Choose another file' : 'Choose a file'}
                  </button>
                  <input ref={picker} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="vc-add-file" aria-label="File" onChange={(e) => choose(e.target.files?.[0])} />
                </div>
                {fileError && (
                  <p className="vc-add-error" role="alert">
                    {fileError}
                  </p>
                )}
                <Field label="Title" name="title" placeholder={file ? file.name.replace(/\.[^.]+$/, '') : ''} max={200} />
                <Field label="Description (optional)" name="description" area max={5000} />
              </>
            )}
            {kind === 'project' && (
              <>
                <Field label="Name" name="name" required max={200} />
                <Field label="Description" name="description" area max={20000} />
                <div className="vc-add-row">
                  <label className="vc-add-field">
                    <span>Status</span>
                    <select name="status" defaultValue="Planned">
                      <option>Planned</option>
                      <option>Underway</option>
                      <option>Complete</option>
                      <option>On hold</option>
                    </select>
                  </label>
                  <Field label="Location (optional)" name="location" max={200} />
                </div>
              </>
            )}
            {kind === 'note' && (
              <>
                <Field label="Title (optional)" name="title" max={200} />
                <Field label="Note" name="text" area required max={20000} />
              </>
            )}
            {kind === 'link' && (
              <>
                <Field label="Web address" name="url" type="url" required max={1000} placeholder="https://" />
                <Field label="Title" name="title" max={200} />
                <Field label="Description (optional)" name="description" area max={5000} />
              </>
            )}

            {sent.status === 'error' && (
              <p className="vc-add-error" role="alert">
                {sent.message}
              </p>
            )}
            <div className="vc-add-actions">
              <button type="submit" className="vc-primary" disabled={sent.status === 'sending'}>
                {sent.status === 'sending' ? 'Adding...' : 'Add'}
              </button>
            </div>
            <p className="vc-add-hint">Plain text only. Up to 3 items a day. Anyone can report an item.</p>
          </form>
        </>
      )}
    </Frame>
  );
}

function Field({ label, name, area = false, required = false, max, type = 'text', placeholder }: { label: string; name: string; area?: boolean; required?: boolean; max: number; type?: string; placeholder?: string }) {
  return (
    <label className="vc-add-field">
      <span>{label}</span>
      {area ? <textarea name={name} required={required} maxLength={max} rows={5} /> : <input name={name} type={type} required={required} maxLength={max} placeholder={placeholder} inputMode={type === 'url' ? 'url' : undefined} />}
    </label>
  );
}
